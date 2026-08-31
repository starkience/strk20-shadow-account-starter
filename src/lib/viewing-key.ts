import { constants, ec, hash } from "starknet";

/**
 * Deterministically derives a viewing key for a dedicated development account.
 * Production wallets should provide and retain their own viewing key instead.
 */
export function deriveDevelopmentViewingKey(
  privateKey: string,
  poolAddress: string,
  chainId = constants.StarknetChainId.SN_SEPOLIA,
): bigint {
  const messageHash = hash.starknetKeccak(`${chainId}:${poolAddress}`);
  const signature = ec.starkCurve.sign(`0x${messageHash.toString(16)}`, privateKey);
  const folded = BigInt(hash.computePoseidonHashOnElements([signature.r, signature.s]));
  const order = ec.starkCurve.CURVE.n;
  const halfOrder = order >> 1n;
  const reduced = folded % order;
  const canonical = reduced < halfOrder ? reduced : order - reduced;
  return canonical === 0n ? 1n : canonical;
}
