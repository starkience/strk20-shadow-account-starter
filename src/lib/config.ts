import { ec, shortString } from "starknet";
import type { OhttpOption } from "../vendor-sdk.js";
import { parseUnits } from "./amounts.js";
import { SEPOLIA, STRK_DECIMALS } from "./constants.js";
import { deriveDevelopmentViewingKey } from "./viewing-key.js";

export interface ShadowRuntimeConfig {
  readonly accountAddress: string;
  readonly accountPrivateKey: string;
  readonly viewingKey: bigint;
  readonly rpcUrl: string;
  readonly poolAddress: string;
  readonly tokenAddress: string;
  readonly anonymizerAddress: string;
  readonly proverUrl: string;
  readonly discoveryUrl: string;
  readonly paymasterUrl: string;
  readonly paymasterApiKey: string;
  readonly appName: string;
  readonly nonce: bigint;
  readonly maxPaymasterFee: bigint;
  /** Defaults to OHTTP enabled for the pinned proving service. */
  readonly provingOhttp?: OhttpOption;
  /** Defaults to OHTTP enabled for the pinned discovery service. */
  readonly discoveryOhttp?: OhttpOption;
}

/** Configuration used only by the included shield-and-transfer recipe. */
export interface ShadowConfig extends ShadowRuntimeConfig {
  readonly recipientAddress: string;
  readonly spendAmount: bigint;
  readonly shieldAmount: bigint;
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

function address(name: string, fallback?: string): string {
  const result = value(name, fallback);
  try {
    const parsed = BigInt(result);
    if (parsed <= 0n) throw new Error("zero");
    return `0x${parsed.toString(16)}`;
  } catch {
    throw new Error(`${name} must be a non-zero Starknet address`);
  }
}

function nonNegativeInteger(name: string, fallback: string): bigint {
  const raw = value(name, fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(raw);
}

function appName(): string {
  const result = value("SHADOW_APP_NAME", "shadow-starter");
  try {
    shortString.encodeShortString(result);
  } catch {
    throw new Error("SHADOW_APP_NAME must fit in a Cairo short string (31 ASCII characters)");
  }
  return result;
}

export function loadPublicConfig(): PublicShadowConfig {
  return {
    rpcUrl: value("STARKNET_RPC_URL", SEPOLIA.rpcUrl),
    poolAddress: address("POOL_ADDRESS", SEPOLIA.poolAddress),
    tokenAddress: address("STRK_TOKEN_ADDRESS", SEPOLIA.strkTokenAddress),
    anonymizerAddress: address(
      "SHADOW_ACCOUNT_ANONYMIZER_ADDRESS",
      SEPOLIA.shadowAccountAnonymizerAddress,
    ),
    proverUrl: value("PROVER_URL", SEPOLIA.proverUrl),
    discoveryUrl: value("DISCOVERY_URL", SEPOLIA.discoveryUrl),
    paymasterUrl: value("AVNU_PAYMASTER_URL", SEPOLIA.paymasterUrl),
    appName: appName(),
    nonce: nonNegativeInteger("SHADOW_NONCE", "0"),
  };
}

export function loadRuntimeConfig(): ShadowRuntimeConfig {
  const publicConfig = loadPublicConfig();
  const accountPrivateKey = required("ACCOUNT_PRIVATE_KEY");
  const accountAddress = address("ACCOUNT_ADDRESS");
  const explicitViewingKey = value("VIEWING_KEY");
  const viewingKey = explicitViewingKey
    ? BigInt(explicitViewingKey)
    : deriveDevelopmentViewingKey(accountPrivateKey, publicConfig.poolAddress);
  if (viewingKey <= 0n || viewingKey >= (ec.starkCurve.CURVE.n >> 1n)) {
    throw new Error("VIEWING_KEY is outside the SDK's accepted range");
  }
  const maxPaymasterFee = parseUnits(
    value("MAX_PAYMASTER_FEE_STRK", "5"),
    STRK_DECIMALS,
  );
  return {
    ...publicConfig,
    accountAddress,
    accountPrivateKey,
    viewingKey,
    paymasterApiKey: required("AVNU_PAYMASTER_API_KEY"),
    maxPaymasterFee,
  };
}

export function loadShadowConfig(): ShadowConfig {
  const runtimeConfig = loadRuntimeConfig();
  const spendAmount = parseUnits(value("SPEND_AMOUNT_STRK", "0.01"), STRK_DECIMALS);
  const shieldAmount = parseUnits(value("SHIELD_AMOUNT_STRK", "5"), STRK_DECIMALS);
  if (spendAmount <= 0n) throw new Error("SPEND_AMOUNT_STRK must be positive");
  if (shieldAmount <= 0n) throw new Error("SHIELD_AMOUNT_STRK must be positive");
  const recipientAddress = address("RECIPIENT_ADDRESS");
  if (BigInt(recipientAddress) === BigInt(runtimeConfig.accountAddress)) {
    throw new Error("RECIPIENT_ADDRESS must differ from ACCOUNT_ADDRESS to avoid a direct public link");
  }

  return {
    ...runtimeConfig,
    recipientAddress,
    spendAmount,
    shieldAmount,
  };
}
