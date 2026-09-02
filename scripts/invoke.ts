import { formatUnits } from "../src/lib/amounts";
import { loadShadowConfig } from "../src/lib/config";
import { STRK_DECIMALS } from "../src/lib/constants";
import { invokeShadowTransfer } from "../src/lib/invoke-shadow";
import { parseShadowRecipeOptions } from "./recipe-options";
import { fail, heading, ok, progress } from "./terminal";

async function main(): Promise<void> {
  heading("Invoke through a shadow account");
  const config = loadShadowConfig(parseShadowRecipeOptions(process.argv.slice(2)));
  console.log(`App:       ${config.appName}`);
  console.log(`Nonce:     ${config.nonce}`);
  console.log(`Recipient: ${config.recipientAddress}`);
  console.log(`Amount:    ${formatUnits(config.spendAmount, STRK_DECIMALS)} STRK\n`);
  const result = await invokeShadowTransfer(config, progress);
  ok("Shadow-account invocation verified end to end");
  console.log(`Shadow: ${result.shadowAddress}`);
  console.log(`Relayer: ${result.outerSender}`);
  console.log(result.explorerUrl);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
