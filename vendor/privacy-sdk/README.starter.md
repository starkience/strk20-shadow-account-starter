# Vendored Privacy SDK

The production source files are an unmodified snapshot of `sdk/src/` from
StarkWare's `starknet-privacy` tag `PRIVACY-0.14.3-RC.5` (`66e3caa`). They are compiled
locally by the root `postinstall` script because the tagged SDK is available
only through an access-controlled GitHub Package and has no public release
asset.

The starter manifest exports only the production SDK entry point. It
intentionally omits upstream testing/browser source, exports, and their test-only
`starknet-devnet` dependency, which currently carries an unpatched critical
archive-extraction advisory. No production SDK source is changed.

- Upstream: https://github.com/starkware-libs/starknet-privacy
- Release: https://github.com/starkware-libs/starknet-privacy/releases/tag/PRIVACY-0.14.3-RC.5
- License: `UPSTREAM_LICENSE`

Do not edit the production source in place. Replace it from an upstream release
tag and rerun the starter's full test suite when upgrading.
