import type { Call } from "starknet";
import { loadShadowConfig, type ShadowConfig } from "./config";
import {
  invokeShadowCalls,
  type GenericShadowInvokeResult,
} from "./invoke-shadow";
import type { ProgressReporter } from "./progress";

export function createShadowAccount(options?: {
  config?: ShadowConfig;
  onProgress?: ProgressReporter;
}) {
  const config = options?.config ?? loadShadowConfig();
  return {
    appName: config.appName,
    nonce: config.nonce,
    invoke(input: {
      calls: readonly Call[];
      fundingAmount?: bigint;
      collectRemainder?: boolean;
    }): Promise<GenericShadowInvokeResult> {
      return invokeShadowCalls(
        config,
        {
          calls: input.calls,
          fundingAmount: input.fundingAmount ?? 0n,
          collectRemainder: input.collectRemainder ?? false,
        },
        options?.onProgress,
      );
    },
  };
}
