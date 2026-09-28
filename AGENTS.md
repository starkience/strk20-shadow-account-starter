# Repository instructions

- This is a browser dapp starter for STRK20 shadow accounts through the Starknet Wallet API.
- Keep the integration on `WalletAccountV6`; never request, store, or derive signing or viewing keys.
- Use the canonical shadow-account anonymizer for each supported network. Do not deploy an app-specific copy.
- Keep integration examples close to native `STRK20_ACTION[]`; do not add a second SDK abstraction.
- Never use `strk20Balances` as a capability probe. It requires explicit user consent.
- A fork must configure a unique, stable `VITE_SHADOW_DAPP_NAME` before transactions are enabled.
- Keep token amounts as bigint or base-unit strings. Never route them through JavaScript `number`.
- State the privacy boundary accurately: shadow activity is public; the main-wallet link is hidden by the protocol flow.
- Pin all Wallet API packages exactly and run `pnpm check` plus `pnpm verify:contracts` before release.
