import assert from "node:assert/strict";
import test from "node:test";
import type { Note } from "../src/vendor-sdk.js";
import { selectMatureNotes } from "../src/lib/notes";

function note(amount: bigint, created: number, open = false): Note {
  return { amount, created, open, id: amount, sender: 1n, witness: {} as Note["witness"] };
}

test("selectMatureNotes excludes immature and open notes", () => {
  const result = selectMatureNotes(
    [note(4n, 70), note(3n, 95), note(9n, 20, true), note(5n, 60)],
    8n,
    100,
    10,
  );
  assert.deepEqual(result.notes.map((item) => item.amount), [4n, 5n]);
  assert.equal(result.selectedAmount, 9n);
  assert.equal(result.matureBalance, 9n);
  assert.equal(result.privateBalance, 21n);
});

test("selectMatureNotes fails before proof generation when funds are not mature", () => {
  assert.throws(
    () => selectMatureNotes([note(10n, 95)], 5n, 100, 10),
    /Not enough mature shielded STRK/,
  );
});

test("selectMatureNotes does not consume a note when no funding or fee is required", () => {
  const selection = selectMatureNotes([note(50n, 10)], 0n, 30, 10);
  assert.deepEqual(selection.notes, []);
  assert.equal(selection.selectedAmount, 0n);
  assert.equal(selection.matureBalance, 50n);
});
