import { formatUnits } from "../src/lib/amounts";
import { SEPOLIA, STRK_DECIMALS } from "../src/lib/constants";
import { createShadowAccount } from "../src/lib/shadow";
import { parseShieldAmount } from "./recipe-options";
import { fail, heading, ok, progress, warn } from "./terminal";

async function main(): Promise<void> {
  heading("Shield test STRK");
  const amount = parseShieldAmount(process.argv.slice(2));
  warn("Shielding is a public edge: the account, token, amount, and timing are visible.");
  console.log(`Amount: ${formatUnits(amount, STRK_DECIMALS)} STRK`);
  const result = await createShadowAccount({ onProgress: progress }).shield(amount);
  ok(`Shielded at block ${result.blockNumber}`);
  console.log(`${SEPOLIA.explorerUrl}/tx/${result.transactionHash}`);
  console.log(`Spendable from proving base block ${result.spendableAtBlock}.`);
  console.log(`With the default proving depth, wait for chain head ${result.readyAtHeadBlock}.`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
