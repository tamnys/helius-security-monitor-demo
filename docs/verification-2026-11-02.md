# Verification run: November 2, 2026

This record captures a new devnet and Helius run against the current examples.
It is separate from the historical proof pages in each demo.

## Automated checks

- Both JavaScript suites passed.
- Both native Rust suites and compiled-SBF runtime suites passed.
- Fresh lockfile installs and SBF builds succeeded for both demos.
- CLI help worked without credentials, and invalid arguments were rejected
  before RPC access.
- Documentation links passed the repository checker.
- Both README Mermaid diagrams rendered in Mermaid Live.
- Linux x64, Linux ARM64, and Apple Silicon macOS passed the native CI matrix,
  including the pinned tunnel executable check.

## Real Helius webhook delivery

The receiver ran behind the pinned Cloudflare tunnel. A temporary raw devnet
webhook delivered the public transactions below; the temporary webhook and
tunnel are not retained.

| Step                                                                                                                                                           | Public result                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create vault [`Gnp19fcArdKYFswYmiAzbto5CHwKpdJRstaEDRGAMXgj`](https://explorer.solana.com/address/Gnp19fcArdKYFswYmiAzbto5CHwKpdJRstaEDRGAMXgj?cluster=devnet) | [`2CHjYtBGfa3ApU5roYF6Q2YEeEdhf9kVv7Lg7XKKZrE6tGtbcFuk5SFA4uYaMZRKA1SoiznRp8gp5NREXtTEtfc1`](https://explorer.solana.com/tx/2CHjYtBGfa3ApU5roYF6Q2YEeEdhf9kVv7Lg7XKKZrE6tGtbcFuk5SFA4uYaMZRKA1SoiznRp8gp5NREXtTEtfc1?cluster=devnet) |
| Approved withdrawer change                                                                                                                                     | [`4udVSdgv6WrVUHBHtzcDvNbeGwjEPr4cVPRnCR8Jg1q8AJ6WGmH3962K5Ac3MydDJ3w3Ffx8bBXJU4Wkvo1r9HGH`](https://explorer.solana.com/tx/4udVSdgv6WrVUHBHtzcDvNbeGwjEPr4cVPRnCR8Jg1q8AJ6WGmH3962K5Ac3MydDJ3w3Ffx8bBXJU4Wkvo1r9HGH?cluster=devnet) |
| Donation ignored as noise                                                                                                                                      | [`5FiCYYn5fo6Ucrg5tnmdzqMMgGvZQPuUxSPHv8azyBrn1JfvMjYPuSJRE3VXmqGHZZ4JcURv7T8A7vcMJJRBeUmQ`](https://explorer.solana.com/tx/5FiCYYn5fo6Ucrg5tnmdzqMMgGvZQPuUxSPHv8azyBrn1JfvMjYPuSJRE3VXmqGHZZ4JcURv7T8A7vcMJJRBeUmQ?cluster=devnet) |
| Unapproved withdrawer change                                                                                                                                   | [`5sdqBEwJLFZNjsHXdwSpJeMxEjzRkrwZjMReEgS52MoX82UGzFKaGVZv9fQnFPmNNjfs1S1rew1e9EVXpQRk4gAK`](https://explorer.solana.com/tx/5sdqBEwJLFZNjsHXdwSpJeMxEjzRkrwZjMReEgS52MoX82UGzFKaGVZv9fQnFPmNNjfs1S1rew1e9EVXpQRk4gAK?cluster=devnet) |
| Guardian pause                                                                                                                                                 | [`X2EFzWrLMqvkBFPyfQnHCGJgi1LTDcN13gmxNYNpjYxQk9mZNRwC4bhMZsC4jyUy5u17AVtbgzGcseTYGHwzfve`](https://explorer.solana.com/tx/X2EFzWrLMqvkBFPyfQnHCGJgi1LTDcN13gmxNYNpjYxQk9mZNRwC4bhMZsC4jyUy5u17AVtbgzGcseTYGHwzfve?cluster=devnet)   |
| Post-pause withdrawal rejected with `Paused`                                                                                                                   | [`5JQ3HfwjBv1nsSV42JsoUHZ3T51RT2wz5EUiqcMWztSpFx4J5c8hMvc5hNUA9t1QzF3mgWN4awMCtQ8CPdsSp8Su`](https://explorer.solana.com/tx/5JQ3HfwjBv1nsSV42JsoUHZ3T51RT2wz5EUiqcMWztSpFx4J5c8hMvc5hNUA9t1QzF3mgWN4awMCtQ8CPdsSp8Su?cluster=devnet) |

The approved change completed as `approved`, the donation completed as
`irrelevant-or-failed`, and the unapproved change completed as `paused`. The
blocked withdrawal returned `Custom(0)` and the vault balance remained
`11,315,720` lamports.

With the bot stopped, a separate vault's admin change and withdrawal drained its
`10,000,000` spendable lamports:

- [`gCDgNaDNiHsxUQEiMvszrNonMQFh2Nvk1VrLUscUYLR4FpkZRsaNpunpesGcM9ReoLpcpAchFSmtK35VNAq2x2C`](https://explorer.solana.com/tx/gCDgNaDNiHsxUQEiMvszrNonMQFh2Nvk1VrLUscUYLR4FpkZRsaNpunpesGcM9ReoLpcpAchFSmtK35VNAq2x2C?cluster=devnet)
- [`akoU3F5Qk36VskjCnFzoarrwEGwMLvtLHjYbvpDnHZEiVNeMHaA631Yk9usi7QSTcomg9HaKuhV7yaJ81E1JaKD`](https://explorer.solana.com/tx/akoU3F5Qk36VskjCnFzoarrwEGwMLvtLHjYbvpDnHZEiVNeMHaA631Yk9usi7QSTcomg9HaKuhV7yaJ81E1JaKD?cluster=devnet)

On another fresh vault, the admin change and withdrawal succeeded atomically and
drained `2,000,000` spendable lamports:
[`4iDF1CtouXDnmo8CAz8VgFE2XJR7NvhnA5TmBponZhMH3KXa6yo7VNbn3sS4wreTDgrw4qirerbeNh5Tyj2mSKb8`](https://explorer.solana.com/tx/4iDF1CtouXDnmo8CAz8VgFE2XJR7NvhnA5TmBponZhMH3KXa6yo7VNbn3sS4wreTDgrw4qirerbeNh5Tyj2mSKb8?cluster=devnet).

## Parsed Streams fixture and recovery

The victim account was
[`HRTB7GJAhUtzzS6xZVmarrn7arKbfbVZzoHNZfXeE2uk`](https://explorer.solana.com/address/HRTB7GJAhUtzzS6xZVmarrn7arKbfbVZzoHNZfXeE2uk?cluster=devnet).
After an approved admin insertion, the fixture was stopped and an unauthorized
admin was added. When the fixture restarted, the monitor reconnected, recovered
the missed transaction, emitted `unauthorized-admin-alert`, and froze the
account.

| Step                                         | Public result                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create victim account                        | [`3xu4YpXCCEm7MmvG5pVKF3eBqkQpz5LjP2KjmAtjSwQxkrioUL61GmLH5qmmrcwrSbMwE3qBYLjaYxViVNqHE1N6`](https://explorer.solana.com/tx/3xu4YpXCCEm7MmvG5pVKF3eBqkQpz5LjP2KjmAtjSwQxkrioUL61GmLH5qmmrcwrSbMwE3qBYLjaYxViVNqHE1N6?cluster=devnet) |
| Approved admin insertion                     | [`4bEJ3EsHep55auH5mZs4eoWrWVBnhynTeQn8Bz7VyWszwYjJV4yZAxt4Qkk2L2spaYgqubhEVxLJ6MfKm9dXUznv`](https://explorer.solana.com/tx/4bEJ3EsHep55auH5mZs4eoWrWVBnhynTeQn8Bz7VyWszwYjJV4yZAxt4Qkk2L2spaYgqubhEVxLJ6MfKm9dXUznv?cluster=devnet) |
| Unauthorized insertion while fixture offline | [`4pMzHoQDU6D9amzkXXt5zVgXNn2Ri84TKMW1doLkqg2MzKapYMBbxr7ZyH6VHeQSSe81xU3K3W2ZtAhGDxncW8sc`](https://explorer.solana.com/tx/4pMzHoQDU6D9amzkXXt5zVgXNn2Ri84TKMW1doLkqg2MzKapYMBbxr7ZyH6VHeQSSe81xU3K3W2ZtAhGDxncW8sc?cluster=devnet) |
| Guardian freeze after recovery               | [`64PrnscqvgAu1DzSTMeWWGanzsL1gxBsfjz13sLRA1SDtPuFp3a32w9qnFPDQuADkDjdW5fPi9KPpzFL16EsGtzX`](https://explorer.solana.com/tx/64PrnscqvgAu1DzSTMeWWGanzsL1gxBsfjz13sLRA1SDtPuFp3a32w9qnFPDQuADkDjdW5fPi9KPpzFL16EsGtzX?cluster=devnet) |
| Frozen withdrawal rejected                   | [`2zKMrytJZGRnYjE6qsryUVTxnWjk98f31EFhXGTfhSs2wPJQV6RZ6k8Kv7xnEsuwL6eXhNU5izwzKZmPzQPyKfa`](https://explorer.solana.com/tx/2zKMrytJZGRnYjE6qsryUVTxnWjk98f31EFhXGTfhSs2wPJQV6RZ6k8Kv7xnEsuwL6eXhNU5izwzKZmPzQPyKfa?cluster=devnet)   |

The rejected withdrawal returned `Custom(0)` and the collateral balance remained
`6,145,920` lamports. A control collateral account for the same customer
withdrew successfully after the victim was frozen:
[`3qusAiGjWLPHWnCP3gBoahHYuzbGCnAPr2kSRdP5HzmXSVXiDA9iG9MCchqygk1VtJzPerFKfodz1NvjXwDfdb23`](https://explorer.solana.com/tx/3qusAiGjWLPHWnCP3gBoahHYuzbGCnAPr2kSRdP5HzmXSVXiDA9iG9MCchqygk1VtJzPerFKfodz1NvjXwDfdb23?cluster=devnet).

On a fresh account, an admin insertion and withdrawal in the same transaction
drained the `2,000,000` spendable lamports before a stream event could be
processed:
[`3kjArxKQdb11hndZNkUuWcFaRqMoKvf2SRN7wPYBVvPmFiim3k56ikAJ5HfrSyR19swzNEUZXauE6hcSPpn7Atmu`](https://explorer.solana.com/tx/3kjArxKQdb11hndZNkUuWcFaRqMoKvf2SRN7wPYBVvPmFiim3k56ikAJ5HfrSyR19swzNEUZXauE6hcSPpn7Atmu?cluster=devnet).

## Real Parsed Streams service

The read-only smoke command connected to the documented discovery and
subscription endpoints. Discovery returned Jupiter's `route` instruction, and
the subscription received a live Jupiter notification at slot `464737118`:
[`5AeAkMKXg3ANUZQTnvkT1CtPFeMCAZ3HSvhTpKNaMXF8TaMQDQzzsuCmwWorRwRFRPotPpBVr8q2wJ5CnKLmL9QT`](https://explorer.solana.com/tx/5AeAkMKXg3ANUZQTnvkT1CtPFeMCAZ3HSvhTpKNaMXF8TaMQDQzzsuCmwWorRwRFRPotPpBVr8q2wJ5CnKLmL9QT).
The command submitted no transactions.
