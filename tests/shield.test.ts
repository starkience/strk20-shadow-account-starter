import assert from "node:assert/strict";
import test from "node:test";
import type { RpcProvider } from "starknet";
import { waitForShieldingProvingBlock } from "../src/lib/shield";

const state = {
  accountAddress: "0x1",
  tokenAddress: "0x2",
  poolAddress: "0x3",
};

test("shielding waits for balance and allowance at the actual proving block", async () => {
  const heads = [20, 21];
  const reads: Array<{ entrypoint: string; block: number }> = [];
  const provider = {
    getBlockNumber: async () => heads.shift() ?? 21,
    callContract: async (
      call: { entrypoint: string },
      blockIdentifier?: number | string,
    ) => {
      const block = Number(blockIdentifier);
      reads.push({ entrypoint: call.entrypoint, block });
      const value = call.entrypoint === "get_fee_amount"
        ? 1n
        : call.entrypoint === "balanceOf"
          ? 20n
          : block === 10
            ? 0n
            : 20n;
      return [`0x${value.toString(16)}`, "0x0"];
    },
  } as unknown as Pick<RpcProvider, "getBlockNumber" | "callContract">;

  const block = await waitForShieldingProvingBlock(provider, state, 10n, 0, {
    depth: 10,
    timeoutMs: 1_000,
    pollIntervalMs: 0,
  });

  assert.equal(block, 11);
  assert.deepEqual(
    reads.map((read) => read.block),
    [10, 10, 10, 11, 11, 11],
  );
});

test("shielding proving base must be later than a new approval receipt", async () => {
  const heads = [20, 21];
  const readBlocks: number[] = [];
  const provider = {
    getBlockNumber: async () => heads.shift() ?? 21,
    callContract: async (
      call: { entrypoint: string },
      blockIdentifier?: number | string,
    ) => {
      readBlocks.push(Number(blockIdentifier));
      return [call.entrypoint === "get_fee_amount" ? "0x1" : "0x20", "0x0"];
    },
  } as unknown as Pick<RpcProvider, "getBlockNumber" | "callContract">;

  const block = await waitForShieldingProvingBlock(provider, state, 10n, 10, {
    depth: 10,
    timeoutMs: 1_000,
    pollIntervalMs: 0,
  });

  assert.equal(block, 11);
  assert.deepEqual(readBlocks, [11, 11, 11]);
});
