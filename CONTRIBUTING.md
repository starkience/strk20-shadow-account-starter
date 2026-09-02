# Contributing

Keep the first path small and reproducible.

- Node 24 and pnpm are required.
- Never commit `.env`, signing keys, viewing keys, proofs, or paymaster keys.
- Do not add a second network or token without a live E2E fixture.
- Do not change pinned SDK/anonymizer versions independently.
- Do not submit private operations from the root account.
- Run `pnpm build`, `pnpm check`, and `pnpm shadow:doctor` before opening a pull
  request. Packaging changes must also pass an isolated `pnpm pack` install.
- Do not mark a live E2E passing without every assertion in `docs/E2E.md`.

Changes to privacy claims must update both the README and the workbench copy.
