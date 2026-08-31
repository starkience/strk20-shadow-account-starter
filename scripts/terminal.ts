import type { ProgressReporter } from "../src/lib/progress";

const RESET = "\u001b[0m";
const GREEN = "\u001b[32m";
const CYAN = "\u001b[36m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";

export const progress: ProgressReporter = ({ message }) => {
  console.log(`${CYAN}→${RESET} ${message}`);
};

export function ok(message: string): void {
  console.log(`${GREEN}✓${RESET} ${message}`);
}

export function warn(message: string): void {
  console.log(`${YELLOW}!${RESET} ${message}`);
}

export function fail(message: string): void {
  console.error(`${RED}✕${RESET} ${message}`);
}

export function heading(message: string): void {
  console.log(`\n${CYAN}${message}${RESET}`);
}
