# Anonymizer provenance and trust boundary

The pinned anonymizer bytecode is independently reproducible from StarkWare's
privacy repository. It does not require Kamal's source tree.

## Reproduce the declared class

Use the toolchain recorded by the upstream commit:

```text
source repository  https://github.com/starkware-libs/starknet-privacy
source commit      f8f5c6d33caa17bcfd510747ebff91920e1344c3
Scarb              2.18.0
Cairo              2.18.0
Sierra             1.8.0
profile            release
```

```bash
git clone https://github.com/starkware-libs/starknet-privacy.git
cd starknet-privacy
git checkout --detach f8f5c6d33caa17bcfd510747ebff91920e1344c3
scarb --profile release build -p shadow_account_anonymizer
starkli class-hash \
  target/release/shadow_account_anonymizer_ShadowAccountAnonymizer.contract_class.json
```

Expected class hash:

```text
0x00536d72fdbd1674cabc20df594694f634ab33a8ab93fd13c7acbc200c997cc5
```

Expected reproducibility hashes:

```text
Scarb.lock SHA-256  3c7980bc3eb3eaedd5469dd6b0ea6234f3df842ca7ad4dc681811208c7de2396
Sierra JSON SHA-256 5b941b42d520ccdede3b7d5d6abdeed1d490890909e3f8d5875a52f6ec91e1ca
CASM JSON SHA-256   394544ef239c28ea87e6b06a0fa1fc594e9aa10624007cab240a70b5d2760609
CASM class hash     0x07d721b4aab6ff1d678d56a8b826f43d23076e096ab9c8c3271d0768afaefb46
```

That lockfile pins the replaceability and role implementation from
`starkware-starknet-utils` commit
`3e2fd53d99e16c87f6cf2ced53b8c842a2d54a18`.

The Sierra and CASM class hashes match the Sepolia declaration transaction
`0x0850f55711fbc008bc646452a475ca5d582bdc16e8cc82210645107d9e921bc`
at block `14169754`.

## Deployment record

The currently pinned instance was deployed in transaction
`0x06f181d1ca19d4de1187f6a7320efa882c5355c5d900492b83a244df18cd0a47`
at block `14169774` through the universal deployer
`0x02ceed65a4bd731034c01113685c831b01c15d7d432f71afb1cf1634b53a2125`.

Its decoded deployment inputs are:

```text
class hash       0x0536d72fdbd1674cabc20df594694f634ab33a8ab93fd13c7acbc200c997cc5
salt             0x901
unique           false
privacy contract 0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91
shadow class     0x038489bd44c93ee2eb8604d3a15db60781145951ebdebe356fc824b4a0385a5c
governance admin 0x071c62dfb692c3821a9ef120919f388b4559cb2d414c7378da62e6bf7f4f494d
```

The live getters independently confirm the pool and shadow class values.

## Remaining governance boundary

The source and bytecode are verified, but the currently pinned instance is not
trustless. Its upgrade delay is zero, no `ImplementationFinalized` event has
been emitted, and its governance admin is controlled by the community
deployer. That admin can replace the class without delay.

For the hackathon preview, run `pnpm shadow:doctor` immediately before a write;
it rejects any changed class or runtime shape. The release-quality resolution
is to deploy the exact verified class under starter-controlled governance,
finalize that implementation, update `compatibility.json`, and rerun the live
E2E gate. That deployment/finalization is the only provenance-related step
that needs a funded Sepolia signing account.

The maintainer command performs those two writes and verifies the resulting
class, pool binding, shadow class, and finalization event:

```bash
# Put ACCOUNT_ADDRESS and ACCOUNT_PRIVATE_KEY in the ignored .env file.
pnpm anonymizer:deploy
```

Alternatively, set `SEPOLIA_ACCOUNT_ADDRESS` and
`SEPOLIA_ACCOUNT_PRIVATE_KEY` as GitHub Actions secrets and manually run the
`deploy finalized anonymizer` workflow. Never paste either value into an issue,
pull request, workflow input, or chat.

If deployment succeeds but finalization is interrupted, rerun the command. It
recomputes the UDC address from the exact salt, class, constructor, and
governance account, detects the existing instance, and resumes finalization.
You may also provide the printed address as an extra guard:

```bash
# Add ANONYMIZER_ADDRESS=<printed address> to the ignored .env file.
pnpm anonymizer:deploy
```

The supplied address must match that deterministic calculation. A rerun also
detects an existing `ImplementationFinalized` event and exits without sending
another transaction.

The deploying account is constructor-bound as the governance admin. The
finalization transaction atomically grants that account the pinned
`UpgradeGovernor` role, finalizes the same verified implementation, and removes
the temporary upgrade role. The governance role remains recorded, but once the
`ImplementationFinalized` event is emitted the replaceability component rejects
future class changes regardless of that role.
