import assert from "node:assert/strict";
import test from "node:test";
import { WarningCode, type Note } from "../src/vendor-sdk.js";
import { hash, type Call } from "starknet";
import type { ShadowConfig } from "../src/lib/config";
import {
  invokeShadowCalls,
  type InvokeShadowDependencies,
} from "../src/lib/invoke-shadow";
import { shadowAddressFromCommitment } from "../src/lib/shadow-address";

const ROOT = "0x111";
const POOL = "0x222";
const TOKEN = "0x333";
const ANONYMIZER = "0x444";
const ANONYMIZER_CLASS = "0x0536d72fdbd1674cabc20df594694f634ab33a8ab93fd13c7acbc200c997cc5";
const SHADOW_CLASS = "0x038489bd44c93ee2eb8604d3a15db60781145951ebdebe356fc824b4a0385a5c";
const RELAYER = "0x999";
const COMMITMENT = 0xabcden;
const SHADOW = shadowAddressFromCommitment(COMMITMENT, BigInt(ANONYMIZER));

const config: ShadowConfig = {
  accountAddress: ROOT,
  accountPrivateKey: "0x123",
  viewingKey: 123n,
  rpcUrl: "https://rpc.example",
  poolAddress: POOL,
  tokenAddress: TOKEN,
  anonymizerAddress: ANONYMIZER,
  proverUrl: "https://prover.example",
  discoveryUrl: "https://discovery.example",
  paymasterUrl: "https://paymaster.example",
  paymasterApiKey: "secret",
  appName: "test-app",
  nonce: 7n,
  recipientAddress: "0x777",
  spendAmount: 2n,
  shieldAmount: 20n,
  maxPaymasterFee: 5n,
};

function privateNote(amount: bigint): Note {
  return {
    amount,
    created: 10,
    open: false,
    id: amount,
    sender: 1n,
    witness: {} as Note["witness"],
  };
}

