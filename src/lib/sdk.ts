import {
  IndexerDiscoveryProvider,
  createPrivateTransfers,
} from "../vendor-sdk.js";
import { Account, RpcProvider } from "starknet";
import type { ShadowRuntimeConfig } from "./config.js";
import { SEPOLIA } from "./constants.js";

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
    provingProvider: {
      url: config.proverUrl,
      chainId: SEPOLIA.chainId,
      nodeUrl: config.rpcUrl,
      requestTimeoutMs: 180_000,
      retry: { maxRetries: 3, baseDelayMs: 1_000 },
    },
    discoveryProvider: new IndexerDiscoveryProvider(
      config.discoveryUrl,
      config.poolAddress,
    ),
    poolContractAddress: config.poolAddress,
    shadowAccountAnonymizerAddress: config.anonymizerAddress,
  });
  return { provider, account, transfers };
}
