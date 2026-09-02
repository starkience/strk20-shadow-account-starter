# Security

This is an unaudited testnet starter. Do not use production keys or real value.

Report vulnerabilities privately through GitHub Security Advisories on this
repository. Do not open a public issue containing secrets, proofs, viewing
keys, or a reproducible exploit against live infrastructure.

The local web server binds to `127.0.0.1`. Keep it local: it holds the dedicated
development account key in memory while running. Its write route also checks a
localhost Host header and a custom same-origin request header; do not remove
those checks or add permissive CORS headers.

Application backends must construct an allowlisted Starknet `Call[]` from
authenticated, validated inputs. Do not turn the library entrypoint into a
public endpoint that accepts arbitrary calls, signing keys, viewing keys, or
paymaster credentials.

A `SUBMISSION_UNKNOWN` error is deliberately not retryable. The private relay
may already have accepted the transaction; reconcile it before creating
another proof or write.

The pinned proving and discovery services support OHTTP, and the starter
enables it by default. The default talks directly to each OHTTP gateway, so it
protects request contents at the application layer but does not hide client IP
or timing from that service. Production deployments should add an independent
relay and pin each service's OHTTP public-key configuration.
