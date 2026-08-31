import { WarningCode } from "@starkware-libs/starknet-privacy-sdk";
import { type Call } from "starknet";
import { approveCall, readU256, waitForSettledProvingBlock, waitForSuccessfulTransaction } from "./chain";
import type { ShadowConfig } from "./config";
import { SEPOLIA } from "./constants";
import type { ProgressReporter } from "./progress";
import { noopProgress } from "./progress";
import { createSdkContext } from "./sdk";

export interface ShieldResult {
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly spendableAtBlock: number;
}

/** Public Sepolia onboarding edge: approve, register if needed, and shield STRK. */
export async function shieldStrk(
  config: ShadowConfig,
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

  const provingBlock = await waitForSettledProvingBlock(
    provider,
    dependencyBlock,
    SEPOLIA.provingDepthBlocks,
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
  };
}
