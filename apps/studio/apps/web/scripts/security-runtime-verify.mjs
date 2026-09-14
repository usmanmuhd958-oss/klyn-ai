#!/usr/bin/env node

/**
 * TASK 1.1 runtime security verification.
 *
 * This runner deliberately performs live HTTP probes against a running Klyn
 * web server. It does not manufacture authentication cookies/tokens.
 *
 * Required environment:
 *   KLYN_BASE_URL       default: http://localhost:3000
 *   KLYN_USER_A_COOKIE  authenticated cookie/header value for User A
 *   KLYN_USER_B_COOKIE  authenticated cookie/header value for User B
 *   KLYN_USER_A_ID      User A UUID
 *   KLYN_USER_B_ID      User B UUID
 *   KLYN_USER_B_PROJECT project owned by User B
 *
 * Optional:
 *   KLYN_USER_A_PROJECT project owned by User A (otherwise created by case 2)
 *
 * Cookie values should be supplied exactly as accepted by the deployed app,
 * for example: "sb-<project>-auth-token=...". Do not commit secrets.
 */

const BASE = (process.env.KLYN_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const A_COOKIE = process.env.KLYN_USER_A_COOKIE;
const B_COOKIE = process.env.KLYN_USER_B_COOKIE;
const A_ID = process.env.KLYN_USER_A_ID;
const B_ID = process.env.KLYN_USER_B_ID;
const B_PROJECT = process.env.KLYN_USER_B_PROJECT;

let failures = 0;
let aProject = process.env.KLYN_USER_A_PROJECT || null;
let aArtifact = null;

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  let body = null;
  const text = await response.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

function auth(cookie) {
  return { Cookie: cookie };
}

function assertStatus(label, actual, expected) {
  if (actual !== expected) {
    failures++;
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    return false;
  }
  console.log(`PASS ${label}: ${actual}`);
  return true;
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    failures++;
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    return false;
  }
  console.log(`PASS ${label}: ${actual}`);
  return true;
}

async function main() {
  for (const [name, value] of Object.entries({
    KLYN_USER_A_COOKIE: A_COOKIE,
    KLYN_USER_B_COOKIE: B_COOKIE,
    KLYN_USER_A_ID: A_ID,
    KLYN_USER_B_ID: B_ID,
    KLYN_USER_B_PROJECT: B_PROJECT,
  })) requireEnv(name, value);

  console.log(`\nTASK 1.1 SECURITY RUNTIME VERIFICATION`);
  console.log(`BASE=${BASE}`);

  console.log("\nCASE 1 — Unauthenticated probes");
  await assertStatus("POST /api/projects", (await request("/api/projects", {
    method: "POST", body: JSON.stringify({ name: "unauthenticated-probe" })
  })).status, 401);
  await assertStatus("GET /api/artifacts", (await request("/api/artifacts?projectId=probe")).status, 401);
  await assertStatus("POST /api/artifacts", (await request("/api/artifacts", {
    method: "POST", body: JSON.stringify({ projectId: "probe", filename: "x", language: "txt", content: "x" })
  })).status, 401);
  await assertStatus("GET /api/graph", (await request("/api/graph?projectId=probe")).status, 401);
  await assertStatus("POST /api/graph", (await request("/api/graph", {
    method: "POST", body: JSON.stringify({ projectId: "probe", nodes: [], edges: [] })
  })).status, 401);

  console.log("\nCASE 2 — Identity forgery mitigation");
  const forged = await request("/api/projects", {
    method: "POST",
    headers: auth(A_COOKIE),
    body: JSON.stringify({ userId: B_ID, name: "Malicious Project" }),
  });
  if (assertStatus("POST /api/projects with forged userId", forged.status, 201)) {
    aProject = forged.body?.id || null;
    assertEqual("created project user_id", forged.body?.user_id, A_ID);
    if (forged.body?.user_id === B_ID) failures++;
  }

  if (!aProject) throw new Error("Case 2 did not return a project id; cannot continue owner tests.");

  console.log("\nCASE 3 — Cross-tenant access denial");
  await assertStatus("GET /api/artifacts as User A on User B project", (await request(
    `/api/artifacts?projectId=${encodeURIComponent(B_PROJECT)}`,
    { headers: auth(A_COOKIE) }
  )).status, 403);
  await assertStatus("POST /api/artifacts as User A on User B project", (await request("/api/artifacts", {
    method: "POST", headers: auth(A_COOKIE),
    body: JSON.stringify({ projectId: B_PROJECT, filename: "cross-tenant.txt", language: "txt", content: "denied" })
  })).status, 403);
  await assertStatus("GET /api/graph as User A on User B project", (await request(
    `/api/graph?projectId=${encodeURIComponent(B_PROJECT)}`,
    { headers: auth(A_COOKIE) }
  )).status, 403);
  await assertStatus("POST /api/graph as User A on User B project", (await request("/api/graph", {
    method: "POST", headers: auth(A_COOKIE),
    body: JSON.stringify({ projectId: B_PROJECT, nodes: [], edges: [] })
  })).status, 403);

  console.log("\nCASE 4 — Authorized owner execution");
  const createdArtifact = await request("/api/artifacts", {
    method: "POST", headers: auth(A_COOKIE),
    body: JSON.stringify({ projectId: aProject, filename: "owner.txt", language: "text", content: "owner-write" })
  });
  if (assertStatus("POST /api/artifacts owner", createdArtifact.status, 201)) {
    aArtifact = createdArtifact.body?.id || null;
  }
  await assertStatus("GET /api/artifacts owner", (await request(
    `/api/artifacts?projectId=${encodeURIComponent(aProject)}`,
    { headers: auth(A_COOKIE) }
  )).status, 200);
  await assertStatus("POST /api/graph owner", (await request("/api/graph", {
    method: "POST", headers: auth(A_COOKIE),
    body: JSON.stringify({
      projectId: aProject,
      nodes: [{ id: "security-test-node", type: "test", position: { x: 10, y: 20 }, data: { verified: true } }],
      edges: []
    })
  })).status, 200);
  await assertStatus("GET /api/graph owner", (await request(
    `/api/graph?projectId=${encodeURIComponent(aProject)}`,
    { headers: auth(A_COOKIE) }
  )).status, 200);
  if (aArtifact) {
    await assertStatus("DELETE /api/artifacts owner", (await request("/api/artifacts", {
      method: "DELETE", headers: auth(A_COOKIE),
      body: JSON.stringify({ projectId: aProject, artifactId: aArtifact })
    })).status, 200);
  }

  console.log("\nCASE 5 — Stripe webhook isolation");
  const webhook = await request("/api/stripe/webhook", {
    method: "POST",
    body: "{}",
  });
  // Missing signature must be rejected by the Stripe boundary. Accept 400/401
  // as implementation-specific rejection, but never accept 2xx.
  if (webhook.status >= 200 && webhook.status < 300) {
    failures++;
    console.error(`FAIL Stripe webhook without signature: unexpectedly accepted ${webhook.status}`);
  } else {
    console.log(`PASS Stripe webhook without signature rejected: ${webhook.status}`);
  }

  console.log(`\nRESULT: ${failures === 0 ? "PASS" : "FAIL"}`);
  if (failures !== 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("SECURITY TEST RUNNER ERROR:", error.message);
  process.exitCode = 2;
});
