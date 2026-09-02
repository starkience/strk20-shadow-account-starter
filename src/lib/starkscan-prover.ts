import { createHash } from "node:crypto";
import {
  ETransactionVersion,
  RpcProvider,
  type constants,
} from "starknet";
import { z } from "zod";
import type {
  Proof,
  ProofInvocation,
  ProofInvocationFactoryDetails,
  ProofProviderInterface,
  ProvingBlockId,
  StarknetAddress,
} from "../vendor-sdk.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_JOB_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_SUBMIT_ATTEMPTS = 3;
const DEFAULT_MAX_UNAVAILABLE_RETRIES = 2;
const MAX_POLL_SECONDS = 60;

const messageSchema = z.object({
  from_address: z.string(),
  to_address: z.string(),
  payload: z.array(z.string()),
}).passthrough();

const screeningSignatureSchema = z.object({
  issued_at: z.number().int().nonnegative(),
  sig_r: z.string(),
  sig_s: z.string(),
}).passthrough();

const proofResultSchema = z.object({
  proof: z.string().min(1),
  proof_facts: z.array(z.string()),
  l2_to_l1_messages: z.array(messageSchema),
  additional_data: z.object({
    signature: screeningSignatureSchema.optional(),
  }).passthrough().optional(),
}).passthrough();

const jobStatusSchema = z.enum([
  "queued",
  "dispatched",
  "succeeded",
  "failed",
  "unavailable",
  "unknown_delivery",
]);

const jobSchema = z.object({
  jobId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  status: jobStatusSchema,
  terminal: z.boolean(),
  attemptCount: z.number().int().nonnegative().optional(),
  pollAfterSeconds: z.number().nonnegative().optional(),
  result: proofResultSchema.optional(),
  resultUnavailableReason: z.string().optional(),
  error: z.object({
    code: z.union([z.string(), z.number()]),
  }).passthrough().optional(),
}).passthrough();

type StarkscanJob = z.infer<typeof jobSchema>;
type StarkscanProofResult = z.infer<typeof proofResultSchema>;

export interface StarkscanProofProviderOptions {
  /** Exact Starkscan `/prove` endpoint for the pinned network. */
  readonly endpoint: string;
  /** Server-side Starkscan API key with proving access. */
  readonly apiKey: string;
  readonly chainId: constants.StarknetChainId;
  readonly rpcUrl: string;
  readonly poolAddress: StarknetAddress;
  readonly requestTimeoutMs?: number;
  readonly jobTimeoutMs?: number;
  readonly maxSubmitAttempts?: number;
  readonly maxUnavailableRetries?: number;
}

/** Dependency hooks used by deterministic tests. */
export interface StarkscanProofProviderDependencies {
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  readonly idempotencyKey?: (requestBody: string) => string;
  readonly nonceProvider?: Pick<RpcProvider, "getNonceForAddress">;
}

export class StarkscanProverError extends Error {
  override readonly name = "StarkscanProverError";

  constructor(
    message: string,
    public readonly details: {
      readonly code?: string | number;
      readonly httpStatus?: number;
      readonly jobId?: string;
      readonly retryAfterMs?: number;
    } = {},
  ) {
    super(message);
  }
}

/** The relay may have accepted the proof job. Callers must not blindly retry. */
export class StarkscanProofDeliveryUnknownError extends Error {
  override readonly name = "StarkscanProofDeliveryUnknownError";
  readonly #idempotencyKey?: string;

  constructor(
    public readonly jobId?: string,
    /** Trusted-server recovery handle. Never return it from an application API. */
    idempotencyKey?: string,
  ) {
    super(
      jobId
        ? `Starkscan proof delivery is unknown for job ${jobId}; do not resubmit automatically`
        : "Starkscan proof submission status is unknown; do not resubmit automatically",
    );
    this.#idempotencyKey = idempotencyKey;
  }

  get idempotencyKey(): string | undefined {
    return this.#idempotencyKey;
  }
}

