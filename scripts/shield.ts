import { formatUnits } from "../src/lib/amounts";
import { loadShadowConfig } from "../src/lib/config";
import { SEPOLIA, STRK_DECIMALS } from "../src/lib/constants";
import { shieldStrk } from "../src/lib/shield";
import { fail, heading, ok, progress, warn } from "./terminal";

async function main(): Promise<void> {
  heading("Shield test STRK");
  const config = loadShadowConfig();
  warn("Shielding is a public edge: the account, token, amount, and timing are visible.");
  console.log(`Amount: ${formatUnits(config.shieldAmount, STRK_DECIMALS)} STRK`);
  const result = await shieldStrk(config, progress);
  ok(`Shielded at block ${result.blockNumber}`);
  console.log(`${SEPOLIA.explorerUrl}/tx/${result.transactionHash}`);
  console.log(`Spendable from proving base block ${result.spendableAtBlock}.`);
  console.log(`With the default proving depth, wait for chain head ${result.readyAtHeadBlock}.`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
