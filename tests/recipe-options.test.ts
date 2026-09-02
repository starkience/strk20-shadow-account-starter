import assert from "node:assert/strict";
import test from "node:test";
import {
  parseShadowRecipeOptions,
  parseShieldAmount,
  parseWorkbenchRecipeOptions,
} from "../scripts/recipe-options";

test("transfer recipe inputs come from CLI flags", () => {
  const options = parseShadowRecipeOptions([
    "--recipient",
    "0x123",
    "--spend-amount",
    "0.25",
    "--shield-amount",
    "3",
    "--app-name",
    "my-game",
    "--nonce",
    "7",
  ]);

  assert.equal(options.recipientAddress, "0x123");
  assert.equal(options.spendAmount, 250_000_000_000_000_000n);
  assert.equal(options.shieldAmount, 3_000_000_000_000_000_000n);
  assert.equal(options.appName, "my-game");
  assert.equal(options.nonce, 7n);
});

test("transfer recipe requires a recipient while the workbench can render without one", () => {
  assert.throws(() => parseShadowRecipeOptions([]), /Missing --recipient/);
  assert.equal(parseWorkbenchRecipeOptions([]).recipientAddress, undefined);
});

test("shielding has one independent amount option", () => {
  assert.equal(parseShieldAmount([]), 5_000_000_000_000_000_000n);
  assert.equal(parseShieldAmount(["--amount", "1.5"]), 1_500_000_000_000_000_000n);
  assert.throws(() => parseShieldAmount(["--amount", "0"]), /positive decimal/);
});
