import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "starknet";
import { PrivatePaymaster } from "../src/lib/private-paymaster";

test("private paymaster builds a fee action and submits only the pool proof", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    if (body.method === "paymaster_buildTransaction") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          fee_action: { type: "withdraw", token: "0xabc", recipient: "0x456", amount: "3" },
        },
      });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { transaction_hash: "0xfeed", tracking_id: "track-1" },
    });
  };
  const paymaster = new PrivatePaymaster("https://paymaster.example", "secret", fakeFetch);
  const built = await paymaster.build("0x123", "0xabc");
  assert.equal(built.fee?.amount, 3n);
  const result = await paymaster.execute({
    poolAddress: "0x123",
    call: { contractAddress: "0x789", entrypoint: "apply_actions", calldata: ["1", "2"] },
    proof: "0x3",
    proofFacts: ["0x4"],
    build: built,
  });
  assert.deepEqual(result, { transactionHash: "0xfeed", trackingId: "track-1" });
  assert.deepEqual(requests[1], {
    jsonrpc: "2.0",
    id: 1,
    method: "paymaster_executeTransaction",
    params: {
      transaction: {
        type: "apply_action",
        apply_action: {
          pool_address: "0x123",
          apply_actions_call: {
            to: "0x789",
            selector: hash.getSelectorFromName("apply_actions"),
            calldata: ["0x1", "0x2"],
          },
          proof: "0x3",
          proof_facts: ["0x4"],
        },
      },
      parameters: {
        version: "0x1",
        fee_mode: { mode: "sponsored_private", pool_fee_token: "0xabc" },
      },
    },
  });
});
