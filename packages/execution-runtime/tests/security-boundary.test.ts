import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SecretMasker, ResourceBoundaryEnforcer, ResourceBoundaryViolation } from "../src/index.ts";

test("environment authorization is fail closed", () => {
  const masker = new SecretMasker();
  assert.deepEqual(masker.maskEnvironment({ PATH: "/bin", SAFE: "1", API_TOKEN: "secret" }, []), {});
  assert.deepEqual(masker.maskEnvironment({ PATH: "/bin", SAFE: "1", API_TOKEN: "secret" }, ["PATH", "API_TOKEN"]), { PATH: "/bin" });
});

test("workspace authorization rejects an empty allowlist", () => {
  const enforcer = new ResourceBoundaryEnforcer();
  assert.throws(() => enforcer.authorizedWorkspace(process.cwd()), ResourceBoundaryViolation);
});

test("workspace authorization canonicalizes roots before comparison", () => {
  const root = process.cwd();
  const enforcer = new ResourceBoundaryEnforcer({
    maxMemoryMb: 128,
    maxCpuMs: 1000,
    maxFileDescriptors: 64,
    maxExecutionMs: 1000,
    authorizedWorkspaces: [root],
  });
  assert.equal(enforcer.authorizedWorkspace(root), root);
});
