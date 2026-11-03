# Helius security monitor demos

This repository contains two independent Solana security-monitor projects for
the Helius article **Detect and Contain Security Threats with Helius**.

| Project | Detection path | Containment response |
| --- | --- | --- |
| [webhook-monitor](webhook-monitor/) | Authenticated raw HTTP webhooks for an infrequent admin vault | Guardian-only one-way pause, with optional mainnet Sender Max routing |
| [parsed-streams-monitor](parsed-streams-monitor/) | Parsed Streams WebSocket filtering with reconnect and historical recovery | Automatic guardian-only freeze of the affected customer collateral account |

The webhook demo models a compromised application admin. The Parsed Streams
demo models a program vulnerability that lets an attacker add an unauthorized
admin to a customer collateral account. Both retain an authority controlled by
the automated guardian rather than the compromised application administrator.

The programs and live transaction tests are devnet-only. Helius documents
Parsed Streams and Parsed Events on mainnet endpoints, so the new project's full
devnet run uses a protocol-faithful local WebSocket fixture. Its separate
read-only smoke command checks the real mainnet Parsed Streams service.

Keep signing keys, API keys, databases, tunnel processes, and generated build
artifacts outside Git. Follow each project README for its own setup and tests.
