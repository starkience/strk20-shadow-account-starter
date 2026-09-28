# STRK20 Shadow Account Starter

A minimal browser dapp for using STRK20 shadow accounts through `WalletAccountV6`.

The wallet keeps the signing key, viewing key, notes, proof generation, and transaction submission. The dapp supplies native `STRK20_ACTION[]`. There is no backend, bundled Privacy SDK, prover key, paymaster key, or app-specific anonymizer deployment.

## Run it

Requirements:

- Node.js 24.21;
- pnpm 12.7.0;
- Ready or Xverse with Wallet API 0.10.4 support; and
- shielded STRK prepared in the wallet.

```bash
corepack enable
corepack prepare pnpm@12.7.0 --activate
pnpm install
cp .env.example .env.local
```

Change `VITE_SHADOW_DAPP_NAME` in `.env.local` before running the app. It must be a unique, stable Cairo short string of at most 31 ASCII characters. Do not ship the example value: the dapp name scopes the user's persistent shadow identity, and two apps reusing it reuse the same namespace.

```bash
pnpm dev
```

The workbench intentionally does only two protocol-neutral operations:

1. Move shielded STRK into the dapp-scoped shadow account.
2. Collect the shadow account's public STRK balance back into a shielded open note.

Shielding is separate and happens in the wallet. The dapp reads the shielded balance only when the user clicks **Read with consent**.

## Current tested row

Verified on 2026-09-29.

| Component | Version |
| --- | --- |
| starknet.js | `10.8.0` |
| Starknet Wallet API / types-js | `0.10.4` |
| get-starknet discovery | `6.0.6` |
| get-starknet wallet standard | `6.0.6` |
| React | `19.3.0` |
| Vite | `8.3.1` |
| TypeScript | `7.0.2` |
| Node.js LTS | `24.21.0` |
| pnpm | `12.7.0` |

Dependencies are exact pins. Update the four Starknet/Wallet API packages as one compatibility row and retest both supported wallets.

## The integration, without the UI

### 1. Connect and check capability

```ts
import { WalletAccountV6, walletV6 } from 'starknet';

const versions = await walletV6.supportedWalletApi(wallet);
if (!versions.includes('0.10.4')) {
  throw new Error('Shadow accounts are not supported');
}

const account = await WalletAccountV6.connect({ nodeUrl: RPC_URL }, wallet);
```

Use `wallet_supportedWalletApi` for capability detection. Do not probe `strk20Balances`; that asks the user to reveal private financial data.

### 2. Resolve the shadow address when you need to fund it

A `shadow_account_invoke` is self-contained when its calls need no pre-funding. A DeFi deposit usually needs the address because the first action withdraws shielded tokens to it.

```ts
const partial = await account.strk20ShadowAccountCommitment(DAPP_NAME);
const result = await provider.callContract({
  contractAddress: CANONICAL_ANONYMIZER,
  entrypoint: 'get_shadow_accounts',
  calldata: [partial, '0x0', '0x1', '0x0'],
});
const shadowAddress = result[2];
```

This asks the wallet for one partial, dapp-scoped commitment. Cache the result for the connected wallet session and clear it on account or network changes.

### 3. Submit native STRK20 actions

```ts
import type { STRK20_ACTION } from 'starknet';

const actions: STRK20_ACTION[] = [
  {
    type: 'withdraw',
    token: STRK,
    amount,
    recipient: shadowAddress,
  },
  {
    type: 'shadow_account_invoke',
    dapp_name: DAPP_NAME,
    nonce: '0x0',
    calls: [approveCall, vaultDepositCall],
    collect_policy: { type: 'exact', amount: '0x0' },
  },
];

const { transaction_hash } = await account.strk20InvokeTransaction(actions);
```

For a withdrawal that returns an unknown output amount to the pool, create the open note first and collect only the interaction's balance increase:

```ts
const actions: STRK20_ACTION[] = [
  { type: 'transfer', token: STRK, amount: 'OPEN', recipient: account.address },
  {
    type: 'shadow_account_invoke',
    dapp_name: DAPP_NAME,
    nonce: '0x0',
    calls: [vaultRedeemCall],
    collect_policy: { type: 'diff' },
  },
];
```

The repository keeps these actions visible in [`src/shadow-account.ts`](src/shadow-account.ts); it does not wrap Starknet.js in another client SDK.

## Canonical infrastructure

| Network | Privacy pool | ShadowAccountAnonymizer |
| --- | --- | --- |
| Mainnet | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | `0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7` |
| Sepolia | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` | `0x010a2285310c107c731d997afc147afb7495daff6397c2d242133d9fe8d9b147` |

Every app uses the canonical `ShadowAccountAnonymizer`. It is generic infrastructure that deploys and drives a user's dapp-scoped shadow account. A Vesu, Troves, or other protocol integration supplies ordinary contract calls; it does not deploy a protocol-specific shadow anonymizer.

`pnpm verify:contracts` checks both live networks for the expected pool binding, anonymizer and shadow classes, delegated screening policy, and a positive pool fee. A scheduled GitHub workflow runs the same check daily.

## Privacy boundary

A shadow account is a persistent public pseudonym, not a shielded account:

| Hidden by the protocol flow | Public onchain |
| --- | --- |
| Direct link to the controlling wallet | Shadow address and deployment |
| Ownership of the input shielded notes | Shadow token balances |
| Wallet as transaction sender | Target protocols and calls |
| Viewing key and note state | Amounts, state changes, and timing |

Applications and wallets know which connected session requested the operation. RPC, relayer, prover, screening, and timing observations are additional trust and correlation boundaries. Do not market shadow accounts as untraceable.

## Commands

```bash
pnpm typecheck          # strict TypeScript
pnpm test               # deterministic unit tests
pnpm build              # production Vite build
pnpm check              # all deterministic checks
pnpm verify:contracts   # live Mainnet + Sepolia infrastructure checks
```

## Production checklist

- Replace the example dapp name and keep it stable across releases.
- Listen for wallet account/network changes and clear cached commitments.
- Keep private-balance reads behind explicit consent.
- Preserve the transaction link when confirmation polling times out.
- Test first use, repeated use, insufficient shielded funds, rejection, and delayed proof generation.
- Test Ready and Xverse separately on the target network.
- Run the live contract verifier immediately before a release.
- Explain that the position and activity of the shadow account are public.

## Upstream references

- [Starknet.js WalletAccountV6 and STRK20 shadow accounts](https://github.com/starknet-io/starknet.js/blob/develop/www/docs/guides/account/walletAccount.md#strk20-shadow-accounts)
- [ShadowAccountAnonymizer](https://github.com/starkware-libs/starknet-privacy/tree/main/packages/shadow_account_anonymizer)
- [Starknet Wallet API specification](https://github.com/starkware-libs/starknet-specs/tree/master/wallet-api)

## Migration from the pre-Wallet-API starter

Version `0.1.0` was a Sepolia-only backend reference that held a dedicated account key and directly operated the Privacy SDK, Starkscan prover, AVNU private paymaster, and a starter-owned anonymizer. That architecture remains relevant to wallets and key-holding services, but it is not the recommended boundary for a connected-wallet dapp. Version `1.0.0` removes it from the default path.
