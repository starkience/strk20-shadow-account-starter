# Security

This starter never asks for a signing key or viewing key. Those remain inside the connected wallet.
Do not add key fields, private-balance reads without explicit consent, or browser-exposed service credentials.

A shadow account is a public, persistent pseudonym. Its balances, protocol calls, amounts, and timing are public. The privacy property is that the STRK20 flow does not expose the controlling wallet address onchain. Applications, wallets, RPC providers, relayers, and correlated timing can still observe information; do not describe the result as untraceable.

Every deployment must use a unique, stable dapp name. Reusing another app's dapp name reuses the same per-user shadow namespace and creates avoidable cross-app linkability.

Report vulnerabilities privately through GitHub Security Advisories. Do not open a public issue containing wallet data or a reproducible exploit against live infrastructure.
