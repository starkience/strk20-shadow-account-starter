import {
  IndexerDiscoveryProvider,
  createPrivateTransfers,
} from "@starkware-libs/starknet-privacy-sdk";
import { Account, RpcProvider } from "starknet";
import type { ShadowConfig } from "./config";
import { SEPOLIA } from "./constants";

export function createSdkContext(config: ShadowConfig) {
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
