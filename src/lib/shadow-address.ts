import { hash } from "starknet";
import { PRIMER_CLASS_HASH } from "./constants.js";

export function shadowAddressFromCommitment(
  commitment: bigint,
  anonymizerAddress: bigint,
): string {
  return normalizeAddress(
    hash.calculateContractAddressFromHash(
      commitment,
      PRIMER_CLASS_HASH,
      [],
      anonymizerAddress,
    ),
  );
}

export function normalizeAddress(value: string | bigint | number): string {
  return `0x${BigInt(value).toString(16)}`;
}

export function sameAddress(
  left: string | bigint | number,
  right: string | bigint | number,
): boolean {
  return BigInt(left) === BigInt(right);
}
