import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

assert.ok(url, "SUPABASE_URL must point to the disposable local Supabase stack");
assert.ok(anonKey, "SUPABASE_ANON_KEY must be set from local Supabase status");
assert.ok(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY must be set from local Supabase status");

const authOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
};

const admin = createClient(url, serviceRoleKey, authOptions);
const suffix = randomUUID();
const password = `Klyn-CI-${randomUUID()}-Aa9!`;
const userIds = [];
const organizationIds = [];
const membershipIds = [];

function assertNoError(error, operation) {
  if (error) {
    // Deliberately do not print URLs, tokens, headers, or the secret-bearing client config.
    throw new Error(`${operation} failed (code=${error.code ?? "unknown"}): ${error.message}`);
  }
}

async function createSyntheticUser(label) {
  const email = `klyn-ci-${label}-${suffix}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "ephemeral-klyn-tenant-isolation-ci" }
  });
  assertNoError(error, `create synthetic user ${label}`);
  assert.ok(data.user?.id, "synthetic auth user should have an id");
  userIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function createOrganization(name, ownerId) {
  const { data, error } = await admin
    .from("organizations")
    .insert({ name, owner_id: ownerId })
    .select("id")
    .single();
  assertNoError(error, `create synthetic organization ${name}`);
  assert.ok(data?.id, "organization should have an id");
  organizationIds.push(data.id);
  return data;
}

async function createMembership(orgId, userId, role) {
  const { data, error } = await admin
    .from("team_members")
    .insert({ org_id: orgId, user_id: userId, role })
    .select("id")
    .single();
  assertNoError(error, "create synthetic membership");
  assert.ok(data?.id, "membership should have an id");
  membershipIds.push(data.id);
  return data;
}

try {
  const userA = await createSyntheticUser("a");
  const userB = await createSyntheticUser("b");
  const orgA = await createOrganization("Klyn CI tenant A", userA.id);
  const orgB = await createOrganization("Klyn CI tenant B", userB.id);
  const memberA = await createMembership(orgA.id, userA.id, "admin");
  const memberB = await createMembership(orgB.id, userB.id, "user");

  const clientA = createClient(url, anonKey, authOptions);
  const clientB = createClient(url, anonKey, authOptions);

  const signedA = await clientA.auth.signInWithPassword({ email: userA.email, password });
  assertNoError(signedA.error, "sign in synthetic tenant A");
  const signedB = await clientB.auth.signInWithPassword({ email: userB.email, password });
  assertNoError(signedB.error, "sign in synthetic tenant B");

  const ownOrg = await clientA.from("organizations").select("id").eq("id", orgA.id);
  assertNoError(ownOrg.error, "tenant A read own organization");
  assert.deepEqual((ownOrg.data ?? []).map((row) => row.id), [orgA.id]);

  const crossOrg = await clientA.from("organizations").select("id").eq("id", orgB.id);
  assertNoError(crossOrg.error, "tenant A cross-tenant organization read");
  assert.equal((crossOrg.data ?? []).length, 0, "tenant A must not read tenant B organization");

  const ownMembers = await clientA.from("team_members").select("id").eq("org_id", orgA.id);
  assertNoError(ownMembers.error, "tenant A read own team memberships");
  assert.ok((ownMembers.data ?? []).some((row) => row.id === memberA.id));

  const crossMembers = await clientA.from("team_members").select("id").eq("org_id", orgB.id);
  assertNoError(crossMembers.error, "tenant A cross-tenant membership read");
  assert.equal((crossMembers.data ?? []).length, 0, "tenant A must not read tenant B memberships");

  const deniedInsert = await clientA
    .from("team_members")
    .insert({ org_id: orgB.id, user_id: userA.id, role: "user" })
    .select("id");
  assert.ok(deniedInsert.error, "cross-tenant team_members INSERT must be denied");

  const deniedUpdate = await clientA
    .from("team_members")
    .update({ role: "admin" })
    .eq("id", memberB.id)
    .select("id");
  assertNoError(deniedUpdate.error, "tenant A cross-tenant membership update probe");
  assert.equal((deniedUpdate.data ?? []).length, 0, "tenant A must not update tenant B membership");

  const memberBCheck = await admin.from("team_members").select("role").eq("id", memberB.id).single();
  assertNoError(memberBCheck.error, "verify tenant B membership was unchanged");
  assert.equal(memberBCheck.data.role, "user");

  console.log("PASS: synthetic tenant isolation for organizations and team_members.");
} finally {
  if (membershipIds.length) {
    const { error } = await admin.from("team_members").delete().in("id", membershipIds);
    if (error) console.error("Cleanup warning: a synthetic membership could not be removed.");
  }

  if (organizationIds.length) {
    const { error } = await admin.from("organizations").delete().in("id", organizationIds);
    if (error) console.error("Cleanup warning: a synthetic organization could not be removed.");
  }

  for (const id of userIds.reverse()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error("Cleanup warning: a synthetic Auth user could not be removed.");
  }
}
