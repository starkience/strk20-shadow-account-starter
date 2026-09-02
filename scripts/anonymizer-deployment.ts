import { hash } from "starknet";
import { normalizeAddress, sameAddress } from "../src/lib/shadow-address";

export const IMPLEMENTATION_FINALIZED_SELECTOR = hash.getSelectorFromName(
  "ImplementationFinalized",
);

// Role::UpgradeGovernor serializes to this RoleId in the exact starkware_utils
// revision pinned by the anonymizer's Scarb.lock.
export const UPGRADE_GOVERNOR_ROLE =
  "0x251e864ca2a080f55bce5da2452e8cfcafdbc951a3e7fff5023d558452ec228";

export interface AnonymizerDeploymentInputs {
  readonly salt: string;
  readonly classHash: string;
  readonly poolAddress: string;
  readonly shadowAccountClassHash: string;
  readonly governanceAdmin: string;
}

export interface AnonymizerCall {
  readonly contractAddress: string;
  readonly entrypoint: string;
  readonly calldata: string[];
}

export function calculateAnonymizerAddress(inputs: AnonymizerDeploymentInputs): string {
  return normalizeAddress(hash.calculateContractAddressFromHash(
    inputs.salt,
    inputs.classHash,
    [inputs.poolAddress, inputs.shadowAccountClassHash, inputs.governanceAdmin],
    0,
  ));
}

export function buildAnonymizerFinalizationCalls(
  anonymizerAddress: string,
  classHash: string,
  governanceAdmin: string,
): AnonymizerCall[] {
  const implementationData = [
    classHash,
    "0x1", // Option<EICData>::None
    "0x1", // final = true
  ];
  const roleCalldata = [UPGRADE_GOVERNOR_ROLE, governanceAdmin];
  return [
    {
      contractAddress: anonymizerAddress,
      entrypoint: "grant_role",
      calldata: roleCalldata,
    },
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
    {
      contractAddress: anonymizerAddress,
      entrypoint: "revoke_role",
      calldata: roleCalldata,
    },
  ];
}

export function hasImplementationFinalizedEvent(
  events: readonly unknown[],
  anonymizerAddress: string,
  classHash: string,
): boolean {
  return events.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const event = candidate as { from_address?: string; keys?: string[]; data?: string[] };
    return (
      event.from_address !== undefined &&
      sameAddress(event.from_address, anonymizerAddress) &&
      event.keys?.[0] !== undefined &&
      sameAddress(event.keys[0], IMPLEMENTATION_FINALIZED_SELECTOR) &&
      event.data?.[0] !== undefined &&
      sameAddress(event.data[0], classHash)
    );
  });
}

export function isContractNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; baseError?: { code?: unknown } };
  return candidate.code === 20 || candidate.baseError?.code === 20;
}
