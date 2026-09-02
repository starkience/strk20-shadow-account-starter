import {
  IndexerDiscoveryProvider,
  OhttpClient,
  ProvingService,
} from "../src/vendor-sdk.js";
import { RpcProvider, constants, hash } from "starknet";
import compatibility from "../compatibility.json" with { type: "json" };
import { loadPublicConfig } from "../src/lib/config";
import { heading, ok, warn, fail } from "./terminal";
import {
  PRIVATE_PAYMASTER_FEE_MODE,
  PrivatePaymaster,
} from "../src/lib/private-paymaster";
import { sameAddress } from "../src/lib/shadow-address";
import { DEFAULT_OHTTP_ENABLED } from "../src/lib/sdk";
import { SEPOLIA } from "../src/lib/constants";
import { hasImplementationFinalizedEvent } from "./anonymizer-deployment";

async function main(): Promise<void> {
  heading("STRK20 shadow-account doctor");
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) throw new Error(`Node 24+ required; found ${process.versions.node}`);
  ok(`Node ${process.versions.node}`);

  const config = loadPublicConfig();
  assertSame("privacy pool address", config.poolAddress, compatibility.poolAddress);
  assertSame("STRK token address", config.tokenAddress, compatibility.strkTokenAddress);
  assertSame(
    "shadow anonymizer address",
    config.anonymizerAddress,
    compatibility.shadowAccountAnonymizerAddress,
  );
  assertExact("private paymaster URL", config.paymasterUrl, compatibility.paymasterUrl);
  assertExact(
    "private paymaster fee mode",
    PRIVATE_PAYMASTER_FEE_MODE,
    compatibility.paymasterFeeMode,
  );
  if (DEFAULT_OHTTP_ENABLED !== compatibility.ohttpEnabled) {
    throw new Error("default OHTTP setting no longer matches compatibility.json");
  }
  ok("configured deployment and paymaster pins match compatibility.json");

  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const chainId = await provider.getChainId();
  if (chainId !== constants.StarknetChainId.SN_SEPOLIA) {
    throw new Error(`RPC is not Starknet Sepolia: ${chainId}`);
  }
  ok("RPC is Starknet Sepolia");

  for (const [label, address, expectedClassHash] of [
    ["privacy pool", config.poolAddress, compatibility.poolClassHash],
    [
      "shadow anonymizer",
      config.anonymizerAddress,
      compatibility.shadowAccountAnonymizerClassHash,
    ],
    ["STRK token", config.tokenAddress, compatibility.strkTokenClassHash],
  ] as const) {
    const classHash = await provider.getClassHashAt(address);
    assertSame(`${label} class hash`, classHash, expectedClassHash);
    ok(`${label} class hash matches (${short(classHash)})`);
  }

  const boundPool = await provider.callContract({
    contractAddress: config.anonymizerAddress,
    entrypoint: "get_privacy_contract",
    calldata: [],
  });
  assertSame("anonymizer-bound privacy pool", boundPool[0] ?? 0n, config.poolAddress);

  const shadowClass = await provider.callContract({
    contractAddress: config.anonymizerAddress,
    entrypoint: "get_shadow_account_class_hash",
    calldata: [],
  });
  assertSame(
    "anonymizer shadow-account class hash",
    shadowClass[0] ?? 0n,
    compatibility.shadowAccountClassHash,
  );

  const screeningPolicy = await provider.callContract({
    contractAddress: config.poolAddress,
    entrypoint: "get_open_note_screening_policy",
    calldata: [config.anonymizerAddress],
  });
  assertSame(
    "anonymizer open-note screening policy",
    screeningPolicy[0] ?? -1n,
    compatibility.anonymizerOpenNoteScreeningPolicyValue,
  );

  const upgradeDelay = await provider.callContract({
    contractAddress: config.anonymizerAddress,
    entrypoint: "get_upgrade_delay",
    calldata: [],
  });
  if (BigInt(upgradeDelay[0] ?? -1) !== BigInt(compatibility.anonymizerUpgradeDelaySeconds)) {
    throw new Error("anonymizer upgrade delay no longer matches compatibility.json");
  }

  const finalization = await provider.getEvents({
    from_block: { block_number: compatibility.anonymizerDeploymentBlock },
    to_block: "latest",
    address: config.anonymizerAddress,
    keys: [[hash.getSelectorFromName("ImplementationFinalized")]],
    chunk_size: 10,
  });
  const implementationFinalized = hasImplementationFinalizedEvent(
    finalization.events,
    config.anonymizerAddress,
    compatibility.shadowAccountAnonymizerClassHash,
  );
  if (implementationFinalized !== compatibility.anonymizerImplementationFinalized) {
    throw new Error("anonymizer finalization state no longer matches compatibility.json");
  }

  const anonymizerClass = await provider.getClassAt(config.anonymizerAddress);
  const privacyInvokeOutputs = functionOutputs(
    Array.isArray(anonymizerClass.abi) ? anonymizerClass.abi : [],
    "privacy_invoke_with_computation",
  );
  if (
    privacyInvokeOutputs.length !== 1 ||
    privacyInvokeOutputs[0] !== compatibility.anonymizerPrivacyInvokeOutput
  ) {
    throw new Error(
      `anonymizer invoke ABI is incompatible: expected ${compatibility.anonymizerPrivacyInvokeOutput}`,
    );
  }
  ok(
    `anonymizer is bound to the pool with ${compatibility.anonymizerOpenNoteScreeningPolicy} screening and the pinned invoke ABI`,
  );

  const prover = new ProvingService({ baseUrl: config.proverUrl, requestTimeoutMs: 15_000 });
  if (!(await prover.isHealthy())) throw new Error("Proving service is unavailable");
  ok("proving service is healthy");

  const discovery = new IndexerDiscoveryProvider(config.discoveryUrl, config.poolAddress);
  if (!(await discovery.isHealthy())) throw new Error("Discovery service is unavailable");
  ok("discovery service is healthy");

  const ohttpProbeBlock = (await provider.getBlockNumber()) - SEPOLIA.provingDepthBlocks;
  const privateDiscovery = new IndexerDiscoveryProvider(
    config.discoveryUrl,
    config.poolAddress,
    { ohttp: true },
  );
  await privateDiscovery.discoverNotes(1n, 1n, {
    tokens: [BigInt(config.tokenAddress)],
    blockIdentifier: ohttpProbeBlock,
  });
  const privateProver = new ProvingService({
    baseUrl: config.proverUrl,
    requestTimeoutMs: 15_000,
    ohttpClient: new OhttpClient(config.proverUrl),
  });
  const proverSpecVersion = await privateProver.getSpecVersion();
  assertExact("prover specification version", proverSpecVersion, compatibility.proverSpecVersion);
  ok("prover and discovery OHTTP transports accept encrypted requests");

  ok("Privacy SDK is pinned locally; no StarkWare package credentials required");

  if (compatibility.anonymizerProvenanceStatus === "verified-build-finalized") {
    ok("anonymizer class reproduces from pinned StarkWare source and is permanently finalized");
  } else if (compatibility.anonymizerProvenanceStatus === "verified-build") {
    ok("anonymizer class reproduces from the pinned StarkWare source and compiler");
  } else {
    warn(
      "Runtime compatibility passes, but the anonymizer build provenance is not independently reproducible yet.",
    );
  }
  if (!implementationFinalized) {
    warn(
      "Pinned anonymizer is community-governed, unfinalized, and upgradeable with zero delay; run this doctor immediately before writes.",
    );
  }

  const paymasterApiKey = process.env.AVNU_PAYMASTER_API_KEY?.trim() ?? "";
  const paymaster = new PrivatePaymaster(config.paymasterUrl, paymasterApiKey);
  const publicQuote = await paymaster.probePool(config.poolAddress, config.tokenAddress);
  if (publicQuote && !sameAddress(publicQuote.token, config.tokenAddress)) {
    throw new Error("Paymaster probe returned a fee in an unexpected token");
  }
  ok("private paymaster endpoint accepts the pinned Sepolia pool");

  if (paymasterApiKey) {
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
    console.log("\nRuntime stack is compatible. Add the missing server-side credentials before running a write.");
  } else {
    ok("demo credentials are configured");
    console.log("\nReady for a credentialed write. Run `pnpm shadow:demo`.");
  }
}

function short(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function assertSame(label: string, actual: string | bigint | number, expected: string): void {
  if (!sameAddress(actual, expected)) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${String(actual)}`);
  }
}

function assertExact(label: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

function functionOutputs(abi: readonly unknown[], name: string): string[] {
  for (const candidate of abi) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as { type?: unknown; name?: unknown; items?: unknown; outputs?: unknown };
    if (item.type === "function" && item.name === name) return outputTypes(item.outputs);
    if (item.type === "interface" && Array.isArray(item.items)) {
      const nested = functionOutputs(item.items, name);
      if (nested.length) return nested;
    }
  }
  return [];
}

function outputTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((output) => {
    if (!output || typeof output !== "object") return [];
    const type = (output as { type?: unknown }).type;
    return typeof type === "string" ? [type] : [];
  });
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
