import {
  IndexerDiscoveryProvider,
  createPrivateTransfers,
} from "../vendor-sdk.js";
import { Account, RpcProvider } from "starknet";
import type { ShadowRuntimeConfig } from "./config.js";
import { SEPOLIA } from "./constants.js";
import { StarkscanProofProvider } from "./starkscan-prover.js";

export const DEFAULT_DISCOVERY_OHTTP_ENABLED = true;

export function createSdkContext(config: ShadowRuntimeConfig) {
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const account = new Account({
    provider,
    address: config.accountAddress,
    signer: config.accountPrivateKey,
    cairoVersion: "1",
  });
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => config.viewingKey },
    provingProvider: new StarkscanProofProvider({
      endpoint: config.proverUrl,
      apiKey: config.proverApiKey,
      chainId: SEPOLIA.chainId,
      rpcUrl: config.rpcUrl,
      poolAddress: config.poolAddress,
    }),
    discoveryProvider: new IndexerDiscoveryProvider(
      config.discoveryUrl,
      config.poolAddress,
      { ohttp: config.discoveryOhttp ?? DEFAULT_DISCOVERY_OHTTP_ENABLED },
    ),
    poolContractAddress: config.poolAddress,
    shadowAccountAnonymizerAddress: config.anonymizerAddress,
  });
  return { provider, account, transfers };
}
