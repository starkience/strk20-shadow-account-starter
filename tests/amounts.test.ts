import assert from "node:assert/strict";
import test from "node:test";
import { formatUnits, parseUnits } from "../src/lib/amounts";

test("parseUnits never routes token amounts through Number", () => {
  assert.equal(parseUnits("0.030000000000000001", 18), 30_000_000_000_000_001n);
  assert.equal(parseUnits("5", 18), 5_000_000_000_000_000_000n);
  assert.throws(() => parseUnits("0.0000000000000000001", 18));
  assert.throws(() => parseUnits("1", -1), /decimals/);
});

test("formatUnits produces compact developer output", () => {
  assert.equal(formatUnits(30_000_000_000_000_001n, 18, 6), "0.03");
  assert.throws(() => formatUnits(1n, 18, -1), /precision/);
});
