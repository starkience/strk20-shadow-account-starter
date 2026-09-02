import { constants } from "starknet";

export const SEPOLIA = {
  chainId: constants.StarknetChainId.SN_SEPOLIA,
  rpcUrl: "https://starknet-sepolia-rpc.publicnode.com",
  poolAddress:
    "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  strkTokenAddress:
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  shadowAccountAnonymizerAddress:
    "0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f",
  proverUrl: "https://api.starkscan.co/v1/SN_SEPOLIA/prove",
  discoveryUrl: "https://discovery-service.alpha-sepolia.sw-dev.io",
  paymasterUrl: "https://sepolia.paymaster.avnu.fi",
  provingDepthBlocks: 10,
  noteMaturityBlocks: 10,
  explorerUrl: "https://sepolia.voyager.online",
} as const;

export const STRK_DECIMALS = 18;
export const STARKSCAN_PROVER_PROVIDER = "starkscan-async-v1";
export const STARKSCAN_NETWORK = "SN_SEPOLIA";

/**
 * The primer class used by the pinned Sepolia shadow-account anonymizer.
 * The address formula is covered by a committed upstream-derived vector.
 */
export const PRIMER_CLASS_HASH =
  0x00123e6bc1c14ae9934e933d3f64916a6116dd6b036a922b2b1f0815e0d1d300n;
