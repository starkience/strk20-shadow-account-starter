import {
  Open,
  WarningCode,
} from "@starkware-libs/starknet-privacy-sdk";
import { hash, RpcProvider, type Call } from "starknet";
import { readU256, u256Calldata, waitForSuccessfulTransaction } from "./chain";
import type { ShadowConfig } from "./config";
import { SEPOLIA } from "./constants";
import { selectMatureNotes } from "./notes";
import { PrivatePaymaster } from "./private-paymaster";
import type { ProgressReporter } from "./progress";
import { noopProgress } from "./progress";
import { createSdkContext } from "./sdk";
import { normalizeAddress, sameAddress, shadowAddressFromCommitment } from "./shadow-address";

export interface GenericShadowInvokeResult {
  readonly transactionHash: string;
  readonly trackingId: string;
  readonly blockNumber: number;
  readonly shadowAddress: string;
  readonly commitment: string;
  readonly nonce: string;
  readonly outerSender: string;
  readonly deployedNow: boolean;
  readonly explorerUrl: string;
}

export interface ShadowCallRequest {
  readonly calls: readonly Call[];
  /** Amount withdrawn privately into the shadow account before calls run. */
  readonly fundingAmount: bigint;
  /** Creates an open note that collects any token left in the shadow account. */
  readonly collectRemainder?: boolean;
  readonly verifyEffect?: (context: {
    provider: RpcProvider;
    shadowAddress: string;
    receipt: Awaited<ReturnType<typeof waitForSuccessfulTransaction>>;
  }) => Promise<void>;
}

export interface ShadowInvokeResult extends GenericShadowInvokeResult {
  readonly recipient: string;
  readonly amount: string;
}

export async function invokeShadowCalls(
  config: ShadowConfig,
  request: ShadowCallRequest,
  report: ProgressReporter = noopProgress,
): Promise<GenericShadowInvokeResult> {
  if (request.calls.length === 0) throw new Error("A shadow invocation needs at least one call");
  if (request.fundingAmount < 0n) throw new Error("fundingAmount must not be negative");
  const { provider, transfers } = createSdkContext(config);
  const paymaster = new PrivatePaymaster(
    config.paymasterUrl,
    config.paymasterApiKey,
  );

  await report({ stage: "prepare", message: "Requesting private relay terms" });
  const relayTerms = await paymaster.build(config.poolAddress, config.tokenAddress);
  const fee = relayTerms.fee;
  if (fee && !sameAddress(fee.token, config.tokenAddress)) {
    throw new Error("Paymaster requested its private fee in an unexpected token");
  }
  if ((fee?.amount ?? 0n) > config.maxPaymasterFee) {
    throw new Error("Paymaster fee exceeds MAX_PAYMASTER_FEE_STRK");
  }

  const provingBlock = (await provider.getBlockNumber()) - SEPOLIA.provingDepthBlocks;
  await report({ stage: "discover", message: "Discovering mature shielded STRK notes" });
  const discovered = await transfers.discoverNotes({
    tokens: [BigInt(config.tokenAddress)],
    blockIdentifier: provingBlock,
  });
  const shadowFunding = request.fundingAmount;
  const required = shadowFunding + (fee?.amount ?? 0n);
  const selection = selectMatureNotes(
    discovered.notes.get(BigInt(config.tokenAddress)) ?? [],
    required,
    provingBlock,
    SEPOLIA.noteMaturityBlocks,
  );

  const builder = transfers
    .build({
      autoDiscover: { channels: "refresh" },
      provingBlockId: provingBlock,
    })
    .surplusTo(config.accountAddress, false);
  const shadow = builder.shadowAccounts(config.appName);
  const commitment = await shadow.commitment(config.nonce);
  const registryBefore = await readShadowRegistry(
    provider,
    config.anonymizerAddress,
    commitment,
  );
  const predicted = shadowAddressFromCommitment(commitment, BigInt(config.anonymizerAddress));
  const shadowAddress = registryBefore === 0n ? predicted : normalizeAddress(registryBefore);
  if (registryBefore !== 0n && !sameAddress(registryBefore, predicted)) {
    throw new Error("Anonymizer registry disagrees with the pinned primer address formula");
  }

  builder.with(config.tokenAddress, (token) => {
    token.inputs(...selection.notes);
    if (shadowFunding > 0n) {
      token.withdraw({ recipient: shadowAddress, amount: shadowFunding });
    }
    if (request.collectRemainder) {
      token.transfer({ recipient: config.accountAddress, amount: Open });
    }
    if (fee && fee.amount > 0n) {
      token.withdraw({ recipient: fee.recipient, amount: fee.amount });
    }
  });
  shadow.invoke(config.nonce, {
    calls: [...request.calls],
    collectPolicy: { type: "all" },
  });

  await report({ stage: "prove", message: "Proving the private shadow-account invocation" });
  const execution = await builder.execute();
  if (execution.warnings.some((warning) => warning.code === WarningCode.USER_LINKAGE)) {
    throw new Error("Stopped: the SDK reported USER_LINKAGE");
  }

  await report({ stage: "relay", message: "Relaying without the root account as transaction sender" });
  const proof = execution.callAndProof.proof;
  const submitted = await paymaster.execute({
    poolAddress: config.poolAddress,
    call: execution.callAndProof.call,
    proof: proof.data,
    proofFacts: proof.proofFacts,
    build: relayTerms,
  });

  await report({ stage: "confirm", message: "Waiting for Starknet confirmation" });
  const receipt = await waitForSuccessfulTransaction(provider, submitted.transactionHash);
  const blockNumber = Number(receipt.block_number ?? 0);
  await report({ stage: "verify", message: "Verifying caller, registry, transfer, and relay invariants" });

  const registryAfter = await readShadowRegistry(
    provider,
    config.anonymizerAddress,
    commitment,
  );
  if (!sameAddress(registryAfter, shadowAddress)) {
    throw new Error("Shadow-account registry did not resolve to the expected address");
  }
  const expectedClass = await provider.callContract({
    contractAddress: config.anonymizerAddress,
    entrypoint: "get_shadow_account_class_hash",
    calldata: [],
  });
  const deployedClass = await provider.getClassHashAt(shadowAddress);
  if (!sameAddress(expectedClass[0] ?? 0n, deployedClass)) {
    throw new Error("The derived address does not run the anonymizer's shadow-account class");
  }
  const transaction = await provider.getTransactionByHash(submitted.transactionHash);
  const outerSender =
    "sender_address" in transaction ? normalizeAddress(String(transaction.sender_address)) : "";
  if (!outerSender || sameAddress(outerSender, config.accountAddress)) {
    throw new Error("Privacy invariant failed: root account is the outer transaction sender");
  }
  const deployedNow = registryBefore === 0n;
  if (deployedNow && !hasDeploymentEvent(receipt, config.anonymizerAddress, commitment, shadowAddress)) {
    throw new Error("Missing matching ShadowAccountDeployed event");
  }
  await request.verifyEffect?.({ provider, shadowAddress, receipt });

  return {
    transactionHash: submitted.transactionHash,
    trackingId: submitted.trackingId,
    blockNumber,
    shadowAddress,
    commitment: normalizeAddress(commitment),
    nonce: config.nonce.toString(),
    outerSender,
    deployedNow,
    explorerUrl: `${SEPOLIA.explorerUrl}/tx/${submitted.transactionHash}`,
  };
}

