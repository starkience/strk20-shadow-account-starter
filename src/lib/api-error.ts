import { PaymasterSubmissionUnknownError } from "./private-paymaster.js";
import { StarkscanProofDeliveryUnknownError } from "./starkscan-prover.js";

export type PublicInvocationErrorCode =
  | "SUBMISSION_UNKNOWN"
  | "PROOF_DELIVERY_UNKNOWN"
  | "PRIVATE_BALANCE_NOT_READY"
  | "USER_LINKAGE"
  | "PAYMASTER_REJECTED"
  | "VERIFICATION_FAILED"
  | "INVALID_INVOCATION"
  | "INVOCATION_FAILED";

export interface PublicInvocationError {
  readonly code: PublicInvocationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly trackingId?: string;
  readonly transactionHash?: string;
  readonly proverJobId?: string;
}

const SAFE_MESSAGES = [
  /^A shadow invocation needs at least one call$/,
  /^A shadow-account operation is already active for this client$/,
  /^shield amount must be a positive bigint$/,
  /^fundingAmount must be a bigint$/,
  /^fundingAmount must not be negative$/,
  /^Not enough mature shielded STRK\./,
  /^Paymaster requested its private fee in an unexpected token$/,
  /^Paymaster fee exceeds the configured safety limit$/,
  /^Private paymaster rejected paymaster_(?:build|execute)Transaction(?: \(code [-\w]+\))?; HTTP \d+$/,
  /^Stopped: the SDK reported USER_LINKAGE$/,
  /^Shadow-account registry did not resolve to the expected address$/,
  /^The derived address does not run the anonymizer's shadow-account class$/,
  /^Privacy invariant failed: root account is the outer transaction sender$/,
  /^Missing matching ShadowAccountDeployed event$/,
] as const;

/**
 * Converts an internal failure into the deliberately small API error surface.
 * Unknown SDK, prover, RPC, and application errors are never reflected.
 */
export function toPublicInvocationError(error: unknown): PublicInvocationError {
  if (error instanceof PaymasterSubmissionUnknownError) {
    return {
      code: "SUBMISSION_UNKNOWN",
      message: error.message,
      retryable: false,
      ...(error.trackingId ? { trackingId: error.trackingId } : {}),
      ...(error.transactionHash ? { transactionHash: error.transactionHash } : {}),
    };
  }

  if (error instanceof StarkscanProofDeliveryUnknownError) {
    return {
      code: "PROOF_DELIVERY_UNKNOWN",
      message: "Proof delivery status is unknown. Do not retry automatically; inspect the trusted server logs.",
      retryable: false,
      ...(error.jobId ? { proverJobId: error.jobId } : {}),
    };
  }

  const message = error instanceof Error ? error.message : "";
  if (SAFE_MESSAGES.some((pattern) => pattern.test(message))) {
    return {
      code: classify(message),
      message,
      retryable: message.startsWith("Not enough mature shielded STRK."),
    };
  }

  return {
    code: "INVOCATION_FAILED",
    message: "The shadow invocation failed. Check the trusted server logs for details.",
    retryable: false,
  };
}

function classify(message: string): PublicInvocationErrorCode {
  if (message.startsWith("Not enough mature")) return "PRIVATE_BALANCE_NOT_READY";
  if (message.includes("USER_LINKAGE")) return "USER_LINKAGE";
  if (message.startsWith("Paymaster") || message.startsWith("Private paymaster")) {
    return "PAYMASTER_REJECTED";
  }
  if (message.includes("registry") || message.includes("class") || message.includes("event")) {
    return "VERIFICATION_FAILED";
  }
  return "INVALID_INVOCATION";
}
