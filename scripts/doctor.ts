import {
  IndexerDiscoveryProvider,
  ProvingService,
} from "@starkware-libs/starknet-privacy-sdk";
import { RpcProvider, constants } from "starknet";
import { loadPublicConfig } from "../src/lib/config";
import { heading, ok, warn, fail } from "./terminal";
import { PrivatePaymaster } from "../src/lib/private-paymaster";
import { sameAddress } from "../src/lib/shadow-address";

async function main(): Promise<void> {
  heading("STRK20 shadow-account doctor");
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) throw new Error(`Node 24+ required; found ${process.versions.node}`);
  ok(`Node ${process.versions.node}`);

  const config = loadPublicConfig();
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const chainId = await provider.getChainId();
  if (chainId !== constants.StarknetChainId.SN_SEPOLIA) {
    throw new Error(`RPC is not Starknet Sepolia: ${chainId}`);
  }
  ok("RPC is Starknet Sepolia");

  for (const [label, address] of [
    ["privacy pool", config.poolAddress],
    ["shadow anonymizer", config.anonymizerAddress],
    ["STRK token", config.tokenAddress],
  ] as const) {
    const classHash = await provider.getClassHashAt(address);
    ok(`${label} deployed (${short(classHash)})`);
  }

  const prover = new ProvingService({ baseUrl: config.proverUrl, requestTimeoutMs: 15_000 });
  if (!(await prover.isHealthy())) throw new Error("Proving service is unavailable");
  ok("proving service is healthy");

  const discovery = new IndexerDiscoveryProvider(config.discoveryUrl, config.poolAddress);
  if (!(await discovery.isHealthy())) throw new Error("Discovery service is unavailable");
  ok("discovery service is healthy");

  ok("Privacy SDK is pinned locally; no StarkWare package credentials required");

  const paymasterApiKey = process.env.AVNU_PAYMASTER_API_KEY?.trim();
  if (paymasterApiKey) {
    const paymaster = new PrivatePaymaster(config.paymasterUrl, paymasterApiKey);
    const quote = await paymaster.build(config.poolAddress, config.tokenAddress);
    if (quote.fee && !sameAddress(quote.fee.token, config.tokenAddress)) {
      throw new Error("Paymaster returned a fee in an unexpected token");
    }
    ok("private paymaster credentials and quote schema are valid");
  }

  const missing = ["ACCOUNT_ADDRESS", "ACCOUNT_PRIVATE_KEY", "RECIPIENT_ADDRESS", "AVNU_PAYMASTER_API_KEY"]
    .filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    warn(`Demo credentials still needed: ${missing.join(", ")}`);
  } else {
    ok("demo credentials are configured");
  }

  console.log("\nReady for development. Run `pnpm shadow:demo` after filling .env.");
}

function short(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
