import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "starknet";
import {
  PaymasterSubmissionUnknownError,
  PrivatePaymaster,
} from "../src/lib/private-paymaster";

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
      result: { transaction_hash: "0xfeed", tracking_id: "0xabc" },
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
  assert.deepEqual(result, { transactionHash: "0xfeed", trackingId: "0xabc" });
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

test("paymaster pool probe uses credential-free default mode without changing submission mode", async () => {
  let request: Record<string, unknown> | undefined;
  let headers: Headers | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    headers = new Headers(init?.headers);
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: {
        fee_action: { type: "withdraw", token: "0xabc", recipient: "0x456", amount: "3" },
      },
    });
  };
  const paymaster = new PrivatePaymaster("https://paymaster.example", "", fakeFetch);

  const fee = await paymaster.probePool("0x123", "0xabc");

  assert.equal(fee?.amount, 3n);
  assert.equal(headers?.has("x-paymaster-api-key"), false);
  assert.deepEqual(request, {
    jsonrpc: "2.0",
    id: 1,
    method: "paymaster_buildTransaction",
    params: {
      transaction: {
        type: "apply_action",
        apply_action: { pool_address: "0x123" },
      },
      parameters: {
        version: "0x1",
        fee_mode: { mode: "default", gas_token: "0xabc" },
      },
    },
  });
});

test("private paymaster never reflects a remote error message containing secrets", async () => {
  const secret = "do-not-reflect-this-api-key";
  const fakeFetch: typeof fetch = async () => Response.json(
    {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: `bad credential ${secret}` },
    },
    { status: 401 },
  );
  const paymaster = new PrivatePaymaster("https://paymaster.example", secret, fakeFetch);

  await assert.rejects(
    paymaster.build("0x123", "0xabc"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.match(error.message, /code -32000/);
      return true;
    },
  );
});

test("transport loss during relay submission is reported as unknown, not safe to retry", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    }
    throw new Error("socket closed");
  };
  const paymaster = new PrivatePaymaster("https://paymaster.example", "secret", fakeFetch);
  const built = await paymaster.build("0x123", "0xabc");

  await assert.rejects(
    paymaster.execute({
      poolAddress: "0x123",
      call: { contractAddress: "0x789", entrypoint: "apply_actions", calldata: [] },
      proof: "0x3",
      proofFacts: [],
      build: built,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PaymasterSubmissionUnknownError);
      assert.equal(error.trackingId, undefined);
      assert.equal(error.transactionHash, undefined);
      return true;
    },
  );
});

test("gateway HTTP failure after relay submission is unknown without a JSON-RPC decision", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return calls === 1
      ? Response.json({ jsonrpc: "2.0", id: 1, result: {} })
      : Response.json({}, { status: 502 });
  };
  const paymaster = new PrivatePaymaster("https://paymaster.example", "secret", fakeFetch);
  const built = await paymaster.build("0x123", "0xabc");

  await assert.rejects(
    paymaster.execute({
      poolAddress: "0x123",
      call: { contractAddress: "0x789", entrypoint: "apply_actions", calldata: [] },
      proof: "0x3",
      proofFacts: [],
      build: built,
    }),
    PaymasterSubmissionUnknownError,
  );
});

test("tracking ID reconciliation returns the relay's latest transaction", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { transaction_hash: "0xfeed", status: "accepted" },
    });
  };
  const paymaster = new PrivatePaymaster("https://paymaster.example", "secret", fakeFetch);
  const result = await paymaster.reconcile("0xabc");

  assert.deepEqual(result, { transactionHash: "0xfeed", status: "accepted" });
  assert.deepEqual(requests[0], {
    jsonrpc: "2.0",
    id: 1,
    method: "paymaster_trackingIdToLatestHash",
    params: { tracking_id: "0xabc" },
  });
});

test("malformed success response after relay submission is also unknown", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: calls === 1 ? {} : { tracking_id: "0xabc" },
    });
  };
  const paymaster = new PrivatePaymaster("https://paymaster.example", "secret", fakeFetch);
  const built = await paymaster.build("0x123", "0xabc");

  await assert.rejects(
    paymaster.execute({
      poolAddress: "0x123",
      call: { contractAddress: "0x789", entrypoint: "apply_actions", calldata: [] },
      proof: "0x3",
      proofFacts: [],
      build: built,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PaymasterSubmissionUnknownError);
      assert.equal(error.trackingId, "0xabc");
      assert.equal(error.transactionHash, undefined);
      return true;
    },
  );
});
