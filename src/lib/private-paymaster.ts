import { CallData, hash, type Call } from "starknet";
import { normalizeAddress } from "./shadow-address.js";

export interface PaymasterFee {
  readonly token: string;
  readonly recipient: string;
  readonly amount: bigint;
}

export interface PaymasterBuild {
  readonly parameters: {
    readonly version: "0x1";
    readonly fee_mode: {
      readonly mode: "sponsored_private";
      readonly pool_fee_token: string;
    };
  };
  readonly fee?: PaymasterFee;
}

export interface PaymasterExecution {
  readonly transactionHash: string;
  readonly trackingId: string;
}

export interface PaymasterTracking {
  readonly transactionHash: string;
  readonly status: "active" | "accepted" | "dropped";
}

/**
 * The relay may have accepted the transaction even though the client did not
 * receive a response. Callers must reconcile externally before retrying.
 */
export class PaymasterSubmissionUnknownError extends Error {
  override readonly name = "PaymasterSubmissionUnknownError";
  readonly trackingId?: string;
  readonly transactionHash?: string;

  constructor(options?: {
    cause?: unknown;
    trackingId?: string;
    transactionHash?: string;
  }) {
    super(
      "Private-paymaster submission status is unknown. Reconcile the relay or chain before retrying.",
      { cause: options?.cause },
    );
    this.trackingId = optionalFelt(options?.trackingId);
    this.transactionHash = optionalFelt(options?.transactionHash);
  }
}

class PaymasterTransportError extends Error {
  override readonly name = "PaymasterTransportError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

class PaymasterRejectedError extends Error {
  override readonly name = "PaymasterRejectedError";
}

export class PrivatePaymaster {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!url.startsWith("https://")) throw new Error("AVNU_PAYMASTER_URL must use HTTPS");
  }

  async build(poolAddress: string, feeToken: string): Promise<PaymasterBuild> {
    const parameters = {
      version: "0x1" as const,
      fee_mode: {
        mode: "sponsored_private" as const,
        pool_fee_token: normalizeAddress(feeToken),
      },
    };
    const result = await this.rpc("paymaster_buildTransaction", {
      transaction: {
        type: "apply_action",
        apply_action: { pool_address: normalizeAddress(poolAddress) },
      },
      parameters,
    });
    const fee = parseFee(result.fee_action);
    return { parameters, ...(fee ? { fee } : {}) };
  }

  async execute(args: {
    poolAddress: string;
    call: Call;
    proof: string;
    proofFacts: readonly string[];
    build: PaymasterBuild;
  }): Promise<PaymasterExecution> {
    const params = {
      transaction: {
        type: "apply_action",
        apply_action: {
          pool_address: normalizeAddress(args.poolAddress),
          apply_actions_call: toPaymasterCall(args.call),
          proof: args.proof,
          proof_facts: args.proofFacts.map(normalizeAddress),
        },
      },
      parameters: args.build.parameters,
    };
    let result: Record<string, unknown> | undefined;
    try {
      result = await this.rpc("paymaster_executeTransaction", params);
      return {
        transactionHash: felt(result.transaction_hash, "transaction_hash"),
        trackingId: felt(result.tracking_id, "tracking_id"),
      };
    } catch (error) {
      if (error instanceof PaymasterRejectedError) throw error;
      throw new PaymasterSubmissionUnknownError({
        cause: error,
        trackingId: optionalFelt(result?.tracking_id),
        transactionHash: optionalFelt(result?.transaction_hash),
      });
    }
  }

  async reconcile(trackingId: string): Promise<PaymasterTracking> {
    const normalizedTrackingId = felt(trackingId, "trackingId");
    const result = await this.rpc("paymaster_trackingIdToLatestHash", {
      tracking_id: normalizedTrackingId,
    });
    const status = text(result.status, "status");
    if (status !== "active" && status !== "accepted" && status !== "dropped") {
      throw new Error("Paymaster returned an unsupported tracking status");
    }
    return {
      transactionHash: felt(result.transaction_hash, "transaction_hash"),
      status,
    };
  }

  private async rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-paymaster-api-key": this.apiKey,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      throw new PaymasterTransportError("Private paymaster could not be reached", { cause: error });
    }

    let body: Record<string, unknown>;
    try {
      body = record(await response.json(), "paymaster response");
    } catch (error) {
      throw new PaymasterTransportError("Private paymaster returned an unreadable response", {
        cause: error,
      });
    }
    if (!response.ok || body.error) {
      const error = body.error ? record(body.error, "paymaster error") : undefined;
      const code = typeof error?.code === "string" || typeof error?.code === "number"
        ? ` (code ${String(error.code)})`
        : "";
      throw new PaymasterRejectedError(
        `Private paymaster rejected ${method}${code}; HTTP ${response.status}`,
      );
    }
    return record(body.result, "paymaster result");
  }
}

function parseFee(value: unknown): PaymasterFee | undefined {
  if (value === undefined || value === null) return undefined;
  const fee = record(value, "fee_action");
  if (fee.type !== "withdraw") throw new Error("Unsupported paymaster fee action");
  return {
    token: felt(fee.token, "fee_action.token"),
    recipient: felt(fee.recipient, "fee_action.recipient"),
    amount: unsigned(fee.amount, "fee_action.amount"),
  };
}

function toPaymasterCall(call: Call) {
  return {
    to: normalizeAddress(call.contractAddress),
    selector: normalizeAddress(hash.getSelectorFromName(call.entrypoint)),
    calldata: CallData.compile(call.calldata ?? []).map((item) => normalizeAddress(item)),
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function felt(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`${field} must be a felt`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return normalizeAddress(parsed);
  } catch {
    throw new Error(`${field} must be a non-negative felt`);
  }
}

function unsigned(value: unknown, field: string): bigint {
  const result = BigInt(felt(value, field));
  if (result < 0n) throw new Error(`${field} must not be negative`);
  return result;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${field} must be a string`);
  return value;
}

function optionalFelt(value: unknown): string | undefined {
  try {
    return value === undefined ? undefined : felt(value, "transaction_hash");
  } catch {
    return undefined;
  }
}
