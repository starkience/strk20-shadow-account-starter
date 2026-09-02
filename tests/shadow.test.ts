import assert from "node:assert/strict";
import test from "node:test";
import type { ShadowRuntimeConfig } from "../src/lib/config";
import { createShadowAccount } from "../src/lib/shadow";

const runtimeConfig: ShadowRuntimeConfig = {
  accountAddress: "0x1",
  accountPrivateKey: "0x2",
  viewingKey: 3n,
  rpcUrl: "https://rpc.example",
  poolAddress: "0x4",
  tokenAddress: "0x5",
  anonymizerAddress: "0x6",
  proverUrl: "https://prover.example",
  discoveryUrl: "https://discovery.example",
  paymasterUrl: "https://paymaster.example",
  paymasterApiKey: "secret",
  appName: "configured-app",
  nonce: 0n,
  maxPaymasterFee: 10n,
};

test("generic shadow client does not require transfer-demo configuration", () => {
  const client = createShadowAccount({
    config: runtimeConfig,
    appName: "builder-game",
    nonce: 12n,
  });
  assert.equal(client.appName, "builder-game");
  assert.equal(client.defaultNonce, 12n);
});

test("shadow identity inputs reject unsafe or ambiguous values before network work", () => {
  assert.throws(
    () => createShadowAccount({ config: runtimeConfig, nonce: -1n }),
    /non-negative bigint/,
  );
  assert.throws(
    () => createShadowAccount({ config: runtimeConfig, appName: "x".repeat(32) }),
    /Cairo short string/,
  );
  assert.throws(
    () => createShadowAccount({ config: runtimeConfig, appName: "" }),
    /must not be empty/,
  );
});
