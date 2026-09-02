import { Account, RpcProvider, constants, hash } from "starknet";
import compatibility from "../compatibility.json" with { type: "json" };
import { waitForSuccessfulTransaction } from "../src/lib/chain.js";
import { normalizeAddress, sameAddress } from "../src/lib/shadow-address.js";
import { fail, heading, ok } from "./terminal";

const DEFAULT_SALT = "0x5354524b32305f534841444f575f535441525445525f5631";

async function main(): Promise<void> {
  heading("Deploy and finalize a starter-owned shadow anonymizer");
  const rpcUrl = process.env.STARKNET_RPC_URL?.trim() ||
    "https://starknet-sepolia-rpc.publicnode.com";
  const accountAddress = requiredAddress("ACCOUNT_ADDRESS");
  const accountPrivateKey = required("ACCOUNT_PRIVATE_KEY");
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  if ((await provider.getChainId()) !== constants.StarknetChainId.SN_SEPOLIA) {
    throw new Error("STARKNET_RPC_URL must point to Starknet Sepolia");
  }
  const account = new Account({
    provider,
    address: accountAddress,
    signer: accountPrivateKey,
    cairoVersion: "1",
  });

  let anonymizerAddress = optionalAddress("ANONYMIZER_ADDRESS");
  if (!anonymizerAddress) {
    const salt = process.env.ANONYMIZER_DEPLOYMENT_SALT?.trim() || DEFAULT_SALT;
    if (BigInt(salt) < 0n) throw new Error("ANONYMIZER_DEPLOYMENT_SALT must be non-negative");
    const deployment = await account.deployContract(
      {
        classHash: compatibility.shadowAccountAnonymizerClassHash,
        salt: normalizeAddress(salt),
        unique: false,
        constructorCalldata: [
          compatibility.poolAddress,
          compatibility.shadowAccountClassHash,
          accountAddress,
        ],
      },
      { tip: 0n },
    );
    anonymizerAddress = normalizeAddress(deployment.contract_address);
    console.log(`Deployment transaction: ${deployment.transaction_hash}`);
    await waitForSuccessfulTransaction(provider, deployment.transaction_hash);
    ok(`deployed ${anonymizerAddress}`);
  } else {
    ok(`using existing deployment ${anonymizerAddress}`);
  }

  await assertRuntime(provider, anonymizerAddress);

  // This root-account execution is contract administration, not a shadow
  // invocation. Shadow invocations remain private-paymaster-only.
  const implementationData = [
    compatibility.shadowAccountAnonymizerClassHash,
    "0x1", // Option<EICData>::None
    "0x1", // final = true
  ];
  const finalization = await account.execute(
    [
      {
        contractAddress: anonymizerAddress,
        entrypoint: "add_new_implementation_unsafe",
        calldata: implementationData,
      },
      {
        contractAddress: anonymizerAddress,
        entrypoint: "replace_to",
        calldata: implementationData,
      },
    ],
    { tip: 0n },
  );
  const receipt = await waitForSuccessfulTransaction(provider, finalization.transaction_hash);
  const finalizedSelector = hash.getSelectorFromName("ImplementationFinalized");
  const finalized = receipt.events.some(
    (event) =>
      sameAddress(event.from_address, anonymizerAddress) &&
      event.keys[0] !== undefined &&
      sameAddress(event.keys[0], finalizedSelector) &&
      event.data.some((value) =>
        sameAddress(value, compatibility.shadowAccountAnonymizerClassHash),
      ),
  );
  if (!finalized) throw new Error("Finalization receipt is missing ImplementationFinalized");
  await assertRuntime(provider, anonymizerAddress);

  ok("implementation finalized; future class replacements are disabled");
  console.log(`Finalization transaction: ${finalization.transaction_hash}`);
  console.log("Update compatibility.json with this address and both transaction hashes, then run pnpm shadow:doctor.");
}

async function assertRuntime(provider: RpcProvider, address: string): Promise<void> {
  const classHash = await provider.getClassHashAt(address);
  if (!sameAddress(classHash, compatibility.shadowAccountAnonymizerClassHash)) {
    throw new Error("Anonymizer class hash does not match the verified build");
  }
  const [pool] = await provider.callContract({
    contractAddress: address,
    entrypoint: "get_privacy_contract",
    calldata: [],
  });
  if (!sameAddress(pool ?? 0n, compatibility.poolAddress)) {
    throw new Error("Anonymizer is not bound to the pinned pool");
  }
  const [shadowClass] = await provider.callContract({
    contractAddress: address,
    entrypoint: "get_shadow_account_class_hash",
    calldata: [],
  });
  if (!sameAddress(shadowClass ?? 0n, compatibility.shadowAccountClassHash)) {
    throw new Error("Anonymizer does not use the pinned shadow-account class");
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function requiredAddress(name: string): string {
  return parseAddress(required(name), name);
}

function optionalAddress(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? parseAddress(value, name) : undefined;
}

function parseAddress(value: string, name: string): string {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) throw new Error("zero");
    return normalizeAddress(parsed);
  } catch {
    throw new Error(`${name} must be a non-zero Starknet address`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
