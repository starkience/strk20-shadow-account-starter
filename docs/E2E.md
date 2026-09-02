# End-to-end release gate

The deterministic suite verifies encoding, amount safety, maturity selection,
the upstream Cairo/TypeScript address vector, private-paymaster request shape,
submission uncertainty, secret-safe API errors, and the shadow orchestration's
relay and postcondition gates. It cannot prove that the currently deployed
Sepolia services accept a write.

## Live prerequisites

- Dedicated, deployed Sepolia account with enough public STRK for shielding.
- A separate recipient address.
- AVNU private-paymaster API key.
- The pinned pool, anonymizer, prover, discovery service, and Sepolia
  paymaster endpoint passing
  `pnpm shadow:doctor`.

The pinned runtime now uses the starter-owned finalized deployment described in
[`PROVENANCE.md`](PROVENANCE.md). The earlier community deployment is not part
of the release gate.

## Run

```bash
pnpm shadow:doctor
pnpm shadow:demo
```

The first run may take extra blocks because the proof base must be ten blocks
behind the head and a new note must mature for ten blocks.

## Required evidence

Record the output transaction hash only after the CLI prints:

```text
✓ Shadow-account invocation verified end to end
```

That line is reached only after checking:

1. Successful terminal receipt.
2. Commitment → address registry entry.
3. Deployed class hash.
4. Exact recipient balance delta.
5. Paymaster/relayer outer sender differs from the root account.
6. Matching deployment event when the nonce was previously unused.

## CI

The default workflow is deterministic and needs no secrets. The
`sepolia-e2e.yml` workflow is deliberately opt-in. Set repository variable
`ENABLE_SEPOLIA_E2E=true` and configure the secrets named in the workflow.
Deployment and E2E workflows share one non-cancelling concurrency group so the
dedicated account cannot submit overlapping writes or race private-note
selection.

Do not weaken assertions to make a flaky external service look green. Treat
timeouts as “submission status unknown” when they happen after relay start and
reconcile the transaction before retrying.
