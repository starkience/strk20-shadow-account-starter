# End-to-end release gate

The deterministic suite verifies encoding, amount safety, maturity selection,
the upstream Cairo/TypeScript address vector, Starkscan idempotency and polling,
private-paymaster request shape, delivery uncertainty, secret-safe API errors,
and the shadow orchestration's relay and postcondition gates. It cannot prove
that the currently deployed Sepolia services accept a write.

## Live prerequisites

- Dedicated, deployed Sepolia account with enough public STRK for shielding.
- A separate recipient address.
- Starkscan API key with proving access.
- AVNU private-paymaster API key.
- The pinned pool, anonymizer, Starkscan endpoint, discovery service, and
  Sepolia paymaster endpoint passing `pnpm shadow:doctor`. The doctor validates
  prover configuration without consuming a proof job; `pnpm shadow:demo` is
  the credentialed prover check.

The pinned runtime now uses the starter-owned finalized deployment described in
[`PROVENANCE.md`](PROVENANCE.md). The earlier community deployment is not part
of the release gate.

## Run

```bash
pnpm shadow:doctor
pnpm shadow:demo --recipient 0x...
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

Do not weaken assertions to make a flaky external service look green. A
`PROOF_DELIVERY_UNKNOWN` result must not create a fresh proof automatically.
Treat paymaster timeouts after relay start as transaction-submission status
unknown and reconcile the transaction before retrying.

## Recorded onchain evidence

The complete six-assertion shadow-account gate passed on 2026-09-02 from commit
`724d3fed8ffcf7c939799d6fd4addc748a8f7b8e` in
[GitHub Actions run 33630618461](https://github.com/starkience/strk20-shadow-account-starter/actions/runs/33630618461).

The public shielding edge was accepted in
[transaction `0x07c781…5f086`](https://sepolia.voyager.online/tx/0x07c78107aa621dcb1cab0cc0d66af18eba72a69cbbe9c23ed88fe5c13df5f086)
at block `14438910`. After the resulting note reached the required proving
depth and maturity, the private-paymaster shadow invocation was accepted in
[transaction `0x07e2a8…2ecd8`](https://sepolia.voyager.online/tx/0x07e2a81742562aad7d5eeef460ba0a6c669b2aa08a51a4db821c3cafa3c2ecd8)
at block `14438938`.

Independent RPC reconciliation confirms every required assertion:

1. The invocation receipt is `ACCEPTED_ON_L2` and `SUCCEEDED`.
2. Commitment
   `0x06314e2ce46be6fc1b1661cb4b1b7a654bfbd667c4002b4b54d4f45f80345fc4`
   resolves in the anonymizer registry to shadow account
   `0x05b4901f1ef53763765ddaf439a78ed2ea125677bc1b1510722a7c656d072c4e`.
3. That address runs pinned shadow-account class
   `0x038489bd44c93ee2eb8604d3a15db60781145951ebdebe356fc824b4a0385a5c`.
4. The configured recipient's STRK balance changed from `0` to
   `10000000000000000` base units, exactly the configured `0.01 STRK`.
5. Outer sender
   `0x0804e901e76a871eb99530325e72488319ae976c90ddeed110698d0a11924c7`
   differs from root account
   `0x05f8be55c4a0f9fb9c5bb1afc27a54ee48e1be2953d0bbc1e707e4fcbce42cdf`.
6. The fresh receipt contains a `ShadowAccountDeployed` event from the pinned
   anonymizer with the same commitment and shadow address.

The job printed `✓ Shadow-account invocation verified end to end` only after
all six checks completed.

The public Starkscan adapter is covered by deterministic transport tests. A
credentialed Starkscan run is intentionally not part of public CI; builders and
maintainers exercise it through the opt-in workflow or `pnpm shadow:demo`.
