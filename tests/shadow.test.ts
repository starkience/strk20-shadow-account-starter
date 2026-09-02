import assert from "node:assert/strict";
import test from "node:test";
import type {
  ShadowAccountCredentials,
  ShadowAdvancedOptions,
} from "../src/lib/config";
import { createShadowAccount } from "../src/lib/shadow";

const credentials: ShadowAccountCredentials = {
  accountAddress: "0x1",
  accountPrivateKey: "0x2",
  viewingKey: 3n,
  starkscanApiKey: "prover-secret",
  avnuPaymasterApiKey: "secret",
};

const advanced: ShadowAdvancedOptions = {
  rpcUrl: "https://rpc.example",
  poolAddress: "0x4",
  tokenAddress: "0x5",
  anonymizerAddress: "0x6",
  proverUrl: "https://prover.example",
  discoveryUrl: "https://discovery.example",
  paymasterUrl: "https://paymaster.example",
  maxPaymasterFee: 10n,
};

test("generic shadow client does not require transfer-demo configuration", () => {
  const client = createShadowAccount({
    credentials,
    advanced,
    appName: "builder-game",
    nonce: 12n,
  });
  assert.equal(client.appName, "builder-game");
  assert.equal(client.defaultNonce, 12n);
});

test("shadow identity inputs reject unsafe or ambiguous values before network work", () => {
  assert.throws(
    () => createShadowAccount({ credentials, advanced, nonce: -1n }),
    /non-negative bigint/,
  );
  assert.throws(
    () => createShadowAccount({ credentials, advanced, appName: "x".repeat(32) }),
    /Cairo short string/,
  );
  assert.throws(
    () => createShadowAccount({ credentials, advanced, appName: "" }),
    /must not be empty/,
  );
});

test("public shielding rejects unsafe amounts before network work", async () => {
  const client = createShadowAccount({ credentials, advanced });
  await assert.rejects(client.shield(0n), /positive bigint/);
  await assert.rejects(client.shield(-1n), /positive bigint/);
  await assert.rejects(client.shield(1 as unknown as bigint), /positive bigint/);
});
