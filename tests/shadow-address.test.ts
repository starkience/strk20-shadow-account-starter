import assert from "node:assert/strict";
import test from "node:test";
import { PRIMER_CLASS_HASH } from "../src/lib/constants";
import { normalizeAddress, shadowAddressFromCommitment } from "../src/lib/shadow-address";

const COMMITMENT = 0x418bf56bebf218ffa365531394e68b3336a9557b5b8be8ad6a21f44e79833bn;
const ANONYMIZER = 0x444n;
const EXPECTED = 0x5e1a753154c6cbb012b819c0362921b7040df54b90bb9241f54e7d946cf9708n;

test("shadow address matches the upstream Cairo/TypeScript committed vector", () => {
  assert.equal(BigInt(shadowAddressFromCommitment(COMMITMENT, ANONYMIZER)), EXPECTED);
});

test("primer and returned address stay canonical", () => {
  assert.equal(
    PRIMER_CLASS_HASH,
    0x00123e6bc1c14ae9934e933d3f64916a6116dd6b036a922b2b1f0815e0d1d300n,
  );
  assert.equal(normalizeAddress("0x000ABC"), "0xabc");
});