/**
 * Privacy SDK proof provider backed by Starkscan's authenticated asynchronous
 * relay. One invocation creates one idempotency key and reuses it for every
 * safe submission retry.
 */
export class StarkscanProofProvider implements ProofProviderInterface {
  private readonly endpoint: string;
  readonly #apiKey: string;
  private readonly chainId: constants.StarknetChainId;
  private readonly poolAddress: StarknetAddress;
  private readonly fetch: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly idempotencyKey: (requestBody: string) => string;
  private readonly nonceProvider: Pick<RpcProvider, "getNonceForAddress">;
  private readonly requestTimeoutMs: number;
  private readonly jobTimeoutMs: number;
  private readonly maxSubmitAttempts: number;
  private readonly maxUnavailableRetries: number;
  private cachedNonce: bigint | null = null;

  constructor(
    options: StarkscanProofProviderOptions,
    dependencies: StarkscanProofProviderDependencies = {},
  ) {
    this.endpoint = validateEndpoint(options.endpoint);
    this.#apiKey = options.apiKey.trim();
    if (!this.#apiKey) throw new Error("STARKSCAN_API_KEY is required");
    if (/[\r\n]/.test(this.#apiKey)) throw new Error("STARKSCAN_API_KEY contains a newline");
    this.chainId = options.chainId;
    this.poolAddress = options.poolAddress;
    this.fetch = dependencies.fetch ?? globalThis.fetch;
    this.sleep = dependencies.sleep ?? delay;
    this.now = dependencies.now ?? Date.now;
    this.idempotencyKey = dependencies.idempotencyKey ?? deterministicIdempotencyKey;
    this.nonceProvider = dependencies.nonceProvider ?? new RpcProvider({ nodeUrl: options.rpcUrl });
    this.requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.jobTimeoutMs = positiveInteger(
      options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
      "jobTimeoutMs",
    );
    this.maxSubmitAttempts = positiveInteger(
      options.maxSubmitAttempts ?? DEFAULT_MAX_SUBMIT_ATTEMPTS,
      "maxSubmitAttempts",
    );
    this.maxUnavailableRetries = nonNegativeInteger(
      options.maxUnavailableRetries ?? DEFAULT_MAX_UNAVAILABLE_RETRIES,
      "maxUnavailableRetries",
    );
  }

  async getDefaultDetails(): Promise<ProofInvocationFactoryDetails> {
    if (this.cachedNonce === null) {
      this.cachedNonce = BigInt(
        await this.nonceProvider.getNonceForAddress(this.poolAddress, "latest"),
      );
    }
    return {
      versions: [ETransactionVersion.V3],
      nonce: this.cachedNonce,
      skipValidate: true,
      resourceBounds: {
        l1_gas: { max_amount: 1n, max_price_per_unit: 0n },
        l2_gas: { max_amount: 100_000_000n, max_price_per_unit: 0n },
        l1_data_gas: { max_amount: 1n, max_price_per_unit: 0n },
      },
      tip: 0n,
      paymasterData: [],
      accountDeploymentData: [],
      nonceDataAvailabilityMode: "L1",
      feeDataAvailabilityMode: "L1",
      version: ETransactionVersion.V3,
      chainId: this.chainId,
    };
  }

  invalidateNonceCache(): void {
    this.cachedNonce = null;
  }

  async prove(invocation: ProofInvocation, blockIdentifier?: ProvingBlockId): Promise<Proof> {
    const body = JSON.stringify({
      block_id: explicitBlockId(blockIdentifier),
      transaction: invocation,
    });
    const idempotencyKey = this.idempotencyKey(body);
    validateIdempotencyKey(idempotencyKey);
    const deadline = this.now() + this.jobTimeoutMs;
    let unavailableRetries = 0;
    let job = await this.submit(body, idempotencyKey, deadline);

    while (true) {
      if (job.status === "succeeded") return this.toProof(job);
      if (job.status === "failed") {
        throw new StarkscanProverError("Starkscan rejected the proof request", {
          code: job.error?.code,
          jobId: job.jobId,
        });
      }
      if (job.status === "unknown_delivery") {
        throw new StarkscanProofDeliveryUnknownError(job.jobId, idempotencyKey);
      }
      if (job.status === "unavailable") {
        if (unavailableRetries >= this.maxUnavailableRetries) {
          throw new StarkscanProverError("Starkscan prover is unavailable", {
            code: job.error?.code,
            jobId: job.jobId,
          });
        }
        unavailableRetries += 1;
        await this.waitForNextPoll(job, deadline);
        job = await this.submit(body, idempotencyKey, deadline);
        continue;
      }
      await this.waitForNextPoll(job, deadline);
      job = await this.poll(job.jobId, deadline);
    }
  }

  private async submit(
    body: string,
    idempotencyKey: string,
    deadline: number,
  ): Promise<StarkscanJob> {
    for (let attempt = 0; attempt < this.maxSubmitAttempts; attempt += 1) {
      try {
        return await this.requestJob(this.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Starkscan-Api-Key": this.#apiKey,
            "Idempotency-Key": idempotencyKey,
          },
          body,
        });
      } catch (error) {
        if (error instanceof StarkscanProverError && !isRetryableHttp(error)) throw error;
        if (attempt + 1 >= this.maxSubmitAttempts) {
          if (error instanceof StarkscanProverError) throw error;
          throw new StarkscanProofDeliveryUnknownError(undefined, idempotencyKey);
        }
        const waitMs = error instanceof StarkscanProverError
          ? error.details.retryAfterMs ?? Math.min(1_000 * 2 ** attempt, 10_000)
          : Math.min(1_000 * 2 ** attempt, 10_000);
        if (this.now() + waitMs >= deadline) {
          if (error instanceof StarkscanProverError) throw error;
          throw new StarkscanProofDeliveryUnknownError(undefined, idempotencyKey);
        }
        await this.sleep(waitMs);
      }
    }
    throw new StarkscanProofDeliveryUnknownError(undefined, idempotencyKey);
  }

  private async poll(jobId: string, deadline: number): Promise<StarkscanJob> {
    while (true) {
      try {
        return await this.requestJob(`${this.endpoint}/${encodeURIComponent(jobId)}`, {
          method: "GET",
          headers: { "X-Starkscan-Api-Key": this.#apiKey },
        });
      } catch (error) {
        if (error instanceof StarkscanProverError && !isRetryableHttp(error)) {
          throw error;
        }
        if (this.now() >= deadline) {
          throw new StarkscanProverError(`Timed out waiting for Starkscan proof job ${jobId}`, {
            jobId,
          });
        }
        const waitMs = error instanceof StarkscanProverError
          ? error.details.retryAfterMs ?? 1_000
          : 1_000;
        await this.sleep(Math.min(waitMs, Math.max(deadline - this.now(), 0)));
      }
    }
  }

  private async requestJob(url: string, init: RequestInit): Promise<StarkscanJob> {
    const response = await this.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const responseText = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(responseText);
    } catch {
      if (!response.ok) {
        throw new StarkscanProverError(`Starkscan returned HTTP ${response.status}`, {
          httpStatus: response.status,
        });
      }
      throw new Error("Starkscan returned an invalid JSON response");
    }
    if (!response.ok) {
      throw new StarkscanProverError(`Starkscan returned HTTP ${response.status}`, {
        httpStatus: response.status,
        code: remoteErrorCode(value),
        retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after"), this.now()),
      });
    }
    const parsed = jobSchema.safeParse(value);
    if (!parsed.success) throw new Error("Starkscan returned an invalid proof-job response");
    const terminalStatus = ["succeeded", "failed", "unavailable", "unknown_delivery"]
      .includes(parsed.data.status);
    if (parsed.data.terminal !== terminalStatus) {
      throw new Error("Starkscan returned an inconsistent proof-job state");
    }
    return parsed.data;
  }

  private async waitForNextPoll(job: StarkscanJob, deadline: number): Promise<void> {
    if (this.now() >= deadline) {
      throw new StarkscanProverError(`Timed out waiting for Starkscan proof job ${job.jobId}`, {
        jobId: job.jobId,
      });
    }
    const seconds = Math.min(Math.max(job.pollAfterSeconds ?? 10, 0), MAX_POLL_SECONDS);
    await this.sleep(Math.min(seconds * 1_000, Math.max(deadline - this.now(), 0)));
  }

  private toProof(job: StarkscanJob): Proof {
    if (!job.result) {
      throw new StarkscanProverError(
        `Starkscan proof result is unavailable for job ${job.jobId}`,
        { jobId: job.jobId },
      );
    }
    return resultToProof(job.result, this.poolAddress);
  }
}

function resultToProof(result: StarkscanProofResult, poolAddress: StarknetAddress): Proof {
  const expectedPool = BigInt(poolAddress);
  const poolMessage = result.l2_to_l1_messages.find((message) => {
    try {
      return BigInt(message.from_address) === expectedPool;
    } catch {
      return false;
    }
  });
  if (!poolMessage) throw new Error("Starkscan proof omitted the privacy-pool output message");
  return {
    data: result.proof,
    output: poolMessage.payload,
    proofFacts: result.proof_facts,
    additionalData: result.additional_data,
  };
}

function explicitBlockId(
  blockIdentifier?: ProvingBlockId,
): { block_number: number } | { block_hash: string } {
  if (blockIdentifier === undefined || blockIdentifier === null) {
    throw new Error("Starkscan proving requires an explicit finalized block");
  }
  if (typeof blockIdentifier === "number") {
    if (!Number.isSafeInteger(blockIdentifier) || blockIdentifier < 0) {
      throw new Error("Starkscan proving block number must be a non-negative safe integer");
    }
    return { block_number: blockIdentifier };
  }
  if (typeof blockIdentifier === "bigint") {
    const blockNumber = Number(blockIdentifier);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
      throw new Error("Starkscan proving block number must be a non-negative safe integer");
    }
    return { block_number: blockNumber };
  }
  if (typeof blockIdentifier === "string" && /^\d+$/.test(blockIdentifier)) {
    const blockNumber = Number(blockIdentifier);
    if (!Number.isSafeInteger(blockNumber)) {
      throw new Error("Starkscan proving block number must be a non-negative safe integer");
    }
    return { block_number: blockNumber };
  }
  if (typeof blockIdentifier === "string" && /^0x[0-9a-fA-F]+$/.test(blockIdentifier)) {
    return { block_hash: blockIdentifier };
  }
  throw new Error(`Starkscan proving requires an explicit block, not ${String(blockIdentifier)}`);
}

function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("STARKSCAN_PROVER_URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.search || url.hash) {
    throw new Error("STARKSCAN_PROVER_URL must be an HTTPS URL without query or fragment");
  }
  if (!url.pathname.replace(/\/$/, "").endsWith("/prove")) {
    throw new Error("STARKSCAN_PROVER_URL must end in /prove");
  }
  return url.toString().replace(/\/$/, "");
}

function validateIdempotencyKey(value: string): void {
  if (
    value.length < 16 ||
    value.length > 128 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 33 || code > 126 || character === '"';
    })
  ) {
    throw new Error("Starkscan idempotency key is invalid");
  }
}

function deterministicIdempotencyKey(requestBody: string): string {
  return `shadow-${createHash("sha256").update(requestBody).digest("hex")}`;
}

function remoteErrorCode(value: unknown): string | number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function isRetryableHttp(error: StarkscanProverError): boolean {
  return error.details.httpStatus === 429 || error.details.httpStatus === 503;
}

function retryAfterMilliseconds(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(timestamp - now, 0);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
