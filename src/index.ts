/** Public, server-side integration surface for the starter. */
export {
  createShadowAccount,
  type CreateShadowAccountOptions,
  type ShadowAccountClient,
  type ShadowInvokeInput,
} from "./lib/shadow.js";
export {
  type GenericShadowInvokeResult,
  type ShadowVerificationContext,
} from "./lib/invoke-shadow.js";
export {
  PaymasterSubmissionUnknownError,
  type PaymasterTracking,
} from "./lib/private-paymaster.js";
export {
  StarkscanProofDeliveryUnknownError,
  StarkscanProofProvider,
  StarkscanProverError,
  type StarkscanProofProviderOptions,
} from "./lib/starkscan-prover.js";
export {
  toPublicInvocationError,
  type PublicInvocationError,
  type PublicInvocationErrorCode,
} from "./lib/api-error.js";
export {
  type ShadowAccountCredentials,
  type ShadowAdvancedOptions,
} from "./lib/config.js";
export { parseUnits, formatUnits } from "./lib/amounts.js";
export { STRK_DECIMALS } from "./lib/constants.js";
export type { ShieldResult } from "./lib/shield.js";
export type {
  ProgressReporter,
  ProgressStage,
  ProgressUpdate,
} from "./lib/progress.js";
export type { OhttpOption } from "./vendor-sdk.js";
