import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv } from "./env.js";

test("loadEnv accepts the backend secret contract", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "7860",
    JWT_SECRET: "j".repeat(32),
    ADMIN_PASSWORD: "a".repeat(12),
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    OPENAI_API_KEY: "openai-key",
    ANTHROPIC_API_KEY: "anthropic-key",
    GEMINI_API_KEY: "gemini-key"
  });

  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.PORT, 7860);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "service-role-key");
});

test("loadEnv rejects weak required secrets", () => {
  assert.throws(
    () =>
      loadEnv({
        NODE_ENV: "test",
        JWT_SECRET: "too-short",
        ADMIN_PASSWORD: "too-short"
      }),
    /Invalid environment configuration/
  );
});
