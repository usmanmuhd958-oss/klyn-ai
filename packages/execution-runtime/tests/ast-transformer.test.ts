import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AstMutationEngine, AstMutationError } from "../src/index.ts";

test("AST engine applies structural mutations without touching comments or unrelated text", () => {
  const source = [
    '// answer is intentionally unchanged in this comment',
    'import { value } from "./value.js";',
    "",
    "export function compute(answer: number): number {",
    "  return answer + value;",
    "}",
    "",
  ].join("\n");

  const engine = new AstMutationEngine();
  const result = engine.apply("compute.ts", source, [
    { kind: "rename-identifier", from: "answer", to: "result" },
    { kind: "replace-function-body", functionName: "compute", body: "return result * value;" },
  ]);

  assert.equal(result.changed, true);
  assert.match(result.source, /comment/);
  assert.match(result.source, /function compute\(result: number\)/);
  assert.match(result.source, /return result \* value;/);
  assert.equal(result.edits.length, 3);
});

test("AST engine manages imports as syntax nodes", () => {
  const engine = new AstMutationEngine();
  const source = 'export const value = 1;\n';

  const added = engine.apply("value.ts", source, [
    {
      kind: "add-import",
      moduleSpecifier: "node:fs",
      namedImports: ["readFile"],
      typeOnly: true,
    },
  ]);
  assert.match(added.source, /^import type \{ readFile \} from "node:fs";/);

  const removed = engine.apply("value.ts", added.source, [
    { kind: "remove-import", moduleSpecifier: "node:fs" },
  ]);
  assert.equal(removed.source, source);
});

test("AST engine rejects overlapping or missing targets", () => {
  const engine = new AstMutationEngine();
  assert.throws(
    () => engine.apply("missing.ts", "export const value = 1;", [
      { kind: "rename-identifier", from: "missing", to: "present" },
    ]),
    AstMutationError,
  );
});
