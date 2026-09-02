import { ec, shortString, validateAndParseAddress } from "starknet";
import type { OhttpOption } from "../vendor-sdk.js";
import { parseUnits } from "./amounts.js";
import { SEPOLIA, STRK_DECIMALS } from "./constants.js";
import { normalizeAddress } from "./shadow-address.js";
import { deriveDevelopmentViewingKey } from "./viewing-key.js";

/** The four values a normal Sepolia integration must provide. */
export interface ShadowAccountCredentials {
  readonly accountAddress: string;
  readonly accountPrivateKey: string;
  readonly starkscanApiKey: string;
  readonly avnuPaymasterApiKey: string;
  /** Only set this when the account is already registered with this exact key. */
  readonly viewingKey?: bigint;
}

/**
 * Escape hatches for maintainers testing a new compatibility row. Builders
 * should use the pinned Sepolia defaults.
 */
export interface ShadowAdvancedOptions {
  readonly rpcUrl?: string;
  readonly poolAddress?: string;
  readonly tokenAddress?: string;
  readonly anonymizerAddress?: string;
  readonly proverUrl?: string;
  readonly discoveryUrl?: string;
  readonly paymasterUrl?: string;
  readonly maxPaymasterFee?: bigint;
  readonly discoveryOhttp?: OhttpOption;
}

export interface ShadowIdentityOptions {
  readonly appName?: string;
  readonly nonce?: bigint;
}

export interface ShadowRuntimeConfig {
  readonly accountAddress: string;
  readonly accountPrivateKey: string;
  readonly viewingKey: bigint;
  readonly rpcUrl: string;
  readonly poolAddress: string;
  readonly tokenAddress: string;
  readonly anonymizerAddress: string;
  readonly proverUrl: string;
  readonly proverApiKey: string;
  readonly discoveryUrl: string;
  readonly paymasterUrl: string;
  readonly paymasterApiKey: string;
  readonly appName: string;
  readonly nonce: bigint;
  readonly maxPaymasterFee: bigint;
  /** Defaults to OHTTP enabled for the pinned discovery service. */
  readonly discoveryOhttp?: OhttpOption;
}

/** Runtime configuration plus the amount used by the public shielding edge. */
export interface ShieldConfig extends ShadowRuntimeConfig {
  readonly shieldAmount: bigint;
}

/** Configuration used only by the included shield-and-transfer recipe. */
export interface ShadowConfig extends ShieldConfig {
  readonly recipientAddress: string;
  readonly spendAmount: bigint;
}

export interface ShadowRecipeOptions extends ShadowIdentityOptions {
  readonly recipientAddress: string;
  readonly spendAmount?: bigint;
  readonly shieldAmount?: bigint;
}

export interface PublicShadowConfig {
  readonly rpcUrl: string;
  readonly poolAddress: string;
  readonly tokenAddress: string;
  readonly anonymizerAddress: string;
  readonly proverUrl: string;
  readonly discoveryUrl: string;
  readonly paymasterUrl: string;
  readonly appName: string;
  readonly nonce: bigint;
}

function value(name: string, fallback?: string): string {
  return process.env[name]?.trim() || fallback || "";
}

function required(name: string): string {
  const result = value(name);
  if (!result) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return result;
}

function parseAddress(name: string, input: string): string {
  try {
    const parsed = validateAndParseAddress(input);
    if (BigInt(parsed) === 0n) throw new Error("zero");
    return normalizeAddress(parsed);
  } catch {
    throw new Error(`${name} must be a non-zero Starknet address`);
  }
}

function appName(input = "shadow-starter"): string {
  if (!input) throw new Error("appName must not be empty");
  try {
    shortString.encodeShortString(input);
  } catch {
    throw new Error("appName must fit in a Cairo short string (31 ASCII characters)");
  }
  return input;
}

function nonce(input = 0n): bigint {
  if (typeof input !== "bigint" || input < 0n) {
    throw new Error("shadow nonce must be a non-negative bigint");
  }
  return input;
}

function positiveAmount(input: bigint, name: string): bigint {
  if (typeof input !== "bigint" || input <= 0n) {
    throw new Error(`${name} must be a positive bigint`);
  }
  return input;
}

function envAdvancedOptions(): ShadowAdvancedOptions {
  const maxFee = value("MAX_PAYMASTER_FEE_STRK");
  return {
    ...(value("STARKNET_RPC_URL") ? { rpcUrl: value("STARKNET_RPC_URL") } : {}),
    ...(value("POOL_ADDRESS") ? { poolAddress: value("POOL_ADDRESS") } : {}),
    ...(value("STRK_TOKEN_ADDRESS") ? { tokenAddress: value("STRK_TOKEN_ADDRESS") } : {}),
    ...(value("SHADOW_ACCOUNT_ANONYMIZER_ADDRESS")
      ? { anonymizerAddress: value("SHADOW_ACCOUNT_ANONYMIZER_ADDRESS") }
      : {}),
    ...(value("STARKSCAN_PROVER_URL") ? { proverUrl: value("STARKSCAN_PROVER_URL") } : {}),
    ...(value("DISCOVERY_URL") ? { discoveryUrl: value("DISCOVERY_URL") } : {}),
    ...(value("AVNU_PAYMASTER_URL") ? { paymasterUrl: value("AVNU_PAYMASTER_URL") } : {}),
    ...(maxFee ? { maxPaymasterFee: parseUnits(maxFee, STRK_DECIMALS) } : {}),
  };
}

