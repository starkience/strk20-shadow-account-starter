import { constants } from 'starknet';

export const REQUIRED_WALLET_API = '0.10.4';
export const SHADOW_NONCE = '0x0';
export const STRK_TOKEN =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
export const STRK_DECIMALS = 18;

export type NetworkConfig = {
  label: string;
  chainId: string;
  rpcUrl: string;
  pool: string;
  anonymizer: string;
  explorer: string;
};

export const NETWORKS = {
  [constants.StarknetChainId.SN_MAIN]: {
    label: 'Mainnet',
    chainId: constants.StarknetChainId.SN_MAIN,
    rpcUrl:
      import.meta.env.VITE_MAINNET_RPC_URL ??
      'https://api.zan.top/public/starknet-mainnet/rpc/v0_10',
    pool: '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    anonymizer:
      '0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7',
    explorer: 'https://starkscan.co',
  },
  [constants.StarknetChainId.SN_SEPOLIA]: {
    label: 'Sepolia',
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    rpcUrl:
      import.meta.env.VITE_SEPOLIA_RPC_URL ??
      'https://starknet-sepolia-rpc.publicnode.com',
    pool: '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91',
    anonymizer:
      '0x010a2285310c107c731d997afc147afb7495daff6397c2d242133d9fe8d9b147',
    explorer: 'https://sepolia.starkscan.co',
  },
} as const satisfies Record<string, NetworkConfig>;

export type SupportedChainId = keyof typeof NETWORKS;

export const DAPP_NAME = (import.meta.env.VITE_SHADOW_DAPP_NAME ?? '').trim();

export function getNetwork(chainId: string | undefined): NetworkConfig | undefined {
  if (!chainId || !(chainId in NETWORKS)) return undefined;
  return NETWORKS[chainId as SupportedChainId];
}
