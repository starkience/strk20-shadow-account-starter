import { RpcProvider } from "starknet";
import { loadShadowConfig } from "../src/lib/config";
import { SEPOLIA } from "../src/lib/constants";
import { invokeShadowTransfer } from "../src/lib/invoke-shadow";
import { shieldStrk } from "../src/lib/shield";
import { delay } from "../src/lib/chain";
import { fail, heading, ok, progress, warn } from "./terminal";

async function main(): Promise<void> {
  heading("STRK20 shadow-account demo");
  const config = loadShadowConfig();
  try {
    const result = await invokeShadowTransfer(config, progress);
    verified(result.explorerUrl);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Not enough mature shielded STRK")) throw error;
    warn(message);
  }

  const shield = await shieldStrk(config, progress);
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const requiredHead = shield.spendableAtBlock + SEPOLIA.provingDepthBlocks;
  while ((await provider.getBlockNumber()) < requiredHead) {
    const head = await provider.getBlockNumber();
    process.stdout.write(`\rWaiting for note maturity: ${head}/${requiredHead}`);
    await delay(3_000);
  }
  process.stdout.write("\n");
  const result = await invokeShadowTransfer(config, progress);
  verified(result.explorerUrl);
}

function verified(explorerUrl: string): void {
  ok("Shadow-account invocation verified end to end");
  console.log(explorerUrl);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
