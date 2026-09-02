import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeConfig } from "../src/lib/config";
import { SEPOLIA } from "../src/lib/constants";

const credentials = {
  accountAddress: "0x1",
  accountPrivateKey: "0x2",
  starkscanApiKey: "starkscan-test",
  avnuPaymasterApiKey: "avnu-test",
  viewingKey: 3n,
};

test("four credentials resolve to the complete pinned Sepolia runtime", () => {
  const config = createRuntimeConfig(credentials);

  assert.equal(config.accountAddress, "0x1");
  assert.equal(config.proverApiKey, "starkscan-test");
  assert.equal(config.paymasterApiKey, "avnu-test");
  assert.equal(config.rpcUrl, SEPOLIA.rpcUrl);
  assert.equal(BigInt(config.poolAddress), BigInt(SEPOLIA.poolAddress));
  assert.equal(BigInt(config.tokenAddress), BigInt(SEPOLIA.strkTokenAddress));
  assert.equal(
    BigInt(config.anonymizerAddress),
    BigInt(SEPOLIA.shadowAccountAnonymizerAddress),
  );
  assert.equal(config.proverUrl, SEPOLIA.proverUrl);
  assert.equal(config.discoveryUrl, SEPOLIA.discoveryUrl);
  assert.equal(config.paymasterUrl, SEPOLIA.paymasterUrl);
  assert.equal(config.appName, "shadow-starter");
  assert.equal(config.nonce, 0n);
});

test("application identity and maintainer overrides stay programmatic", () => {
  const config = createRuntimeConfig(
    credentials,
    { appName: "builder-game", nonce: 4n },
    { rpcUrl: "https://rpc.example", maxPaymasterFee: 9n },
  );

  assert.equal(config.appName, "builder-game");
  assert.equal(config.nonce, 4n);
  assert.equal(config.rpcUrl, "https://rpc.example");
  assert.equal(config.maxPaymasterFee, 9n);
});

test("minimal credentials reject empty service secrets", () => {
  assert.throws(
    () => createRuntimeConfig({ ...credentials, starkscanApiKey: "" }),
    /starkscanApiKey must not be empty/,
  );
  assert.throws(
    () => createRuntimeConfig({ ...credentials, avnuPaymasterApiKey: "" }),
    /avnuPaymasterApiKey must not be empty/,
  );
});
