# Upgrading the live stack

Shadow accounts currently cross an SDK, privacy pool, anonymizer, prover,
discovery service, and paymaster boundary. Upgrade them as a tested row, never
one floating package at a time.

1. Choose a signed upstream Privacy SDK tag.
2. Replace `vendor/privacy-sdk` from that exact tag and retain its license.
3. Build with an exactly pinned Scarb/compiler/profile and record the Sierra and
   CASM hashes, declaration transaction, deployment transaction, and constructor
   arguments. A source commit by itself is not reproducible provenance.
4. Update `compatibility.json` with versions, addresses, every class hash,
   screening policy, invoke output shape, Starkscan endpoint and transport,
   paymaster endpoint and fee mode, and provenance status.
5. Run `pnpm install`, `pnpm check`, and `pnpm shadow:doctor`.
6. Run the credentialed Sepolia lifecycle from a fresh nonce.
7. Confirm the outer sender, event, registry, class hash, and effect assertions.
8. Only then update the default `.env.example` values.

Watch [issue #978](https://github.com/starkware-libs/starknet-privacy/issues/978)
before moving away from the pinned working anonymizer.