function resolvePublicConfig(
  identity: ShadowIdentityOptions = {},
  advanced: ShadowAdvancedOptions = {},
): PublicShadowConfig {
  return {
    rpcUrl: advanced.rpcUrl ?? SEPOLIA.rpcUrl,
    poolAddress: parseAddress("poolAddress", advanced.poolAddress ?? SEPOLIA.poolAddress),
    tokenAddress: parseAddress("tokenAddress", advanced.tokenAddress ?? SEPOLIA.strkTokenAddress),
    anonymizerAddress: parseAddress(
      "anonymizerAddress",
      advanced.anonymizerAddress ?? SEPOLIA.shadowAccountAnonymizerAddress,
    ),
    proverUrl: advanced.proverUrl ?? SEPOLIA.proverUrl,
    discoveryUrl: advanced.discoveryUrl ?? SEPOLIA.discoveryUrl,
    paymasterUrl: advanced.paymasterUrl ?? SEPOLIA.paymasterUrl,
    appName: appName(identity.appName),
    nonce: nonce(identity.nonce),
  };
}

/** Read-only pinned stack configuration used by the doctor and workbench. */
export function loadPublicConfig(
  identity: ShadowIdentityOptions = {},
  advanced: ShadowAdvancedOptions = envAdvancedOptions(),
): PublicShadowConfig {
  return resolvePublicConfig(identity, advanced);
}

/** Resolve the minimal credential surface against the pinned Sepolia stack. */
export function createRuntimeConfig(
  credentials: ShadowAccountCredentials,
  identity: ShadowIdentityOptions = {},
  advanced: ShadowAdvancedOptions = {},
): ShadowRuntimeConfig {
  const publicConfig = resolvePublicConfig(identity, advanced);
  const accountAddress = parseAddress("accountAddress", credentials.accountAddress);
  const accountPrivateKey = credentials.accountPrivateKey.trim();
  const proverApiKey = credentials.starkscanApiKey.trim();
  const paymasterApiKey = credentials.avnuPaymasterApiKey.trim();
  if (!accountPrivateKey) throw new Error("accountPrivateKey must not be empty");
  if (!proverApiKey) throw new Error("starkscanApiKey must not be empty");
  if (!paymasterApiKey) throw new Error("avnuPaymasterApiKey must not be empty");
  const viewingKey = credentials.viewingKey ?? deriveDevelopmentViewingKey(
    accountPrivateKey,
    publicConfig.poolAddress,
  );
  if (
    typeof viewingKey !== "bigint" ||
    viewingKey <= 0n ||
    viewingKey >= (ec.starkCurve.CURVE.n >> 1n)
  ) {
    throw new Error("viewingKey is outside the SDK's accepted range");
  }
  const maxPaymasterFee = advanced.maxPaymasterFee ?? parseUnits("5", STRK_DECIMALS);
  if (typeof maxPaymasterFee !== "bigint" || maxPaymasterFee < 0n) {
    throw new Error("maxPaymasterFee must be a non-negative bigint");
  }
  return {
    ...publicConfig,
    accountAddress,
    accountPrivateKey,
    viewingKey,
    proverApiKey,
    paymasterApiKey,
    maxPaymasterFee,
    ...(advanced.discoveryOhttp === undefined
      ? {}
      : { discoveryOhttp: advanced.discoveryOhttp }),
  };
}

/** Load only credentials from the normal environment; advanced env overrides remain opt-in. */
export function loadRuntimeConfig(
  identity: ShadowIdentityOptions = {},
  advanced: ShadowAdvancedOptions = envAdvancedOptions(),
): ShadowRuntimeConfig {
  const explicitViewingKey = value("VIEWING_KEY");
  return createRuntimeConfig(
    {
      accountAddress: required("ACCOUNT_ADDRESS"),
      accountPrivateKey: required("ACCOUNT_PRIVATE_KEY"),
      starkscanApiKey: required("STARKSCAN_API_KEY"),
      avnuPaymasterApiKey: required("AVNU_PAYMASTER_API_KEY"),
      ...(explicitViewingKey ? { viewingKey: BigInt(explicitViewingKey) } : {}),
    },
    identity,
    advanced,
  );
}

/** Build the fixed transfer recipe from explicit CLI inputs, never hidden env state. */
export function loadShadowConfig(options: ShadowRecipeOptions): ShadowConfig {
  const runtimeConfig = loadRuntimeConfig(options);
  const spendAmount = positiveAmount(
    options.spendAmount ?? parseUnits("0.01", STRK_DECIMALS),
    "spend amount",
  );
  const shieldAmount = positiveAmount(
    options.shieldAmount ?? parseUnits("5", STRK_DECIMALS),
    "shield amount",
  );
  const recipientAddress = parseAddress("recipient", options.recipientAddress);
  if (BigInt(recipientAddress) === BigInt(runtimeConfig.accountAddress)) {
    throw new Error("recipient must differ from the root account to avoid a direct public link");
  }

  return {
    ...runtimeConfig,
    recipientAddress,
    spendAmount,
    shieldAmount,
  };
}
