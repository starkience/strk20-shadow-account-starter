import { shortString, type Call } from "starknet";
import { loadRuntimeConfig, type ShadowRuntimeConfig } from "./config.js";
import {
  invokeShadowCalls,
  type GenericShadowInvokeResult,
  type ShadowVerificationContext,
} from "./invoke-shadow.js";
import { PrivatePaymaster, type PaymasterTracking } from "./private-paymaster.js";
import type { ProgressReporter } from "./progress.js";

export interface CreateShadowAccountOptions {
  /** Supply programmatically, or omit to load the server-side environment. */
  readonly config?: ShadowRuntimeConfig;
  /** Application scope shared by the shadow identities created by this client. */
  readonly appName?: string;
  /** Default identity nonce. Individual calls may override it. */
  readonly nonce?: bigint;
  readonly onProgress?: ProgressReporter;
}

export interface ShadowInvokeInput {
  readonly calls: readonly Call[];
  /** STRK withdrawn privately into the shadow before the calls execute. */
  readonly fundingAmount?: bigint;
  /** Collect STRK left by the calls into a new private note. */
  readonly collectRemainder?: boolean;
  /** Override the client's nonce to select another app-scoped identity. */
  readonly nonce?: bigint;
  /** Application-specific postcondition required for an end-to-end claim. */
  readonly verifyEffect?: (context: ShadowVerificationContext) => Promise<void>;
}

export interface ShadowAccountClient {
  readonly appName: string;
  readonly defaultNonce: bigint;
  invoke(input: ShadowInvokeInput): Promise<GenericShadowInvokeResult>;
  reconcile(trackingId: string): Promise<PaymasterTracking>;
}

export function createShadowAccount(
  options?: CreateShadowAccountOptions,
): ShadowAccountClient {
  const loaded = options?.config ?? loadRuntimeConfig();
  const appName = validateAppName(options?.appName ?? loaded.appName);
  const defaultNonce = validateNonce(options?.nonce ?? loaded.nonce);
  const config: ShadowRuntimeConfig = { ...loaded, appName, nonce: defaultNonce };
  let invocationActive = false;
  return {
    appName,
    defaultNonce,
    async invoke(input): Promise<GenericShadowInvokeResult> {
      const invocationConfig = input.nonce === undefined
        ? config
        : { ...config, nonce: validateNonce(input.nonce) };
      if (invocationActive) {
        throw new Error("A shadow invocation is already active for this client");
      }
      invocationActive = true;
      try {
        return await invokeShadowCalls(
          invocationConfig,
          {
            calls: input.calls,
            fundingAmount: input.fundingAmount ?? 0n,
            collectRemainder: input.collectRemainder ?? false,
            verifyEffect: input.verifyEffect,
          },
          options?.onProgress,
        );
      } finally {
        invocationActive = false;
      }
    },
    reconcile(trackingId): Promise<PaymasterTracking> {
      return new PrivatePaymaster(config.paymasterUrl, config.paymasterApiKey)
        .reconcile(trackingId);
    },
  };
}

function validateAppName(value: string): string {
  if (!value) throw new Error("appName must not be empty");
  try {
    shortString.encodeShortString(value);
  } catch {
    throw new Error("appName must fit in a Cairo short string (31 ASCII characters)");
  }
  return value;
}

function validateNonce(value: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error("shadow nonce must be a non-negative bigint");
  }
  return value;
}
