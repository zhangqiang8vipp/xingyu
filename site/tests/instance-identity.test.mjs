import assert from "node:assert/strict";
import test from "node:test";
import { assertStoredInstanceIdentity, requireRuntimeInstanceIdentity } from "../db/instance-identity.ts";

test("correct runtime and D1 instance identity passes", () => {
  const runtime = requireRuntimeInstanceIdentity("beta", "beta:alice");
  assert.doesNotThrow(() => assertStoredInstanceIdentity(runtime, new Map([
    ["app_environment", "beta"],
    ["instance_id", "beta:alice"],
  ])));
});

test("Alice runtime rejects Bob D1", () => {
  const runtime = requireRuntimeInstanceIdentity("beta", "beta:alice");
  assert.throws(() => assertStoredInstanceIdentity(runtime, new Map([
    ["app_environment", "beta"],
    ["instance_id", "beta:bob"],
  ])), /instance mismatch.*beta:alice.*beta:bob/i);
});

test("beta and production identities cannot be reused across environments", () => {
  assert.throws(
    () => requireRuntimeInstanceIdentity("beta", "production:alice"),
    /namespaced as beta:/i,
  );
  const beta = requireRuntimeInstanceIdentity("beta", "beta:alice");
  assert.throws(() => assertStoredInstanceIdentity(beta, new Map([
    ["app_environment", "production"],
    ["instance_id", "production:alice"],
  ])), /environment mismatch.*beta.*production/i);
});

test("missing runtime or persisted identity fails closed", () => {
  assert.throws(() => requireRuntimeInstanceIdentity("beta", undefined), /INSTANCE_ID is required/);
  const runtime = requireRuntimeInstanceIdentity("beta", "beta:alice");
  assert.throws(() => assertStoredInstanceIdentity(runtime, new Map([
    ["app_environment", "beta"],
  ])), /instance identity is missing/i);
});
