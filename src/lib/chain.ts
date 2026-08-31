import { cairo, RpcProvider, type Call } from "starknet";
import { normalizeAddress } from "./shadow-address";

export function u256Calldata(value: bigint): string[] {
  const encoded = cairo.uint256(value);
  return [normalizeAddress(encoded.low), normalizeAddress(encoded.high)];
}

export async function readU256(
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string,
  calldata: string[],
): Promise<bigint> {
  const result = await provider.callContract({ contractAddress, entrypoint, calldata });
  return BigInt(result[0] ?? "0") + (BigInt(result[1] ?? "0") << 128n);
}

export async function waitForSuccessfulTransaction(
  provider: RpcProvider,
  transactionHash: string,
  timeoutMs = 360_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const receipt = await provider.getTransactionReceipt(transactionHash);
      const finality = "finality_status" in receipt ? String(receipt.finality_status) : "";
      if (finality === "REJECTED") {
        throw new Error(`Transaction rejected: ${transactionHash}`);
      }
      if (finality === "ACCEPTED_ON_L2" || finality === "ACCEPTED_ON_L1") {
        if (!receipt.isSuccess()) throw new Error(`Transaction reverted: ${transactionHash}`);
        return receipt;
      }
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /rejected|reverted/i.test(error.message)) throw error;
    }
    await delay(3_000);
  }
  throw new Error(`Timed out waiting for ${transactionHash}`, { cause: lastError });
}

export async function waitForSettledProvingBlock(
  provider: RpcProvider,
  dependencyBlock: number,
  depth = 10,
  timeoutMs = 300_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const provingBlock = (await provider.getBlockNumber()) - depth;
    if (provingBlock > dependencyBlock) return provingBlock;
    await delay(3_000);
  }
  throw new Error(`Timed out waiting for a proving block after block ${dependencyBlock}`);
}

export function approveCall(token: string, spender: string, amount: bigint): Call {
  return {
    contractAddress: token,
    entrypoint: "approve",
    calldata: [spender, ...u256Calldata(amount)],
  };
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
