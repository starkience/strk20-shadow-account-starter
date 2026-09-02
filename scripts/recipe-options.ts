import { parseArgs } from "node:util";
import type { ShadowRecipeOptions } from "../src/lib/config";
import { parseUnits } from "../src/lib/amounts";
import { STRK_DECIMALS } from "../src/lib/constants";

export interface WorkbenchRecipeOptions {
  readonly recipientAddress?: string;
  readonly spendAmount: bigint;
  readonly shieldAmount: bigint;
  readonly appName: string;
  readonly nonce: bigint;
}

const recipeFlags = {
  recipient: { type: "string" },
  "spend-amount": { type: "string", default: "0.01" },
  "shield-amount": { type: "string", default: "5" },
  "app-name": { type: "string", default: "shadow-starter" },
  nonce: { type: "string", default: "0" },
} as const;

export function parseShadowRecipeOptions(args: string[]): ShadowRecipeOptions {
  const parsed = parseRecipe(args);
  if (!parsed.recipientAddress) {
    throw new Error("Missing --recipient 0x... for the transfer recipe");
  }
  return { ...parsed, recipientAddress: parsed.recipientAddress };
}

export function parseWorkbenchRecipeOptions(args: string[]): WorkbenchRecipeOptions {
  return parseRecipe(args);
}

export function parseShieldAmount(args: string[]): bigint {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { amount: { type: "string", default: "5" } },
  });
  return positiveStrk(values.amount, "--amount");
}

function parseRecipe(args: string[]): WorkbenchRecipeOptions {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: recipeFlags,
  });
  const nonce = values.nonce;
  if (!nonce || !/^\d+$/.test(nonce)) {
    throw new Error("--nonce must be a non-negative integer");
  }
  return {
    ...(values.recipient ? { recipientAddress: values.recipient } : {}),
    spendAmount: positiveStrk(values["spend-amount"], "--spend-amount"),
    shieldAmount: positiveStrk(values["shield-amount"], "--shield-amount"),
    appName: values["app-name"] || "shadow-starter",
    nonce: BigInt(nonce),
  };
}

function positiveStrk(value: string | undefined, flag: string): bigint {
  try {
    const amount = parseUnits(value ?? "", STRK_DECIMALS);
    if (amount <= 0n) throw new Error("non-positive");
    return amount;
  } catch {
    throw new Error(`${flag} must be a positive decimal STRK amount`);
  }
}
