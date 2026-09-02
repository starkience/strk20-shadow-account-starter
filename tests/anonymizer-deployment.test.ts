import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "starknet";
import compatibility from "../compatibility.json" with { type: "json" };
import {
  buildAnonymizerFinalizationCalls,
  calculateAnonymizerAddress,
  hasImplementationFinalizedEvent,
  isContractNotFound,
  UPGRADE_GOVERNOR_ROLE,
} from "../scripts/anonymizer-deployment";

test("UDC address formula reproduces the recorded Sepolia deployment", () => {
  const address = calculateAnonymizerAddress({
    salt: compatibility.anonymizerDeploymentSalt,
    classHash: compatibility.shadowAccountAnonymizerClassHash,
    poolAddress: compatibility.poolAddress,
    shadowAccountClassHash: compatibility.shadowAccountClassHash,
    governanceAdmin: compatibility.anonymizerGovernanceAdmin,
  });
  assert.equal(BigInt(address), BigInt(compatibility.shadowAccountAnonymizerAddress));
});

test("finalization detection binds event source and finalized class", () => {
  const event = {
    from_address: compatibility.shadowAccountAnonymizerAddress,
    keys: [hash.getSelectorFromName("ImplementationFinalized")],
    data: [compatibility.shadowAccountAnonymizerClassHash],
  };
  assert.equal(
    hasImplementationFinalizedEvent(
      [event],
      compatibility.shadowAccountAnonymizerAddress,
      compatibility.shadowAccountAnonymizerClassHash,
    ),
    true,
  );
  assert.equal(
    hasImplementationFinalizedEvent(
      [{ ...event, from_address: "0x1" }],
      compatibility.shadowAccountAnonymizerAddress,
      compatibility.shadowAccountAnonymizerClassHash,
    ),
    false,
  );
  assert.equal(
    hasImplementationFinalizedEvent(
      [{ ...event, data: ["0x1"] }],
      compatibility.shadowAccountAnonymizerAddress,
      compatibility.shadowAccountAnonymizerClassHash,
    ),
    false,
  );
});

test("finalization grants the pinned upgrade role only for the atomic upgrade", () => {
  const address = compatibility.shadowAccountAnonymizerAddress;
  const classHash = compatibility.shadowAccountAnonymizerClassHash;
  const admin = compatibility.anonymizerGovernanceAdmin;
  const calls = buildAnonymizerFinalizationCalls(address, classHash, admin);

  assert.deepEqual(calls.map((call) => call.entrypoint), [
    "grant_role",
    "add_new_implementation_unsafe",
    "replace_to",
    "revoke_role",
  ]);
  assert.deepEqual(calls[0]?.calldata, [UPGRADE_GOVERNOR_ROLE, admin]);
  assert.deepEqual(calls[1]?.calldata, [classHash, "0x1", "0x1"]);
  assert.deepEqual(calls[2]?.calldata, [classHash, "0x1", "0x1"]);
  assert.deepEqual(calls[3]?.calldata, [UPGRADE_GOVERNOR_ROLE, admin]);
  assert.equal(
    BigInt(UPGRADE_GOVERNOR_ROLE),
    hash.starknetKeccak("ROLE_UPGRADE_GOVERNOR"),
  );
});

test("only Starknet contract-not-found RPC code is safe to treat as absent", () => {
  assert.equal(isContractNotFound({ code: 20 }), true);
  assert.equal(isContractNotFound({ baseError: { code: 20 } }), true);
  assert.equal(isContractNotFound({ baseError: { code: 500 } }), false);
  assert.equal(isContractNotFound(new Error("network unavailable")), false);
});
