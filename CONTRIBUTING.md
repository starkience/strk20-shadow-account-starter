# Contributing

- Use Node 24.21 and pnpm 12.7.0.
- Keep dependencies pinned exactly; update the Wallet API packages as one tested row.
- Do not add signing keys, viewing keys, prover credentials, paymaster credentials, or an anonymizer deployment flow.
- Keep `strk20Balances` behind an explicit user action.
- Add deterministic tests for action order, amount handling, address resolution, and version detection.
- Run `pnpm check` and `pnpm verify:contracts` before opening a pull request.
- A live wallet E2E claim requires successful Ready and Xverse runs on the stated network, with transaction links recorded in the PR.
