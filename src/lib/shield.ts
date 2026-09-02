import { WarningCode } from "../vendor-sdk.js";
import { RpcProvider, type Call } from "starknet";
import { approveCall, delay, readU256, waitForSuccessfulTransaction } from "./chain.js";
import type { ShieldConfig } from "./config.js";
import { SEPOLIA } from "./constants.js";
import type { ProgressReporter } from "./progress.js";
import { noopProgress } from "./progress.js";
import { createSdkContext } from "./sdk.js";

export interface ShieldResult {
  readonly transactionHash: string;
  readonly blockNumber: number;
  /** First proving-base block at which the new note satisfies maturity. */
  readonly spendableAtBlock: number;
  /** Chain head required for the default ten-block-deep proving base. */
  readonly readyAtHeadBlock: number;
}

/** Public Sepolia onboarding edge: approve, register if needed, and shield STRK. */
export async function shieldStrk(
  config: ShieldConfig,
  report: ProgressReporter = noopProgress,
): Promise<ShieldResult> {
  const { provider, account, transfers } = createSdkContext(config);
  await report({ stage: "config", message: "Checking public STRK and pool allowance" });
  const poolFee = await readU256(provider, config.poolAddress, "get_fee_amount", []);
  const publicBalance = await readU256(provider, config.tokenAddress, "balanceOf", [
    config.accountAddress,
  ]);
  const requiredPublic = config.shieldAmount + poolFee;
  if (publicBalance < requiredPublic) {
    throw new Error(
      `Public account needs at least ${requiredPublic} STRK base units; it has ${publicBalance}`,
    );
  }

  const allowance = await readU256(provider, config.tokenAddress, "allowance", [
    config.accountAddress,
    config.poolAddress,
  ]);
  let dependencyBlock = 0;
  if (allowance < requiredPublic) {
    await report({ stage: "prepare", message: "Approving the public shielding edge" });
    const approval = await account.execute(
      approveCall(config.tokenAddress, config.poolAddress, requiredPublic * 2n),
      { tip: 0n },
    );
    const receipt = await waitForSuccessfulTransaction(provider, approval.transaction_hash);
    dependencyBlock = Number(receipt.block_number ?? 0);
  }

  await report({
    stage: "prepare",
    message: "Waiting for public balance and allowance to reach the proving base",
  });
  const provingBlock = await waitForShieldingProvingBlock(
    provider,
    config,
    config.shieldAmount,
    dependencyBlock,
  );
  await report({ stage: "prove", message: "Creating the screened shielding proof" });
  const execution = await transfers
    .build({
      autoRegister: true,
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      provingBlockId: provingBlock,
    })
    .with(config.tokenAddress, (token) => {
      token.deposit({ amount: config.shieldAmount, recipient: config.accountAddress });
    })
    .surplusTo(config.accountAddress)
    .execute();

  if (execution.warnings.some((warning) => warning.code === WarningCode.USER_LINKAGE)) {
    throw new Error("Shielding proof unexpectedly reported USER_LINKAGE");
  }
  const proof = execution.callAndProof.proof;
  const proofDetails = proof.proofFacts.length
    ? { proof: proof.data, proofFacts: proof.proofFacts }
    : {};
  await report({ stage: "relay", message: "Submitting the public shielding transaction" });
  const submitted = await account.execute(execution.callAndProof.call as Call, {
    tip: 0n,
    ...proofDetails,
  });
  const receipt = await waitForSuccessfulTransaction(provider, submitted.transaction_hash);
  const blockNumber = Number(receipt.block_number ?? 0);
  await report({
    stage: "confirm",
    message: `Shielded note accepted; it becomes spendable at block ${blockNumber + SEPOLIA.noteMaturityBlocks}`,
  });
  return {
    transactionHash: submitted.transaction_hash,
    blockNumber,
    spendableAtBlock: blockNumber + SEPOLIA.noteMaturityBlocks,
    readyAtHeadBlock:
      blockNumber + SEPOLIA.noteMaturityBlocks + SEPOLIA.provingDepthBlocks,
  };
}

interface PublicShieldingState {
  readonly accountAddress: string;
  readonly tokenAddress: string;
  readonly poolAddress: string;
}

/**
 * Waits until every transparent value read by the shielding proof exists at
 * the same settled block used by the prover. This also covers a recent funding
 * transfer or pre-existing approval whose transaction hash is unavailable.
 */
export async function waitForShieldingProvingBlock(
  provider: Pick<RpcProvider, "getBlockNumber" | "callContract">,
  config: PublicShieldingState,
  shieldAmount: bigint,
  dependencyBlock = 0,
  options?: {
    readonly depth?: number;
    readonly timeoutMs?: number;
    readonly pollIntervalMs?: number;
  },
): Promise<number> {
  const depth = options?.depth ?? SEPOLIA.provingDepthBlocks;
  const deadline = Date.now() + (options?.timeoutMs ?? 360_000);
  const pollIntervalMs = options?.pollIntervalMs ?? 3_000;
  while (Date.now() < deadline) {
    const provingBlock = (await provider.getBlockNumber()) - depth;
    if (provingBlock > dependencyBlock) {
      const [poolFee, publicBalance, allowance] = await Promise.all([
        readU256(provider, config.poolAddress, "get_fee_amount", [], provingBlock),
        readU256(
          provider,
          config.tokenAddress,
          "balanceOf",
          [config.accountAddress],
          provingBlock,
        ),
        readU256(
          provider,
          config.tokenAddress,
          "allowance",
          [config.accountAddress, config.poolAddress],
          provingBlock,
        ),
      ]);
      const requiredAtBase = shieldAmount + poolFee;
      if (publicBalance >= requiredAtBase && allowance >= requiredAtBase) {
        return provingBlock;
      }
    }
    await delay(pollIntervalMs);
  }
  throw new Error(
    "Timed out waiting for the public STRK balance and pool allowance to reach a settled proving block",
  );
}