function fixture(options?: {
  warning?: boolean;
  feeAmount?: bigint;
  feeToken?: string;
  registryAfter?: string;
  deployedClass?: string;
  outerSender?: string;
  includeDeploymentEvent?: boolean;
  anonymizerClass?: string;
  boundPool?: string;
  configuredShadowClass?: string;
  screeningPolicy?: string;
}) {
  let registryReads = 0;
  let rootExecuteCalls = 0;
  let relayExecuteCalls = 0;
  let discoveryCalls = 0;
  let builtAtBlock: number | undefined;
  const actions: string[] = [];

  const provider = {
    getBlockNumber: async () => 100,
    callContract: async (call: Call) => {
      if (call.entrypoint === "get_shadow_account") {
        registryReads += 1;
        return registryReads === 1 ? ["0x0"] : [options?.registryAfter ?? SHADOW];
      }
      if (call.entrypoint === "get_shadow_account_class_hash") {
        return [options?.configuredShadowClass ?? SHADOW_CLASS];
      }
      if (call.entrypoint === "get_privacy_contract") return [options?.boundPool ?? POOL];
      if (call.entrypoint === "get_open_note_screening_policy") {
        return [options?.screeningPolicy ?? "0x0"];
      }
      throw new Error(`Unexpected call ${call.entrypoint}`);
    },
    getClassHashAt: async (address: string) => {
      if (BigInt(address) === BigInt(ANONYMIZER)) {
        return options?.anonymizerClass ?? ANONYMIZER_CLASS;
      }
      assert.equal(BigInt(address), BigInt(SHADOW));
      return options?.deployedClass ?? SHADOW_CLASS;
    },
    getTransactionByHash: async () => ({ sender_address: options?.outerSender ?? RELAYER }),
  };

  const tokenBuilder = {
    inputs: (...notes: Note[]) => actions.push(`inputs:${notes.length}`),
    withdraw: ({ recipient, amount }: { recipient: string; amount: bigint }) =>
      actions.push(`withdraw:${BigInt(recipient).toString(16)}:${amount}`),
    transfer: () => actions.push("collect"),
  };
  const builder = {
    surplusTo() {
      return this;
    },
    shadowAccounts(appName: string) {
      assert.equal(appName, config.appName);
      return {
        commitment: async (nonce: bigint) => {
          assert.equal(nonce, config.nonce);
          return COMMITMENT;
        },
        invoke: (nonce: bigint) => {
          assert.equal(nonce, config.nonce);
          actions.push("shadow-invoke");
        },
      };
    },
    with(token: string, callback: (value: typeof tokenBuilder) => void) {
      assert.equal(BigInt(token), BigInt(TOKEN));
      callback(tokenBuilder);
      return this;
    },
    execute: async () => ({
      warnings: options?.warning ? [{ code: WarningCode.USER_LINKAGE }] : [],
      callAndProof: {
        call: { contractAddress: POOL, entrypoint: "apply_actions", calldata: ["0x1"] },
        proof: { data: "0x2", proofFacts: ["0x3"] },
      },
    }),
  };
  const transfers = {
    discoverNotes: async () => {
      discoveryCalls += 1;
      return { notes: new Map([[BigInt(TOKEN), [privateNote(20n)]]]) };
    },
    build: (details: { provingBlockId: number }) => {
      builtAtBlock = details.provingBlockId;
      return builder;
    },
  };
  const account = {
    execute: async () => {
      rootExecuteCalls += 1;
      throw new Error("root account.execute must never be called");
    },
  };

  const dependencies = {
    createSdkContext: (() => ({ provider, transfers, account })) as unknown as InvokeShadowDependencies["createSdkContext"],
    createPaymaster: (() => ({
      build: async () => ({
        parameters: {
          version: "0x1" as const,
          fee_mode: {
            mode: "sponsored_private" as const,
            pool_fee_token: TOKEN,
          },
        },
        fee: {
          token: options?.feeToken ?? TOKEN,
          recipient: "0x888",
          amount: options?.feeAmount ?? 2n,
        },
      }),
      execute: async () => {
        relayExecuteCalls += 1;
        return { transactionHash: "0xfeed", trackingId: "0xabc" };
      },
    })) as InvokeShadowDependencies["createPaymaster"],
    waitForSuccessfulTransaction: (async () => ({
      block_number: 101,
      events: options?.includeDeploymentEvent === false
        ? []
        : [
            {
              from_address: ANONYMIZER,
              keys: [
                hash.getSelectorFromName("ShadowAccountDeployed"),
                `0x${COMMITMENT.toString(16)}`,
              ],
              data: [SHADOW],
            },
          ],
    })) as unknown as InvokeShadowDependencies["waitForSuccessfulTransaction"],
  } satisfies InvokeShadowDependencies;

  return {
    dependencies,
    actions,
    counts: {
      rootExecute: () => rootExecuteCalls,
      relayExecute: () => relayExecuteCalls,
      discovery: () => discoveryCalls,
      registry: () => registryReads,
    },
    builtAtBlock: () => builtAtBlock,
  };
}

test("shadow orchestration uses only the private paymaster and verifies all postconditions", async () => {
  const state = fixture();
  let effectChecks = 0;
  const result = await invokeShadowCalls(
    config,
    {
      calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: ["0x1"] }],
      fundingAmount: 3n,
      collectRemainder: true,
      verifyEffect: async ({ shadowAddress }) => {
        assert.equal(BigInt(shadowAddress), BigInt(SHADOW));
        effectChecks += 1;
      },
    },
    undefined,
    state.dependencies,
  );

  assert.equal(state.counts.rootExecute(), 0);
  assert.equal(state.counts.relayExecute(), 1);
  assert.equal(state.counts.registry(), 2);
  assert.equal(state.builtAtBlock(), 90);
  assert.equal(effectChecks, 1);
  assert.equal(result.effectVerified, true);
  assert.equal(BigInt(result.shadowAddress), BigInt(SHADOW));
  assert.deepEqual(state.actions, [
    "inputs:1",
    `withdraw:${BigInt(SHADOW).toString(16)}:3`,
    "collect",
    "withdraw:888:2",
    "shadow-invoke",
  ]);
});

test("USER_LINKAGE aborts before private relay submission", async () => {
  const state = fixture({ warning: true });
  await assert.rejects(
    invokeShadowCalls(
      config,
      {
        calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
        fundingAmount: 0n,
      },
      undefined,
      state.dependencies,
    ),
    /USER_LINKAGE/,
  );
  assert.equal(state.counts.rootExecute(), 0);
  assert.equal(state.counts.relayExecute(), 0);
});

