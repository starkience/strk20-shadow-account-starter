# Integrate shadow accounts

This starter is for a trusted TypeScript/Node service that controls a dedicated
Starknet account. It is not a browser-wallet adapter. A connected-wallet dapp
must wait for wallet-provided shadow-account support instead of asking users
for signing or viewing keys.

## 1. Prepare the server-side account

Use Node 24+ and a dedicated, deployed Sepolia account whose configured signer
can authorize a transaction by itself. Configure:

- `ACCOUNT_ADDRESS` and `ACCOUNT_PRIVATE_KEY`;
- `VIEWING_KEY`, if the account is already registered with one;
- `STARKSCAN_API_KEY` with proving access;
- `AVNU_PAYMASTER_API_KEY`; and
- a different `RECIPIENT_ADDRESS` for the included transfer recipe.

Keep every secret in the trusted process. Never put them in frontend
environment variables, `public/`, logs, or API responses.

The SDK constructs a signed proof invocation. The starter submits it to the
pinned Starkscan endpoint with one idempotency key, polls the asynchronous job,
and converts the first delivered result back into the SDK's `Proof` type. It
never generates proofs in the browser or falls back to another prover. A proof
job can take minutes; keep the backend request alive or run the invocation in a
durable worker. The key is derived from the exact request, so resubmitting that
request after a backend restart recovers the same logical job instead of
spending a second proving slot.

`ACCOUNT_PRIVATE_KEY` is a single Stark-curve signer, not a wallet recovery
phrase or a complete multisig policy. Ready/Argent accounts with an active
guardian require the guardian signature as well, so exporting only their owner
key is insufficient. Use a dedicated unguarded development account with this
version. Complete guardian and multisig signer policies require an account
adapter that the starter does not currently expose.

The pinned `https://sepolia.paymaster.avnu.fi` endpoint accepts the pool in a
credential-free read-only probe. The actual `sponsored_private` submission
still requires the API key; the starter does not silently fall back to a
different fee mode. The request shape is pinned to AVNU's OpenRPC specification
at commit `b93aba20dfba4d4256131c3e1a446a323464e695`.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm shadow:doctor
pnpm shadow:demo
```

The first demo may publicly shield STRK and wait for its note and proving base
to mature. That public setup transaction is separate from the shadow
invocation. The shadow invocation itself is submitted only through the private
paymaster. The shielding helper also waits until the account balance, pool
allowance, and current pool fee are all visible at the older proving block, so
recent funding and pre-approval do not create an invalid proof.

To consume the library from another local project:

```bash
# In the starter checkout
pnpm build
pnpm pack

# In the integrating project; use the tarball path printed above
pnpm add ../strk20-shadow-account-starter/strk20-shadow-account-starter-0.1.0.tgz
```

The tarball includes the compiled public entrypoint and pinned vendored SDK, so
the integrating project does not need StarkWare package-registry credentials.

If the account does not already hold private STRK, initialize it through the
typed public API. This is a public pool edge; the root account, token, amount,
and timing are visible:

```ts
import {
  createShadowAccount,
  parseUnits,
  STRK_DECIMALS,
} from "strk20-shadow-account-starter";

const shadow = createShadowAccount();
const shielded = await shadow.shield(parseUnits("5", STRK_DECIMALS));
console.log(`Private STRK is usable after chain head ${shielded.readyAtHeadBlock}`);
```

Do this as an explicit onboarding/funding operation, not on every application
request. The returned head accounts for note maturity and the ten-block-deep
proving base. An invocation before then returns `PRIVATE_BALANCE_NOT_READY`.

Discovery requests use OHTTP by default. Without a separate OHTTP relay, the
discovery service still sees the caller's IP address and decrypts the request.
Production operators can pass a `discoveryOhttp` object in `config` with a
pinned `publicKeyConfig` and a `relayUrl`. Starkscan proving uses its
authenticated HTTPS job API rather than the SDK's direct OHTTP prover client.

## 2. Add the server-side call

Import from the starter's public entrypoint. Inside a cloned starter use
`./src/index.js`. When consuming a tarball produced by `pnpm pack`, use the
package name shown below. `appName` scopes identities to the application. A
nonce selects one identity within that scope.

```ts
import { createShadowAccount } from "strk20-shadow-account-starter";

