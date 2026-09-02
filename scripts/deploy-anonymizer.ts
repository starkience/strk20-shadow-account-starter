import { Account, RpcProvider, constants, validateAndParseAddress } from "starknet";
import compatibility from "../compatibility.json" with { type: "json" };
import { readU256, waitForSuccessfulTransaction } from "../src/lib/chain.js";
import { normalizeAddress, sameAddress } from "../src/lib/shadow-address.js";
import {
  buildAnonymizerFinalizationCalls,
  calculateAnonymizerAddress,
  hasImplementationFinalizedEvent,
  IMPLEMENTATION_FINALIZED_SELECTOR,
  isContractNotFound,
  UPGRADE_GOVERNOR_ROLE,
} from "./anonymizer-deployment";
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
  await assertAccountDeployed(provider, accountAddress);
  const account = new Account({
    provider,
    address: accountAddress,
    signer: accountPrivateKey,
    cairoVersion: "1",
  });

  const salt = parseFelt(
    process.env.ANONYMIZER_DEPLOYMENT_SALT?.trim() || DEFAULT_SALT,
    "ANONYMIZER_DEPLOYMENT_SALT",
  );
  const constructorCalldata = [
    compatibility.poolAddress,
    compatibility.shadowAccountClassHash,
    accountAddress,
  ];
  const expectedAddress = calculateAnonymizerAddress({
    salt,
    classHash: compatibility.shadowAccountAnonymizerClassHash,
    poolAddress: compatibility.poolAddress,
    shadowAccountClassHash: compatibility.shadowAccountClassHash,
    governanceAdmin: accountAddress,
  });
  let anonymizerAddress = optionalAddress("ANONYMIZER_ADDRESS");
  if (anonymizerAddress && !sameAddress(anonymizerAddress, expectedAddress)) {
    throw new Error(
      `ANONYMIZER_ADDRESS does not match the deterministic deployment address ${expectedAddress}`,
    );
  }
  if (!anonymizerAddress) {
    const existingClassHash = await classHashIfDeployed(provider, expectedAddress);
    if (existingClassHash) {
      if (!sameAddress(existingClassHash, compatibility.shadowAccountAnonymizerClassHash)) {
        throw new Error("Deterministic anonymizer address contains an unexpected class");
      }
      anonymizerAddress = expectedAddress;
      ok(`resuming deterministic deployment ${anonymizerAddress}`);
    } else {
      await assertPublicStrk(provider, accountAddress);
      const deployment = await account.deployContract(
        {
          classHash: compatibility.shadowAccountAnonymizerClassHash,
          salt,
          unique: false,
          constructorCalldata,
        },
        { tip: 0n },
      );
      anonymizerAddress = normalizeAddress(deployment.contract_address);
      if (!sameAddress(anonymizerAddress, expectedAddress)) {
        throw new Error("UDC returned an unexpected deterministic deployment address");
      }
      console.log(`Deployment transaction: ${deployment.transaction_hash}`);
      await waitForSuccessfulTransaction(provider, deployment.transaction_hash);
      ok(`deployed ${anonymizerAddress}`);
    }
  } else {
    ok(`using existing deployment ${anonymizerAddress}`);
  }

  await assertRuntime(provider, anonymizerAddress);
  if (await isImplementationFinalized(provider, anonymizerAddress)) {
    ok("implementation was already finalized; no transaction was submitted");
    console.log(`Anonymizer address: ${anonymizerAddress}`);
    return;
  }
  await assertPublicStrk(provider, accountAddress);

  // This root-account execution is contract administration, not a shadow
  // invocation. Shadow invocations remain private-paymaster-only.
  const finalization = await account.execute(
    buildAnonymizerFinalizationCalls(
      anonymizerAddress,
      compatibility.shadowAccountAnonymizerClassHash,
      accountAddress,
    ),
    { tip: 0n },
  );
  const receipt = await waitForSuccessfulTransaction(provider, finalization.transaction_hash);
  const finalized = hasImplementationFinalizedEvent(
    receipt.events,
    anonymizerAddress,
    compatibility.shadowAccountAnonymizerClassHash,
  );
  if (!finalized) throw new Error("Finalization receipt is missing ImplementationFinalized");
  await assertRuntime(provider, anonymizerAddress);
  await assertUpgradeRoleRemoved(provider, anonymizerAddress, accountAddress);

  ok("implementation finalized; future class replacements are disabled");
  console.log(`Anonymizer address: ${anonymizerAddress}`);
  console.log(`Finalization transaction: ${finalization.transaction_hash}`);
  console.log("Update compatibility.json with this address and both transaction hashes, then run pnpm shadow:doctor.");
}

async function assertUpgradeRoleRemoved(
  provider: RpcProvider,
  anonymizerAddress: string,
  accountAddress: string,
): Promise<void> {
  const [hasRole] = await provider.callContract({
    contractAddress: anonymizerAddress,
    entrypoint: "has_role",
    calldata: [UPGRADE_GOVERNOR_ROLE, accountAddress],
  });
  if (BigInt(hasRole ?? 0n) !== 0n) {
    throw new Error("Temporary UpgradeGovernor role was not removed");
  }
}

async function assertAccountDeployed(
  provider: RpcProvider,
  accountAddress: string,
): Promise<void> {
  try {
    await provider.getClassHashAt(accountAddress);
  } catch (error) {
    if (isContractNotFound(error)) {
      throw new Error("ACCOUNT_ADDRESS must be deployed on Starknet Sepolia");
    }
    throw error;
  }
  ok("deployment account exists on Sepolia");
}

async function assertPublicStrk(
  provider: RpcProvider,
  accountAddress: string,
): Promise<void> {
  const balance = await readU256(
    provider,
    compatibility.strkTokenAddress,
    "balanceOf",
    [accountAddress],
  );
  if (balance === 0n) {
    throw new Error("ACCOUNT_ADDRESS needs public Sepolia STRK for deployment fees");
  }
  ok("deployment account has public STRK");
}

async function classHashIfDeployed(
  provider: RpcProvider,
  address: string,
): Promise<string | undefined> {
  try {
    return await provider.getClassHashAt(address);
  } catch (error) {
    if (isContractNotFound(error)) return undefined;
    throw error;
  }
}

async function isImplementationFinalized(
  provider: RpcProvider,
  address: string,
): Promise<boolean> {
  const response = await provider.getEvents({
    from_block: { block_number: compatibility.anonymizerDeclarationBlock },
    to_block: "latest",
    address,
    keys: [[IMPLEMENTATION_FINALIZED_SELECTOR]],
    chunk_size: 10,
  });
  return hasImplementationFinalizedEvent(
    response.events,
    address,
    compatibility.shadowAccountAnonymizerClassHash,
  );
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
    const parsed = validateAndParseAddress(value);
    if (BigInt(parsed) === 0n) throw new Error("zero");
    return normalizeAddress(parsed);
  } catch {
    throw new Error(`${name} must be a non-zero Starknet address`);
  }
}

function parseFelt(value: string, name: string): string {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed >= constants.PRIME) throw new Error("outside field");
    return normalizeAddress(parsed);
  } catch {
    throw new Error(`${name} must be a non-negative Starknet field element`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
