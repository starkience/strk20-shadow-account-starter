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
  toPublicInvocationError,
  type PublicInvocationError,
  type PublicInvocationErrorCode,
} from "./lib/api-error.js";
export {
  loadRuntimeConfig,
  loadShadowConfig,
  type ShadowRuntimeConfig,
  type ShadowConfig,
} from "./lib/config.js";
export type {
  ProgressReporter,
  ProgressStage,
  ProgressUpdate,
} from "./lib/progress.js";
export type { OhttpOption } from "./vendor-sdk.js";