const shadow = createShadowAccount({
  appName: "my-game",
  nonce: 0n,
  onProgress: ({ stage, message }) => console.log(stage, message),
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
    const membership = await provider.callContract({
      contractAddress: GAME_ADDRESS,
      entrypoint: "is_member",
      calldata: [shadowAddress],
    });
    if (membership[0] !== "0x1") throw new Error("Shadow account did not join the game");
  },
});

console.log(result.shadowAddress, result.transactionHash, result.effectVerified);
```

The starter verifies the successful receipt, commitment registry, deployed
class, deployment event for a fresh identity, and that the outer sender is not
the root account. `verifyEffect` supplies the application-specific assertion.
Only describe a generic call as end-to-end verified when
`result.effectVerified` is `true`.

## 3. Choose the identity and funding policy

- Reusing `appName + nonce` reuses a persistent, publicly linkable shadow
  address inside that application.
- Incrementing the nonce selects a fresh address. Persist allocated nonces so
  concurrent jobs do not accidentally choose the same identity.
- Serialize invocations for each key-holding root account. The client rejects
  overlapping calls because private-note selection must not race. Coordinate
  across processes as well as within one Node process.
- `fundingAmount` is STRK privately withdrawn into the shadow before the calls
  execute. Keep it as `bigint` from input parsing through calldata.
- Set `collectRemainder: true` when calls may leave STRK in the shadow. The
  remainder returns as a new private note.
- Mature shielded STRK must cover `fundingAmount` plus the private-paymaster
  fee. The configured fee ceiling is enforced before proving.

The current starter supports arbitrary Starknet calls but privately funds and
pays fees only in STRK. Calls needing another private asset require an explicit
token-generalization change and a new live compatibility test.

## 4. Put a narrow application API in front of it

Do not expose an unauthenticated endpoint that accepts arbitrary Starknet
calls. Validate and construct allowed calls inside the trusted backend. If an
HTTP boundary carries amounts or nonces, send decimal strings and parse them
directly with `BigInt`; JSON does not encode bigint values.

The included workbench binds to `127.0.0.1` and demonstrates a fixed transfer.
It is not a production relay API. Python and Rust projects can keep the same
boundary by running this Node 24 integration as an authenticated sidecar.

## 5. Handle failures without creating duplicate writes

Map thrown errors through the package's deliberately narrow public surface
before returning them from an API:

```ts
import { toPublicInvocationError } from "strk20-shadow-account-starter";

try {
  return await shadow.invoke(request);
} catch (error) {
  const safe = toPublicInvocationError(error);
  // Log only the code at untrusted boundaries; return `safe` to the caller.
  return safe;
}
```

- `PRIVATE_BALANCE_NOT_READY` means shield or wait for note maturity, then
  rebuild against a new proving block.
- `USER_LINKAGE` is a privacy stop, not a warning to ignore.
- `PAYMASTER_REJECTED` is a definite rejection.
- `PROOF_DELIVERY_UNKNOWN` means Starkscan cannot confirm whether the prover
  received the job. Do not start a new proof automatically. Keep the job ID and
  the trusted error's idempotency key, then reconcile with the proving-service
  operator. The public error intentionally omits that recovery key.
- `SUBMISSION_UNKNOWN` means the connection failed during relay submission.
  Do not blindly submit the proof again. When the error contains a tracking ID,
  call `await shadow.reconcile(trackingId)` to retrieve AVNU's latest hash and
  `active`, `accepted`, or `dropped` status. A total connection loss may return
  neither identifier and requires operator-side reconciliation.
- A verification failure after submission means the transaction exists but a
  required invariant did not hold. Treat it as a failed operation even if the
  receipt itself succeeded.

## Builder completion checklist

- `pnpm check` passes on Node 24.
- `pnpm shadow:doctor` confirms the exact pinned deployment row.
- Secrets exist only in the trusted process.
- The Starkscan and AVNU keys belong to the integrating team and are not shared
  with a frontend.
- Initial private STRK is provisioned explicitly through `shadow.shield(...)`
  or a private transfer from another compatible wallet.
- The target call is constructed from validated application inputs.
- Identity nonce allocation is deliberate and persisted when necessary.
- Amounts remain bigint internally.
- The private-paymaster path is used for every shadow invocation.
- A target-specific `verifyEffect` assertion passes.
- The returned outer sender differs from the root account.

See [E2E.md](E2E.md) for the starter's release evidence and
[UPGRADING.md](UPGRADING.md) before changing any pinned component.
