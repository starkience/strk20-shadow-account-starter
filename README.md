# STRK20 Shadow Account Starter

Run Starknet contract calls from STRK20 shadow accounts on Sepolia.

This starter is for a trusted Node.js backend that controls a dedicated test
account. It handles private-note discovery, maturity, proof generation, shadow
address derivation, AVNU private-paymaster submission, and onchain verification.

> Hackathon preview: experimental, unaudited, and Sepolia only. Do not use
> production keys or funds.

## Compatibility

Use this starter when you have:

- Node.js 24 or newer;
- a funded, deployed Sepolia account controlled by one private key; and
- an AVNU private-paymaster API key.

It does not support guardian or multisig signing, mainnet, or private funding in
tokens other than STRK. A browser dapp must not collect user keys; use
wallet-provided shadow-account support when it becomes available.

## Run the demo

```bash
git clone https://github.com/starkience/strk20-shadow-account-starter.git
cd strk20-shadow-account-starter
corepack enable
pnpm install
cp .env.example .env
```

Set these values in `.env`:

```dotenv
ACCOUNT_ADDRESS=0x...
ACCOUNT_PRIVATE_KEY=0x...
RECIPIENT_ADDRESS=0x...
AVNU_PAYMASTER_API_KEY=...
```

Use a dedicated test account, keep `.env` private, and make
`RECIPIENT_ADDRESS` different from `ACCOUNT_ADDRESS`.

```bash
pnpm shadow:doctor
pnpm shadow:demo
```

`shadow:doctor` checks the pinned Sepolia stack without writing onchain.
`shadow:demo` privately invokes a STRK transfer. If private STRK is unavailable,
it first performs the public shield transaction and waits until the note is
usable.

For the local workbench, run `pnpm dev` and open
[127.0.0.1:3000](http://127.0.0.1:3000). Keys stay in the Node process.

## Add it to a project

The package is not published. Build a local tarball and install it in the
integrating project:

```bash
# In this repository
pnpm build
pnpm pack

# In the integrating project
pnpm add /path/to/strk20-shadow-account-starter-0.1.0.tgz
```

The tarball includes the pinned SDK and needs no StarkWare package-registry
credentials.

```ts
import { createShadowAccount } from "strk20-shadow-account-starter";

const shadow = createShadowAccount({
  appName: "my-game",
  nonce: 0n,
});

const result = await shadow.invoke({
  calls: [
    {
      contractAddress: GAME_ADDRESS,
      entrypoint: "join",
      calldata: [ROUND_ID],
    },
  ],
  fundingAmount: 0n,
  collectRemainder: false,
  verifyEffect: async ({ provider, shadowAddress }) => {
    const value = await provider.callContract({
      contractAddress: GAME_ADDRESS,
      entrypoint: "is_member",
      calldata: [shadowAddress],
    });
    if (value[0] !== "0x1") throw new Error("Shadow call had no effect");
  },
});

console.log(result.shadowAddress, result.transactionHash);
```

If the account has no private STRK, call `shadow.shield(...)` once and wait for
its returned `readyAtHeadBlock` before invoking. Shielding is public; do not run
it automatically for every application request.

See [the integration guide](docs/INTEGRATION.md) for shielding, identity and
nonce policy, concurrency, safe errors, and backend API design.

## Rules that integrations must keep

- Keep signing keys, viewing keys, and the AVNU key on the trusted server.
- Submit shadow invocations only through the private paymaster.
- Keep amounts as `bigint` from parsing through calldata.
- Build calls from validated application inputs; do not expose an arbitrary
  unauthenticated relay.
- Add a target-specific `verifyEffect` check before claiming end-to-end success.
- Reusing `appName + nonce` reuses a publicly linkable shadow address.

## Privacy boundary

The private invocation hides the funding notes and keeps the root account from
being the target contract's caller or the outer transaction sender. The shadow
address, its calls, target, amounts, application state, and timing remain
public. The initial shield transaction also exposes the root account, token,
amount, and timing. This is not an anonymity guarantee.

## Release status

Ready for Sepolia hackathon use within the compatibility boundary above:

- clean install and deterministic checks pass without StarkWare registry access;
- the SDK, contracts, addresses, class hashes, services, and compiler are pinned;
- the starter-owned anonymizer is permanently finalized; and
- the full shield → mature note → private-paymaster invocation gate passed on
  2026-09-02: [workflow run](https://github.com/starkience/strk20-shadow-account-starter/actions/runs/33630618461),
  [invocation transaction](https://sepolia.voyager.online/tx/0x07e2a81742562aad7d5eeef460ba0a6c669b2aa08a51a4db821c3cafa3c2ecd8).

The runtime uses pinned StarkWare Privacy SDK source and live services. It does
not depend on Kamal's repository; his community research helped identify a live
version boundary. See [provenance](docs/PROVENANCE.md), the exact
[E2E assertions](docs/E2E.md), and [upgrade rules](docs/UPGRADING.md).
