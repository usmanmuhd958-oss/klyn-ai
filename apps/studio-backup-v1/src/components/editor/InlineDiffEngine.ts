import { RangeSetBuilder, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";

export interface InlineDiff {
  original: string;
  proposed: string;
  source: string; // agent id that proposed the edit
  ts: number;
}

export type DiffOp =
  | { type: "equal"; text: string }
  | { type: "del"; text: string }
  | { type: "add"; text: string };

/* Line-level LCS diff — sufficient for card-sized edits;
   Phase 1 swaps in a Myers bit-parallel implementation. */
export function diffLines(a: string, b: string): DiffOp[] {
  const al = a.split("\n"), bl = b.split("\n");
  const m = al.length, n = bl.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (al[i] === bl[j]) { ops.push({ type: "equal", text: al[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", text: al[i] }); i++; }
    else { ops.push({ type: "add", text: bl[j] }); j++; }
  }
  while (i < m) { ops.push({ type: "del", text: al[i++] }); }
  while (j < n) { ops.push({ type: "add", text: bl[j++] }); }
  return ops;
}

export const setDiff = StateEffect.define<InlineDiff>();
export const clearDiff = StateEffect.define<null>();

/* Ghost blocks render proposed insertions without touching the doc. */
class GhostBlock extends WidgetType {
  constructor(readonly lines: string[]) { super(); }
  eq(other: GhostBlock) { return this.lines.join("\n") === other.lines.join("\n"); }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "klyn-diff-ghost";
    for (const line of this.lines) {
      const el = document.createElement("div");
      el.textContent = "+ " + line;
      wrap.appendChild(el);
    }
    return wrap;
  }
  ignoreEvent() { return false; }
}

interface DiffState { diff: InlineDiff | null; deco: DecorationSet; }

function buildDeco(state: EditorState, diff: InlineDiff): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ops = diffLines(diff.original, diff.proposed);
  let consumed = 0; // original lines consumed so far
  let pendingAdds: string[] = [];

  const flushAdds = () => {
    if (!pendingAdds.length) return;
    const pos = consumed === 0
      ? 0
      : state.doc.line(Math.min(consumed, state.doc.lines)).to;
    builder.add(pos, pos,
      Decoration.widget({ widget: new GhostBlock(pendingAdds), side: 1, block: true }));
    pendingAdds = [];
  };

  for (const op of ops) {
    if (op.type === "add") { pendingAdds.push(op.text); continue; }
    flushAdds();
    if (op.type === "del") {
      const n = consumed + 1;
      if (n <= state.doc.lines) {
        const { from, to } = state.doc.line(n);
        builder.add(from, to, Decoration.line({ class: "klyn-diff-del" }));
      }
    }
    consumed += 1;
  }
  flushAdds();
  return builder.finish();
}

export const diffField = StateField.define<DiffState>({
  create: () => ({ diff: null, deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiff)) return { diff: e.value, deco: buildDeco(tr.state, e.value) };
      if (e.is(clearDiff)) return { diff: null, deco: Decoration.none };
    }
    return { diff: value.diff, deco: value.deco.map(tr.changes) };
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.deco),
});

export function acceptDiff(view: EditorView): boolean {
  const { diff } = view.state.field(diffField);
  if (!diff) return false;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: diff.proposed },
    effects: clearDiff.of(null),
    userEvent: "input.complete",
  });
  return true;
}

export function rejectDiff(view: EditorView): boolean {
  if (!view.state.field(diffField).diff) return false;
  view.dispatch({ effects: clearDiff.of(null) });
  return true;
}

export const inlineDiffKeymap = keymap.of([
  { key: "Tab", run: acceptDiff },
  { key: "Escape", run: rejectDiff },
]);

export function inlineDiff() {
  return [diffField, inlineDiffKeymap];
}