test("excessive paymaster fees abort before note discovery and proving", async () => {
  const state = fixture({ feeAmount: config.maxPaymasterFee + 1n });
  await assert.rejects(
    invokeShadowCalls(
      config,
      {
        calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
        fundingAmount: 0n,
      },
      undefined,
      state.dependencies,
    ),
    /fee exceeds/,
  );
  assert.equal(state.counts.discovery(), 0);
  assert.equal(state.counts.relayExecute(), 0);
  assert.equal(state.counts.rootExecute(), 0);
});

test("funding never crosses the integration boundary as Number", async () => {
  const state = fixture();
  await assert.rejects(
    invokeShadowCalls(
      config,
      {
        calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
        fundingAmount: 3 as unknown as bigint,
      },
      undefined,
      state.dependencies,
    ),
    /must be a bigint/,
  );
  assert.equal(state.counts.discovery(), 0);
  assert.equal(state.counts.relayExecute(), 0);
});

test("unexpected paymaster fee token aborts before note discovery and proving", async () => {
  const state = fixture({ feeToken: "0xbad" });
  await assert.rejects(
    invokeShadowCalls(
      config,
      {
        calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
        fundingAmount: 0n,
      },
      undefined,
      state.dependencies,
    ),
    /unexpected token/,
  );
  assert.equal(state.counts.discovery(), 0);
  assert.equal(state.counts.relayExecute(), 0);
  assert.equal(state.counts.rootExecute(), 0);
});

test("runtime class drift aborts before note discovery and proving", async () => {
  const state = fixture({ anonymizerClass: "0xbad" });
  await assert.rejects(
    invokeShadowCalls(
      config,
      {
        calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
        fundingAmount: 0n,
      },
      undefined,
      state.dependencies,
    ),
    /class no longer matches/,
  );
  assert.equal(state.counts.discovery(), 0);
  assert.equal(state.counts.relayExecute(), 0);
  assert.equal(state.counts.rootExecute(), 0);
});

test("runtime storage drift aborts before note discovery and proving", async (t) => {
  const cases = [
    { name: "bound pool", options: { boundPool: "0xbad" }, expected: /not bound/ },
    {
      name: "shadow class",
      options: { configuredShadowClass: "0xbad" },
      expected: /unexpected shadow-account class/,
    },
    {
      name: "screening policy",
      options: { screeningPolicy: "0x1" },
      expected: /screening policy/,
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const state = fixture(testCase.options);
      await assert.rejects(
        invokeShadowCalls(
          config,
          {
            calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
            fundingAmount: 0n,
          },
          undefined,
          state.dependencies,
        ),
        testCase.expected,
      );
      assert.equal(state.counts.discovery(), 0);
      assert.equal(state.counts.relayExecute(), 0);
    });
  }
});

test("registry disagreement fails instead of returning an unverified result", async () => {
  const state = fixture({ registryAfter: "0xbad" });
  await assert.rejects(
    invokeShadowCalls(
      config,
      {
        calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
        fundingAmount: 0n,
      },
      undefined,
      state.dependencies,
    ),
    /registry did not resolve/,
  );
  assert.equal(state.counts.relayExecute(), 1);
  assert.equal(state.counts.rootExecute(), 0);
});

test("class, outer-sender, deployment-event, and application checks are mandatory", async (t) => {
  const cases = [
    {
      name: "deployed class",
      fixtureOptions: { deployedClass: "0xbad" },
      expected: /does not run the anonymizer's shadow-account class/,
    },
    {
      name: "outer sender",
      fixtureOptions: { outerSender: ROOT },
      expected: /root account is the outer transaction sender/,
    },
    {
      name: "fresh deployment event",
      fixtureOptions: { includeDeploymentEvent: false },
      expected: /Missing matching ShadowAccountDeployed event/,
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const state = fixture(testCase.fixtureOptions);
      await assert.rejects(
        invokeShadowCalls(
          config,
          {
            calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
            fundingAmount: 0n,
          },
          undefined,
          state.dependencies,
        ),
        testCase.expected,
      );
    });
  }

  await t.test("application effect", async () => {
    const state = fixture();
    await assert.rejects(
      invokeShadowCalls(
        config,
        {
          calls: [{ contractAddress: "0x777", entrypoint: "join", calldata: [] }],
          fundingAmount: 0n,
          verifyEffect: async () => {
            throw new Error("target effect missing");
          },
        },
        undefined,
        state.dependencies,
      ),
      /target effect missing/,
    );
  });
});
