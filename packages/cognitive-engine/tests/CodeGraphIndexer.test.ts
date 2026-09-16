import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CodeGraphIndexer } from "../src/CodeGraphIndexer.js";

describe("CodeGraphIndexer", () => {
  it("builds deterministic import/export edges and semantic anchors", () => {
    const index = new CodeGraphIndexer().index([
      { path: "src/a.ts", content: "import { b } from './b'; export { c } from './c';" },
      { path: "src/b.ts", content: "export const b = 1;" },
      { path: "src/c.ts", content: "export const c = 2;" },
    ]);

    assert.deepEqual(index.nodes[0]?.imports, ["src/b.ts", "src/c.ts"]);
    assert.equal(index.edges.length, 2);
    assert.equal(index.edges[0]?.from, "src/a.ts");
    assert.equal(index.anchors.length, 2);
    assert.match(index.anchors[0]?.label ?? "", /src\/a\.ts/);
  });

  it("resolves relative index modules and preserves external package edges", () => {
    const index = new CodeGraphIndexer().index([
      { path: "src/main.ts", content: "import x from './util'; import z from '@klyn/foo';" },
      { path: "src/util/index.ts", content: "export default 1;" },
    ]);

    const targets = index.nodes[0]?.imports ?? [];
    assert.ok(targets.includes("src/util/index.ts"));
    assert.ok(targets.includes("external:@klyn/foo"));
  });
});
