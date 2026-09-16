import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  HermeticToolError,
  HermeticToolKernel,
} from "../src/hermetic-tool-kernel.js";
import type { HermeticToolCall } from "../src/hermetic-tool-contracts.js";

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const metadata = {
  callId: "call-1",
  agentId: "agent-1",
  intentId: "intent-1",
  workingDirectory: ".",
} as const;

const withWorkspace = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "klyn-tool-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("file-tree mutations are revision-guarded and workspace-confined", async () => {
  await withWorkspace(async (root) => {
    const kernel = new HermeticToolKernel({ workspaceRoot: root });
    const createCall: HermeticToolCall = {
      ...metadata,
      tool: "file-tree",
      args: { operation: "write", path: "src/example.ts", content: "export const value = 1;\n", expectedSha256: null },
    };

    const created = await kernel.execute(createCall);
    assert.equal(created.result.path, "src/example.ts");
    assert.equal(created.result.sha256, sha256("export const value = 1;\n"));

    await assert.rejects(
      kernel.execute({
        ...createCall,
        callId: "call-2",
        args: { ...createCall.args, content: "stale", expectedSha256: "not-the-current-hash" },
      }),
      HermeticToolError,
    );

    await assert.rejects(
      kernel.execute({
        ...createCall,
        callId: "call-3",
        args: { ...createCall.args, path: "../escape.ts", expectedSha256: null },
      }),
      HermeticToolError,
    );
  });
});

test("AST patching is deterministic and audit-hashed", async () => {
  await withWorkspace(async (root) => {
    const source = "const alpha = 1;\nconst beta = 2;\n";
    await writeFile(join(root, "fixture.ts"), source, "utf8");
    const kernel = new HermeticToolKernel({ workspaceRoot: root });

    const result = await kernel.execute({
      ...metadata,
      callId: "call-ast",
      tool: "ast-patch",
      args: {
        operation: "apply-replacements",
        path: "fixture.ts",
        expectedSha256: sha256(source),
        replacements: [
          { start: source.indexOf("2"), end: source.indexOf("2") + 1, replacement: "3" },
          { start: source.indexOf("1"), end: source.indexOf("1") + 1, replacement: "4" },
        ],
      },
    });

    assert.equal(await readFile(join(root, "fixture.ts"), "utf8"), "const alpha = 4;\nconst beta = 3;\n");
    assert.equal(result.audit.sequence, 1);
    assert.equal(result.audit.requestHash.length, 64);
    assert.equal(result.audit.resultHash.length, 64);
    assert.equal(result.audit.auditHash.length, 64);
    assert.equal(result.audit.previousAuditHash, null);

    const second = await kernel.execute({
      ...metadata,
      callId: "call-read",
      tool: "file-tree",
      args: { operation: "read", path: "fixture.ts" },
    });
    assert.equal(second.audit.previousAuditHash, result.audit.auditHash);
    assert.equal(kernel.getAuditTrail().length, 2);
  });
});

test("git status is constrained to the declared workspace", async () => {
  await withWorkspace(async (root) => {
    const kernel = new HermeticToolKernel({ workspaceRoot: root });
    const result = await kernel.execute({
      ...metadata,
      callId: "call-git",
      tool: "git",
      args: { operation: "status" },
    });

    assert.equal(result.result.exitCode, 128);
    assert.match(result.result.stderr, /not a git repository/);
  });
});

test("broken symlinks cannot redirect writes outside the workspace", async () => {
  await withWorkspace(async (root) => {
    const kernel = new HermeticToolKernel({ workspaceRoot: root });
    await symlink("/tmp/klyn-outside-does-not-exist", join(root, "link.ts"));

    await assert.rejects(
      kernel.execute({
        ...metadata,
        callId: "call-broken-link",
        tool: "file-tree",
        args: { operation: "write", path: "link.ts", content: "escape", expectedSha256: null },
      }),
      HermeticToolError,
    );
  });
});

test("bash capability is disabled by default and requires explicit runtime enablement", async () => {
  await withWorkspace(async (root) => {
    const kernel = new HermeticToolKernel({ workspaceRoot: root });
    await assert.rejects(
      kernel.execute({
        ...metadata,
        callId: "call-bash-disabled",
        tool: "bash",
        args: { operation: "execute", script: "printf 'blocked'" },
      }),
      HermeticToolError,
    );

    const enabled = new HermeticToolKernel({ workspaceRoot: root, enableBash: true });
    const result = await enabled.execute({
      ...metadata,
      callId: "call-bash-enabled",
      tool: "bash",
      args: { operation: "execute", script: "printf 'ok'" },
    });
    assert.equal(result.result.stdout, "ok");
    assert.equal(result.result.timedOut, false);
  });
});
