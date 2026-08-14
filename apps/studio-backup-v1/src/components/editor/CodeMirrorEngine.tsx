"use client";

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter,
  drawSelection, dropCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting,
} from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import {
  acceptDiff, clearDiff, diffField, rejectDiff, setDiff, type InlineDiff,
} from "./InlineDiffEngine";

const klynTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent", color: "var(--color-ink)",
    fontSize: "11.5px", fontFamily: "var(--font-mono)", height: "100%",
  },
  ".cm-content": { caretColor: "var(--color-accent)", padding: "8px 0" },
  ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--color-ink-dim)", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(102,252,241,0.04)" },
  "&.cm-focused": { outline: "none" },
}, { dark: true });

interface Props {
  code: string;
  diff?: InlineDiff | null;
  readOnly?: boolean;
  onAccept?: (next: string) => void;
  onReject?: () => void;
}

export default function CodeMirrorEngine({ code, diff = null, readOnly = false, onAccept, onReject }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef({ onAccept, onReject });
  cbRef.current = { onAccept, onReject };

  useEffect(() => {
    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), history(),
        indentOnInput(), bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        javascript({ typescript: true }), drawSelection(), dropCursor(), klynTheme,
        // Diff field + callback-aware keybindings (Tab/Esc)
        diffField,
        keymap.of([
          { key: "Tab", run: (v) => {
              const ok = acceptDiff(v);
              if (ok) cbRef.current.onAccept?.(v.state.doc.toString());
              return ok;
          } },
          { key: "Escape", run: (v) => {
              const ok = rejectDiff(v);
              if (ok) cbRef.current.onReject?.();
              return ok;
          } },
          ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.editable.of(!readOnly),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current! });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: diff ? setDiff.of(diff) : clearDiff.of(null) });
  }, [diff]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
}
