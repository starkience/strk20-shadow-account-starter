import assert from "node:assert/strict";
import test from "node:test";
import { toPublicInvocationError } from "../src/lib/api-error";
import { PaymasterSubmissionUnknownError } from "../src/lib/private-paymaster";

test("API errors do not reflect unknown messages or key material", () => {
  const signingKey = "0xprivate-signing-key";
  const viewingKey = "123456789-secret-viewing-key";
  const apiKey = "secret-paymaster-key";
  const result = toPublicInvocationError(
    new Error(`prover request included ${signingKey} ${viewingKey} ${apiKey}`),
  );

  assert.equal(result.code, "INVOCATION_FAILED");
  assert.doesNotMatch(result.message, /private-signing-key|secret-viewing-key|secret-paymaster-key/);
});

test("submission uncertainty is explicit and never marked retryable", () => {
  const result = toPublicInvocationError(new PaymasterSubmissionUnknownError({
    trackingId: "0xabc",
    transactionHash: "0xfeed",
  }));
  assert.equal(result.code, "SUBMISSION_UNKNOWN");
  assert.equal(result.retryable, false);
  assert.match(result.message, /Reconcile/);
  assert.equal(result.trackingId, "0xabc");
  assert.equal(result.transactionHash, "0xfeed");
});

test("safe actionable balance errors remain useful", () => {
  const message =
    "Not enough mature shielded STRK. Need 3, mature 0, total 3. Run pnpm shadow:shield or wait for note maturity.";
  const result = toPublicInvocationError(new Error(message));
  assert.equal(result.code, "PRIVATE_BALANCE_NOT_READY");
  assert.equal(result.message, message);
  assert.equal(result.retryable, true);
});
