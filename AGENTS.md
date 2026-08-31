# Repository instructions

- This repository is standalone STRK20 shadow-account infrastructure. Keep it
  independent from unrelated cross-chain products and application-specific dependencies.
- Preserve the SDK-controlled, Sepolia-only scope unless a user explicitly
  requests expansion.
- Never expose signing or viewing keys to `public/` or API responses.
- Never replace private-paymaster submission with root `account.execute` for a
  shadow invocation.
- Keep amounts as bigint from parsing through calldata.
- A live E2E claim requires every assertion documented in `docs/E2E.md`.
- Use exact dependency, address, and class-hash pins.
