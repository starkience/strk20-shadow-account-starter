# STRK20 Shadow Account Starter

A small, friendly starter for calling Starknet contracts through STRK20 shadow
accounts on Sepolia.

```ts
import { createShadowAccount } from "./src/index.js";

const shadow = createShadowAccount();

const result = await shadow.invoke({
  calls: [yourContractCall],
  fundingAmount: 0n,
});

console.log(result.shadowAddress, result.explorerUrl);
```

The starter handles note discovery, maturity, commitments, shadow address
derivation, proof generation, private-paymaster fees, relayed submission, and
generic onchain verification. Proving and discovery payloads use OHTTP by
default on the pinned services. The integrating application supplies one
target-specific postcondition before calling its result end-to-end verified.

> Experimental SDK starter for hackathons, wallets, backends, and applications
> that intentionally control a dedicated Starknet account. A normal browser
> dapp must not ask users for their signing or viewing keys. Use the Wallet API
> once a connected wallet exposes shadow-account support.

## Quick start

Requirements: Node 24+, a funded and deployed Starknet Sepolia development
account that one signer can authorize, a separate recipient address, and an
AVNU private-paymaster API key. A bare owner key cannot automate a
guardian-protected or multisig account; use a dedicated unguarded test account
with this version. Complete guardian and multisig signer policies are outside
the current compatibility boundary.

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

For an application integration rather than the included transfer recipe, see
[`docs/INTEGRATION.md`](docs/INTEGRATION.md). Generic calls do not require the
demo-only recipient, spend, or shield configuration.

`pnpm build` creates the typed `dist/` library entrypoint. `pnpm pack` produces
a self-contained installable tarball containing that entrypoint and the pinned
vendored SDK; the artifact is validated without StarkWare package credentials.

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

The public integration point is [`src/index.ts`](src/index.ts):

```ts
import { createShadowAccount } from "./src/index.js";

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
  // Assert your application's state change before claiming E2E success.
  verifyEffect: async ({ provider, shadowAddress }) => {
    // Read your contract and throw unless the expected effect is present.
  },
});
```

The starter currently uses STRK as both the shadow funding token and private
paymaster-fee token to keep the first integration narrow. Generalize the token
configuration only after this exact Sepolia path passes for your project.

If the dedicated account starts with public STRK but no private balance, a
package consumer can perform the same public onboarding edge as
`pnpm shadow:shield`:

```ts
import {
  createShadowAccount,
  parseUnits,
  STRK_DECIMALS,
} from "strk20-shadow-account-starter";

const shadow = createShadowAccount();
const shielded = await shadow.shield(parseUnits("5", STRK_DECIMALS));

console.log(`Wait for chain head ${shielded.readyAtHeadBlock} before invoking`);
```

Shielding exposes the root account, token, amount, and timing. It is a one-time
funding/onboarding operation, not the private shadow invocation.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm shadow:doctor` | Read-only live checks for contracts, services, OHTTP, and paymaster compatibility |
| `pnpm shadow:shield` | Publicly shield the configured amount of test STRK |
| `pnpm shadow:invoke` | Run and verify one shadow-account transfer |
| `pnpm shadow:demo` | Shield if necessary, wait, invoke, and verify |
| `pnpm dev` | Start the local workbench |
| `pnpm check` | Build, type-check, test, and smoke-test the packed entrypoint |
| `pnpm anonymizer:deploy` | Maintainer-only: deploy and finalize the verified anonymizer class |

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
[`compatibility.json`](compatibility.json). The doctor checks the exact pool,
token, anonymizer, and shadow-account class hashes, plus the bound pool,
screening policy, invoke ABI, and exact finalization event. The pinned
anonymizer is a starter-owned, permanently finalized deployment of the verified
StarkWare class with the runtime shape required by the current Sepolia pool. A
newer anonymizer built from upstream `main` is affected by
[starkware-libs/starknet-privacy#978](https://github.com/starkware-libs/starknet-privacy/issues/978).

Credit to community builder Kamal for isolating and reporting that live version
boundary. His repository is supporting evidence, not an authoritative
StarkWare release source. This starter reproduces the deployed class from the
pinned StarkWare source and compiler and keeps its dependency graph on
StarkWare's SDK and the pinned live services. The earlier community instance is
not used by the pinned runtime; see [`docs/PROVENANCE.md`](docs/PROVENANCE.md).

## Status

- Clean public install without StarkWare package credentials: passing.
- Vendored SDK build, TypeScript check, and deterministic tests: passing.
- Anonymizer Sierra/CASM reproduction against its onchain declaration:
  passing with the exact upstream compiler pin.
- Live read-only Sepolia addresses, class hashes, bound-pool configuration,
  screening policy, invoke ABI, RPC, prover, discovery, and paymaster pool
  acceptance checks: passing on 2026-09-02.
- OHTTP proving and discovery transport probes: passing on 2026-09-02.
- Starter-owned immutable deployment: passing. The verified class was deployed
  at block `14438394` and permanently finalized at block `14438419`.
- Fresh credentialed shield → mature note → relayed shadow invoke: implemented;
  final write evidence still requires public Sepolia STRK in the dedicated E2E
  account. It must not be marked passing until that job produces a transaction
  hash satisfying every assertion above.

Prototype, unaudited, testnet only.
