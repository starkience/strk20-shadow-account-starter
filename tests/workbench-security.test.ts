import assert from "node:assert/strict";
import test from "node:test";
import {
  hasWorkbenchRequestGuard,
  isAllowedWorkbenchHost,
} from "../scripts/workbench-security";

test("workbench accepts only its explicit loopback Host values", () => {
  assert.equal(isAllowedWorkbenchHost("127.0.0.1:3000", 3000), true);
  assert.equal(isAllowedWorkbenchHost("localhost:3000", 3000), true);
  assert.equal(isAllowedWorkbenchHost("attacker.example", 3000), false);
  assert.equal(isAllowedWorkbenchHost("localhost:3001", 3000), false);
  assert.equal(isAllowedWorkbenchHost(undefined, 3000), false);
});

test("workbench write guard rejects form-compatible and duplicated headers", () => {
  assert.equal(hasWorkbenchRequestGuard("1"), true);
  assert.equal(hasWorkbenchRequestGuard(undefined), false);
  assert.equal(hasWorkbenchRequestGuard("0"), false);
  assert.equal(hasWorkbenchRequestGuard(["1", "1"]), false);
});
