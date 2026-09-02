import type { Note } from "../vendor-sdk.js";

export interface NoteSelection {
  readonly notes: readonly Note[];
  readonly selectedAmount: bigint;
  readonly matureBalance: bigint;
  readonly privateBalance: bigint;
}

export function selectMatureNotes(
  notes: readonly Note[],
  required: bigint,
  provingBlock: number,
  maturityBlocks: number,
): NoteSelection {
  const privateBalance = notes.reduce((sum, note) => sum + BigInt(note.amount), 0n);
  const mature = notes
    .filter((note) => {
      if (note.open || note.created === undefined) return false;
      return Number(note.created) + maturityBlocks <= provingBlock;
    })
    .sort((left, right) => {
      const a = BigInt(left.amount);
      const b = BigInt(right.amount);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const matureBalance = mature.reduce((sum, note) => sum + BigInt(note.amount), 0n);
  const selected: Note[] = [];
  let selectedAmount = 0n;
  if (required > 0n) {
    for (const note of mature) {
      selected.push(note);
      selectedAmount += BigInt(note.amount);
      if (selectedAmount >= required) break;
    }
  }
  if (selectedAmount < required) {
    throw new Error(
      `Not enough mature shielded STRK. Need ${required}, mature ${matureBalance}, total ${privateBalance}. Run shadow.shield(...) (or pnpm shadow:shield in the starter) or wait for note maturity.`,
    );
  }
  return { notes: selected, selectedAmount, matureBalance, privateBalance };
}
