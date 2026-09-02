import assert from "node:assert/strict";
import test from "node:test";
import { constants, type RpcProvider } from "starknet";
import type { ProofInvocation } from "../src/vendor-sdk.js";
import {
  StarkscanProofDeliveryUnknownError,
  StarkscanProofProvider,
  StarkscanProverError,
} from "../src/lib/starkscan-prover";

const ENDPOINT = "https://api.starkscan.co/v1/SN_SEPOLIA/prove";
const POOL = "0x0254";
const INVOCATION = {
  type: "INVOKE",
  sender_address: POOL,
  calldata: ["0x1"],
  signature: ["0x2", "0x3"],
  nonce: "0x0",
  resource_bounds: {
    l1_gas: { max_amount: "0x1", max_price_per_unit: "0x0" },
    l2_gas: { max_amount: "0x1", max_price_per_unit: "0x0" },
    l1_data_gas: { max_amount: "0x1", max_price_per_unit: "0x0" },
  },
  tip: "0x0",
  paymaster_data: [],
  account_deployment_data: [],
  nonce_data_availability_mode: "L1",
  fee_data_availability_mode: "L1",
  version: "0x3",
} as ProofInvocation;

function result() {
  return {
    proof: "base64-proof",
    proof_facts: ["0xfact"],
    l2_to_l1_messages: [
      { from_address: "0x999", to_address: "0x0", payload: ["0xdead"] },
      { from_address: POOL, to_address: "0x0", payload: ["0xclass", "0xaction"] },
    ],
    additional_data: {
      signature: { issued_at: 1_700_000_000, sig_r: "0x1", sig_s: "0x2" },
    },
  };
}

function job(
  status: "queued" | "dispatched" | "succeeded" | "failed" | "unavailable" | "unknown_delivery",
  extra: Record<string, unknown> = {},
) {
  return {
    jobId: "prv_test123",
    status,
    terminal: ["succeeded", "failed", "unavailable", "unknown_delivery"].includes(status),
    pollAfterSeconds: 0,
    ...extra,
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provider(
  fetchImplementation: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof StarkscanProofProvider>[0]> = {},
) {
  return new StarkscanProofProvider(
    {
      endpoint: ENDPOINT,
      apiKey: "starkscan-secret",
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      rpcUrl: "https://rpc.example",
      poolAddress: POOL,
      jobTimeoutMs: 5_000,
      ...overrides,
    },
    {
      fetch: fetchImplementation,
      sleep: async () => {},
      idempotencyKey: () => "00000000-0000-4000-8000-000000000000",
      nonceProvider: {
        getNonceForAddress: async () => "0x7",
      } as Pick<RpcProvider, "getNonceForAddress">,
    },
  );
}

test("Starkscan provider polls an asynchronous job and maps the pool proof", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const replies = [job("queued"), job("dispatched"), job("succeeded", { result: result() })];
  const prover = provider((async (input, init) => {
    requests.push({ url: String(input), init });
    return response(replies.shift());
  }) as typeof fetch);

  const proof = await prover.prove(INVOCATION, 90);

  assert.equal(proof.data, "base64-proof");
  assert.deepEqual(proof.proofFacts, ["0xfact"]);
  assert.deepEqual(proof.output, ["0xclass", "0xaction"]);
  assert.equal(proof.additionalData?.signature?.issued_at, 1_700_000_000);
  assert.deepEqual(requests.map(({ url }) => url), [ENDPOINT, `${ENDPOINT}/prv_test123`, `${ENDPOINT}/prv_test123`]);
  assert.equal(requests[0]?.init?.method, "POST");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("X-Starkscan-Api-Key"), "starkscan-secret");
  assert.equal(headers.get("Idempotency-Key"), "00000000-0000-4000-8000-000000000000");
  const body = JSON.parse(String(requests[0]?.init?.body)) as { block_id: unknown };
  assert.deepEqual(body.block_id, { block_number: 90 });
});

test("Starkscan provider retries a lost submit response with the same idempotency key", async () => {
  const requests: RequestInit[] = [];
  const prover = provider((async (_input, init) => {
    requests.push(init ?? {});
    if (requests.length === 1) throw new TypeError("connection lost");
    return response(job("succeeded", { result: result() }), 201);
  }) as typeof fetch);

  await prover.prove(INVOCATION, 90);

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.body, requests[1]?.body);
  assert.equal(
    new Headers(requests[0]?.headers).get("Idempotency-Key"),
    new Headers(requests[1]?.headers).get("Idempotency-Key"),
  );
});

