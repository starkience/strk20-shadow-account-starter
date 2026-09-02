import { shortString, type Call } from "starknet";
import {
  createRuntimeConfig,
  loadRuntimeConfig,
  type ShadowAccountCredentials,
  type ShadowAdvancedOptions,
  type ShadowRuntimeConfig,
} from "./config.js";
import {
  invokeShadowCalls,
  type GenericShadowInvokeResult,
  type ShadowVerificationContext,
} from "./invoke-shadow.js";
import { PrivatePaymaster, type PaymasterTracking } from "./private-paymaster.js";
import type { ProgressReporter } from "./progress.js";
import { shieldStrk, type ShieldResult } from "./shield.js";

export interface CreateShadowAccountOptions {
  /** Supply the same four values as `.env`, or omit to load them from the environment. */
  readonly credentials?: ShadowAccountCredentials;
  /** Maintainer-only overrides; normal builders should use the pinned Sepolia stack. */
  readonly advanced?: ShadowAdvancedOptions;
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
  /**
   * Publicly shield STRK into the root account's private balance. The root
   * account, token, amount, and timing remain visible at this onboarding edge.
   */
  shield(amount: bigint): Promise<ShieldResult>;
  invoke(input: ShadowInvokeInput): Promise<GenericShadowInvokeResult>;
  reconcile(trackingId: string): Promise<PaymasterTracking>;
}

export function createShadowAccount(
  options?: CreateShadowAccountOptions,
): ShadowAccountClient {
  const identity = { appName: options?.appName, nonce: options?.nonce };
  const loaded = options?.credentials
    ? createRuntimeConfig(options.credentials, identity, options.advanced)
    : loadRuntimeConfig(identity, options?.advanced);
  const appName = validateAppName(options?.appName ?? loaded.appName);
  const defaultNonce = validateNonce(options?.nonce ?? loaded.nonce);
  const config: ShadowRuntimeConfig = { ...loaded, appName, nonce: defaultNonce };
  let operationActive = false;

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (operationActive) {
      throw new Error("A shadow-account operation is already active for this client");
    }
    operationActive = true;
    try {
      return await operation();
    } finally {
      operationActive = false;
    }
  }

  return {
    appName,
    defaultNonce,
    async shield(amount): Promise<ShieldResult> {
      const shieldAmount = validatePositiveAmount(amount, "shield amount");
      return runExclusive(() =>
        shieldStrk({ ...config, shieldAmount }, options?.onProgress)
      );
    },
    async invoke(input): Promise<GenericShadowInvokeResult> {
      const invocationConfig = input.nonce === undefined
        ? config
        : { ...config, nonce: validateNonce(input.nonce) };
      return runExclusive(() =>
        invokeShadowCalls(
          invocationConfig,
          {
            calls: input.calls,
            fundingAmount: input.fundingAmount ?? 0n,
            collectRemainder: input.collectRemainder ?? false,
            verifyEffect: input.verifyEffect,
          },
          options?.onProgress,
        )
      );
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

function validatePositiveAmount(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new Error(`${label} must be a positive bigint`);
  }
  return value;
}
