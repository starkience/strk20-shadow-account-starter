# Advanced configuration

Normal hackathon integrations should not configure this page. The starter
loads the exact Sepolia compatibility row from its pinned constants and needs
only the four values in `.env.example`.

## Already-registered accounts

A fresh dedicated account gets a deterministic viewing key derived from its
signer. If an account is already registered with STRK20, its original viewing
key must be supplied instead:

```dotenv
VIEWING_KEY=123...
```

Using a different key makes existing notes unreadable. Keep the viewing key in
the trusted backend with the signing key.

## Maintainer overrides

These environment overrides exist only for maintainers validating a complete
replacement compatibility row:

| Variable | Pinned default |
| --- | --- |
| `STARKNET_RPC_URL` | `https://starknet-sepolia-rpc.publicnode.com` |
| `POOL_ADDRESS` | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| `STRK_TOKEN_ADDRESS` | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| `SHADOW_ACCOUNT_ANONYMIZER_ADDRESS` | `0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f` |
| `STARKSCAN_PROVER_URL` | `https://api.starkscan.co/v1/SN_SEPOLIA/prove` |
| `DISCOVERY_URL` | `https://discovery-service.alpha-sepolia.sw-dev.io` |
| `AVNU_PAYMASTER_URL` | `https://sepolia.paymaster.avnu.fi` |
| `MAX_PAYMASTER_FEE_STRK` | `5` |

Do not change one component independently. Follow `UPGRADING.md`, update the
exact pins in `compatibility.json`, and rerun the complete deterministic and
live gates.

Programmatic integrations have the same escape hatch through `advanced`, but
the normal constructor stays small:

```ts
const shadow = createShadowAccount({
  credentials: {
    accountAddress: process.env.ACCOUNT_ADDRESS!,
    accountPrivateKey: process.env.ACCOUNT_PRIVATE_KEY!,
    starkscanApiKey: process.env.STARKSCAN_API_KEY!,
    avnuPaymasterApiKey: process.env.AVNU_PAYMASTER_API_KEY!,
  },
  appName: "my-game",
  nonce: 0n,
  // advanced: { rpcUrl, ... } // maintainers only
});
```

The `advanced` object also accepts `discoveryOhttp` for a pinned OHTTP key or
relay and `maxPaymasterFee` as a bigint amount in STRK base units.