test("Starkscan idempotency survives a backend restart for the same proof request", async () => {
  const keys: string[] = [];
  const options = {
    endpoint: ENDPOINT,
    apiKey: "starkscan-secret",
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    rpcUrl: "https://rpc.example",
    poolAddress: POOL,
  } as const;
  const dependencies = {
    fetch: (async (_input: URL | RequestInfo, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return response(job("succeeded", { result: result() }));
    }) as typeof fetch,
    nonceProvider: {
      getNonceForAddress: async () => "0x7",
    } as Pick<RpcProvider, "getNonceForAddress">,
  };

  await new StarkscanProofProvider(options, dependencies).prove(INVOCATION, 90);
  await new StarkscanProofProvider(options, dependencies).prove(INVOCATION, 90);
  await new StarkscanProofProvider(options, dependencies).prove(INVOCATION, 91);

  assert.match(keys[0] ?? "", /^shadow-[0-9a-f]{64}$/);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("Starkscan unavailable jobs are retried under the original idempotency key", async () => {
  const keys: string[] = [];
  const replies = [
    job("unavailable", { error: { code: "prover_unavailable" } }),
    job("succeeded", { result: result() }),
  ];
  const prover = provider((async (_input, init) => {
    keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
    return response(replies.shift());
  }) as typeof fetch);

  await prover.prove(INVOCATION, 90);
  assert.deepEqual(keys, [
    "00000000-0000-4000-8000-000000000000",
    "00000000-0000-4000-8000-000000000000",
  ]);
});

test("Starkscan submission honors Retry-After without changing the logical job", async () => {
  const keys: string[] = [];
  const waits: number[] = [];
  let requests = 0;
  const prover = new StarkscanProofProvider(
    {
      endpoint: ENDPOINT,
      apiKey: "starkscan-secret",
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      rpcUrl: "https://rpc.example",
      poolAddress: POOL,
      jobTimeoutMs: 5_000,
    },
    {
      fetch: (async (_input, init) => {
        requests += 1;
        keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
        if (requests === 1) {
          return new Response(JSON.stringify({ error: { code: "prover_queue_full" } }), {
            status: 503,
            headers: { "retry-after": "2" },
          });
        }
        return response(job("succeeded", { result: result() }));
      }) as typeof fetch,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      now: () => 0,
      idempotencyKey: () => "00000000-0000-4000-8000-000000000000",
      nonceProvider: {
        getNonceForAddress: async () => "0x7",
      } as Pick<RpcProvider, "getNonceForAddress">,
    },
  );

  await prover.prove(INVOCATION, 90);
  assert.deepEqual(waits, [2_000]);
  assert.deepEqual(keys, [
    "00000000-0000-4000-8000-000000000000",
    "00000000-0000-4000-8000-000000000000",
  ]);
});

test("Starkscan unknown delivery is terminal and never resubmitted", async () => {
  let requests = 0;
  const prover = provider((async () => {
    requests += 1;
    return response(job("unknown_delivery", {
      error: { code: "prover_delivery_unknown", message: "do not expose" },
    }));
  }) as typeof fetch);

  await assert.rejects(
    prover.prove(INVOCATION, 90),
    (error: unknown) =>
      error instanceof StarkscanProofDeliveryUnknownError && error.jobId === "prv_test123",
  );
  assert.equal(requests, 1);
});

test("Starkscan errors do not reflect remote messages or API keys", async () => {
  const prover = provider((async () => response({
    error: {
      code: "invalid_request",
      message: "request contained starkscan-secret",
    },
  }, 400)) as typeof fetch);

  await assert.rejects(
    prover.prove(INVOCATION, 90),
    (error: unknown) => {
      assert.ok(error instanceof StarkscanProverError);
      assert.equal(error.details.httpStatus, 400);
      assert.equal(error.details.code, "invalid_request");
      assert.doesNotMatch(error.message, /starkscan-secret|request contained/);
      return true;
    },
  );
});

test("Starkscan API keys are not enumerable provider state", () => {
  const prover = provider((async () => response(job("succeeded", { result: result() }))) as typeof fetch);
  assert.doesNotMatch(JSON.stringify(prover), /starkscan-secret/);
});

test("Starkscan proving requires an explicit block", async () => {
  let requests = 0;
  const prover = provider((async () => {
    requests += 1;
    return response(job("succeeded", { result: result() }));
  }) as typeof fetch);

  await assert.rejects(prover.prove(INVOCATION), /explicit finalized block/);
  await assert.rejects(prover.prove(INVOCATION, "latest"), /explicit block/);
  assert.equal(requests, 0);
});

test("Starkscan provider caches and invalidates the pool nonce", async () => {
  let nonceReads = 0;
  const prover = new StarkscanProofProvider(
    {
      endpoint: ENDPOINT,
      apiKey: "starkscan-secret",
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      rpcUrl: "https://rpc.example",
      poolAddress: POOL,
    },
    {
      fetch: (async () => response(job("succeeded", { result: result() }))) as typeof fetch,
      nonceProvider: {
        getNonceForAddress: async () => {
          nonceReads += 1;
          return "0x7";
        },
      } as Pick<RpcProvider, "getNonceForAddress">,
    },
  );

  const details = await prover.getDefaultDetails();
  assert.equal(details.nonce, 7n);
  assert.equal(details.chainId, constants.StarknetChainId.SN_SEPOLIA);
  assert.equal(details.tip, 0n);
  assert.equal(details.resourceBounds?.l2_gas.max_amount, 100_000_000n);
  assert.equal((await prover.getDefaultDetails()).nonce, 7n);
  assert.equal(nonceReads, 1);
  prover.invalidateNonceCache();
  assert.equal((await prover.getDefaultDetails()).nonce, 7n);
  assert.equal(nonceReads, 2);
});
