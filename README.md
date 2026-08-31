# STRK20 Shadow Account Starter

A small, friendly starter for calling Starknet contracts through STRK20 shadow
accounts on Sepolia.

```ts
import { createShadowAccount } from "./src/lib/shadow.js";

const shadow = createShadowAccount();

const result = await shadow.invoke({
  calls: [yourContractCall],
  fundingAmount: 0n,
});

console.log(result.shadowAddress, result.explorerUrl);
```

The starter handles note discovery, maturity, commitments, shadow address
derivation, proof generation, private-paymaster fees, relayed submission, and
onchain verification.

> Experimental SDK starter for hackathons, wallets, backends, and applications
> that intentionally control a dedicated Starknet account. A normal browser
> dapp must not ask users for their signing or viewing keys. Use the Wallet API
> once a connected wallet exposes shadow-account support.

## Quick start

Requirements: Node 24+, a funded and deployed Starknet Sepolia development
account, a separate recipient address, and an AVNU private-paymaster API key.

```bash
corepack enable
pnpm install
cp .env.example .env
```

Fill these four values in `.env`:

```dotenv
ACCOUNT_ADDRESS=0x...
ACCOUNT_PRIVATE_KEY=0x...
RECIPIENT_ADDRESS=0x...
AVNU_PAYMASTER_API_KEY=...
```

Use a dedicated test account. `RECIPIENT_ADDRESS` must be different from the
root account so the example does not create a direct public self-transfer link.

Then run:

```bash
pnpm shadow:doctor
pnpm shadow:demo
```

`shadow:demo` first tries the shadow invocation. If the account has no mature
shielded STRK, it performs the public shielding step, waits for the note and
proving base to mature, and then retries automatically.

Launch the local visual workbench with:

```bash
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Keys stay in the local
Node process; the page never receives them.

## What the example does

```text
mature private STRK note
  → withdraw privately to appName + nonce shadow account
  → execute ERC-20 transfer as the shadow account
  → collect one-unit remainder back into a private open note
  → submit the proof through AVNU's private paymaster
  → verify registry, class, event, balance delta, and outer sender
```

The default identity is `SHADOW_APP_NAME=shadow-starter` and
`SHADOW_NONCE=0`. Reusing the same app name and nonce gives the application a
persistent, linkable-within-that-app shadow identity. Increment the nonce when
you intentionally want a fresh address and do not need persistent app state.

## Use your own contract call

The public integration point is [`src/lib/shadow.ts`](src/lib/shadow.ts):

```ts
import { createShadowAccount } from "./src/lib/shadow.js";

const shadow = createShadowAccount({
  onProgress: ({ message }) => console.log(message),
});

await shadow.invoke({
  calls: [
    {
      contractAddress: "0xYOUR_CONTRACT",
      entrypoint: "join",
      calldata: ["0x1"],
    },
  ],
  // STRK moved privately into the shadow account before `join` runs.
  // Leave at 0n when the call needs no token funding.
  fundingAmount: 0n,
  // Enable when the called contract may leave STRK in the shadow account.
  collectRemainder: false,
});
```

The starter currently uses STRK as both the shadow funding token and private
paymaster-fee token to keep the first integration narrow. Generalize the token
configuration only after this exact Sepolia path passes for your project.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm shadow:doctor` | Read-only live checks for RPC, contracts, prover, and discovery |
| `pnpm shadow:shield` | Publicly shield the configured amount of test STRK |
| `pnpm shadow:invoke` | Run and verify one shadow-account transfer |
| `pnpm shadow:demo` | Shield if necessary, wait, invoke, and verify |
| `pnpm dev` | Start the local workbench |
| `pnpm check` | Type-check and run the deterministic test suite |

## Definition of end to end

The write test does not stop at an accepted transaction. It requires all of
the following:

- the shadow registry resolves the commitment to the predicted address;
- that address runs the anonymizer's configured shadow-account class;
- the recipient balance changes by the exact requested amount;
- the outer transaction sender is not `ACCOUNT_ADDRESS`;
- a fresh deployment emits a matching `ShadowAccountDeployed` event; and
- the transaction reaches successful L2/L1 acceptance.

See [`docs/E2E.md`](docs/E2E.md) for release evidence and the remaining
credentialed gate.

## Privacy boundary

Hidden by the private operation:

- which STRK20 notes funded the call;
- the root account as the target contract's caller; and
- the root account as the outer transaction sender when the private paymaster
  is used.

Still public:

- deposits and withdrawals at the pool edges;
- the shadow address and calls it makes;
- recipient, token, amount, application state, and timing; and
- distinctive activity patterns.

Opening channels and moving funds immediately, reusing a shadow identity, or
using unique amounts can reduce privacy. This is not an anonymity guarantee.

## Why the SDK source is vendored

The tagged `PRIVACY-0.14.3-RC.5` SDK is published only through an
access-controlled GitHub Package and has no public release asset. That package
returns 403 for ordinary GitHub users, which is unsuitable for a hackathon.

`vendor/privacy-sdk/src` contains the unmodified production SDK source from the
RC.5 tag and is compiled locally during `pnpm install`. The starter excludes
upstream testing/browser source and dependencies. Its upstream license and
provenance are included. See
[`vendor/privacy-sdk/README.starter.md`](vendor/privacy-sdk/README.starter.md).

## Pinned live stack

The exact Sepolia addresses and versions live in
[`compatibility.json`](compatibility.json). The anonymizer is pinned to the
primer-pattern deployment known to work with the current Sepolia pool. A newer
anonymizer built from upstream `main` is affected by
[starkware-libs/starknet-privacy#978](https://github.com/starkware-libs/starknet-privacy/issues/978).

Credit to Kamal for isolating that live version boundary and publishing the
first reproducible Sepolia shadow-spend evidence. This starter keeps his useful
compatibility finding while replacing root-account submission, floating helper
exports, `Number` amount parsing, and spend-only setup with stricter paths.

## Status

- Clean public install without StarkWare package credentials: passing.
- Vendored SDK build, TypeScript check, and deterministic tests: passing.
- Live read-only Sepolia RPC/contract/prover/discovery checks: passing on
  2026-08-31.
- Fresh credentialed shield → mature note → relayed shadow invoke: implemented;
  final write evidence requires a funded Sepolia account and AVNU API key in
  repository secrets. It must not be marked passing until that job produces a
  transaction hash satisfying every assertion above.

Prototype, unaudited, testnet only.