export async function invokeShadowTransfer(
  config: ShadowConfig,
  report: ProgressReporter = noopProgress,
): Promise<ShadowInvokeResult> {
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const recipientBalanceBefore = await readU256(
    provider,
    config.tokenAddress,
    "balanceOf",
    [config.recipientAddress],
  );
  const transferCall: Call = {
    contractAddress: config.tokenAddress,
    entrypoint: "transfer",
    calldata: [config.recipientAddress, ...u256Calldata(config.spendAmount)],
  };
  const result = await invokeShadowCalls(
    config,
    {
      calls: [transferCall],
      fundingAmount: config.spendAmount + 1n,
      collectRemainder: true,
      verifyEffect: async ({ provider: verificationProvider }) => {
        const recipientBalanceAfter = await readU256(
          verificationProvider,
          config.tokenAddress,
          "balanceOf",
          [config.recipientAddress],
        );
        if (recipientBalanceAfter - recipientBalanceBefore !== config.spendAmount) {
          throw new Error("Recipient balance delta does not equal SPEND_AMOUNT_STRK");
        }
      },
    },
    report,
  );
  return {
    ...result,
    recipient: config.recipientAddress,
    amount: config.spendAmount.toString(),
  };
}

async function readShadowRegistry(
  provider: { callContract(call: Call): Promise<string[]> },
  anonymizer: string,
  commitment: bigint,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: anonymizer,
    entrypoint: "get_shadow_account",
    calldata: [normalizeAddress(commitment)],
  });
  return BigInt(result[0] ?? 0n);
}

function hasDeploymentEvent(
  receipt: unknown,
  anonymizer: string,
  commitment: bigint,
  shadowAddress: string,
): boolean {
  if (!receipt || typeof receipt !== "object" || !("events" in receipt)) return false;
  const events = (receipt as { events?: unknown }).events;
  if (!Array.isArray(events)) return false;
  const selector = hash.getSelectorFromName("ShadowAccountDeployed");
  return events.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const event = candidate as { from_address?: string; keys?: string[]; data?: string[] };
    return (
      event.from_address !== undefined &&
      sameAddress(event.from_address, anonymizer) &&
      event.keys?.[0] !== undefined &&
      sameAddress(event.keys[0], selector) &&
      [...(event.keys ?? []).slice(1), ...(event.data ?? [])].some((value) =>
        sameAddress(value, commitment),
      ) &&
      [...(event.keys ?? []).slice(1), ...(event.data ?? [])].some((value) =>
        sameAddress(value, shadowAddress),
      )
    );
  });
}
