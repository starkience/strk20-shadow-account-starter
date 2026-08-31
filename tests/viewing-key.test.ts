import assert from "node:assert/strict";
import test from "node:test";
import { ec } from "starknet";
import { deriveDevelopmentViewingKey } from "../src/lib/viewing-key";

test("development viewing key derivation is deterministic and in range", () => {
  const first = deriveDevelopmentViewingKey("0x1", "0x123");
  const second = deriveDevelopmentViewingKey("0x1", "0x123");
  assert.equal(first, second);
  assert.ok(first > 0n);
  assert.ok(first < (ec.starkCurve.CURVE.n >> 1n));
});
