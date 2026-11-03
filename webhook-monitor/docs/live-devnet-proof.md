# Live devnet proof

This proof was run on Solana devnet on November 2, 2026. It exercises the
compiled program, authenticated Helius raw webhook delivery, the monitor's
durable job store, and the guardian's on-chain pause against a real SOL vault.

## Public artifacts

- Program: [`DZPnsGrdxH1ZjJrCaaAicVfV5TdqDpdsDuNPTsQXmCXr`](https://explorer.solana.com/address/DZPnsGrdxH1ZjJrCaaAicVfV5TdqDpdsDuNPTsQXmCXr?cluster=devnet)
- Program data: [`HgAH2WWz4Kzze6p6VDfLkELB1v7Xm3tN2w1o57Hb8fEx`](https://explorer.solana.com/address/HgAH2WWz4Kzze6p6VDfLkELB1v7Xm3tN2w1o57Hb8fEx?cluster=devnet)
- Deployment upgrade authority: `FjHRfaFFiVMtcNEQ24JXUyydKueGKxtBvB73vnY1oxof`
- Deployable binary SHA-256: `b1c9256abe8c91c065a8a5a9a7af213c9f0c1f8c9d856473c650498f73a7ef13`

The deployment authority was separate from the admin and pause guardian.

## Contained attack

The vault held 11,315,720 lamports. The compromised admin changed the
withdrawer to the attacker account. Helius delivered the confirmed transaction
to the authenticated receiver. The bot persisted the job, fetched and
classified the transaction, found no approval for its exact signature, and
paused the vault with the separate guardian key.

| Event | Public transaction | Slot | Block time (UTC) |
| --- | --- | ---: | --- |
| Create and fund the vault | [`2DXCMsPVbV7GvPchTC3ij2uLkPRmMmx6hNwzXhh5CeWAReACwk5Ame2vRpAmAeihbgQ1aYtRhDuBgqKNNqXenkiK`](https://explorer.solana.com/tx/2DXCMsPVbV7GvPchTC3ij2uLkPRmMmx6hNwzXhh5CeWAReACwk5Ame2vRpAmAeihbgQ1aYtRhDuBgqKNNqXenkiK?cluster=devnet) | 518001921 | 22:15:10 |
| Change withdrawer to the attacker | [`29ZQfY4DAKVrYfQGGc3pyEiDSZnBKKkd41cAJkE4kL5XbUN8TrYAaSA2iPW2bHnyTD4uqkgCTZxLYioXD1NXFsfw`](https://explorer.solana.com/tx/29ZQfY4DAKVrYfQGGc3pyEiDSZnBKKkd41cAJkE4kL5XbUN8TrYAaSA2iPW2bHnyTD4uqkgCTZxLYioXD1NXFsfw?cluster=devnet) | 518002045 | 22:15:39 |
| Guardian pause | [`2wNnFwdyDu5jKL4cimBGLSfwStA4uV1iFdoEJaYVizugpk2qRZeYRWCmBrhnx1sFjF4okSm2brCb7k3mB19oTVvc`](https://explorer.solana.com/tx/2wNnFwdyDu5jKL4cimBGLSfwStA4uV1iFdoEJaYVizugpk2qRZeYRWCmBrhnx1sFjF4okSm2brCb7k3mB19oTVvc?cluster=devnet) | 518002050 | 22:15:41 |
| Attacker withdrawal rejected with `Paused` | [`3VsdQWuK63V3WP1fcFfdSDwUXjUxHxvVf7qSjKs4JtqEXi8k16HK2TMgGCPpHf9XTQUmEAYvNHNpReie9ve2mex9`](https://explorer.solana.com/tx/3VsdQWuK63V3WP1fcFfdSDwUXjUxHxvVf7qSjKs4JtqEXi8k16HK2TMgGCPpHf9XTQUmEAYvNHNpReie9ve2mex9?cluster=devnet) | 518002124 | 22:15:58 |

Receiver log times for the unapproved change and confirmed pause were
`2026-11-02T22:15:40.786Z` and `2026-11-02T22:15:41.896Z`. This is a local
observation from one run and is not a delivery or response-time guarantee.

The blocked withdrawal returned instruction error `Custom(0)`, the program's
`Paused` error. The vault balance before and after that transaction was
11,315,720 lamports.

## Noise handling

A 1,000,000-lamport SOL donation to an active vault was delivered by Helius.
The receiver persisted it, and the monitor classified it as
`irrelevant-or-failed` without pausing the vault.

Transaction:
[`4RZscJBJ2NftrUq9Yxts7QRDgh26kMkiYcENdyivRJqnirLCyTAUC4nAEmhxdMiwuQeXkDFK4mcuzGKsfMgxTANd`](https://explorer.solana.com/tx/4RZscJBJ2NftrUq9Yxts7QRDgh26kMkiYcENdyivRJqnirLCyTAUC4nAEmhxdMiwuQeXkDFK4mcuzGKsfMgxTANd?cluster=devnet)

## Attacks before containment

With monitoring stopped, an admin change followed by a separate withdrawal
drained the vault's 10,000,000 spendable lamports and left 1,315,720 lamports
for rent:

- Admin change: [`63pNr3wTAAYMbFg3HapYdMtQuu6f7SZAK1avvTkKZhQvvWY8LRjkyUd5GQKdBA7yj7wk72xmwqmgJ2en3hJCuXs5`](https://explorer.solana.com/tx/63pNr3wTAAYMbFg3HapYdMtQuu6f7SZAK1avvTkKZhQvvWY8LRjkyUd5GQKdBA7yj7wk72xmwqmgJ2en3hJCuXs5?cluster=devnet)
- Withdrawal: [`5nzFHN4dqhDGphEJ8ELDN3ZUYrey87KtvptniMyCb22Ru8rfsJybvfzfjBfVhqsgDZPKAvfQFCdorULYH9iyRHT2`](https://explorer.solana.com/tx/5nzFHN4dqhDGphEJ8ELDN3ZUYrey87KtvptniMyCb22Ru8rfsJybvfzfjBfVhqsgDZPKAvfQFCdorULYH9iyRHT2?cluster=devnet)

A separate attack bundled the admin change and withdrawal into one successful
transaction. It drained the same 10,000,000 spendable lamports before a
post-confirmation webhook could invoke the guardian:

[`4xGAjmqk2ixUsGLGdXnCVKb1HU9gWoSRXGYnQ2LQuzkjMjZYsqghMGhHAYiE5yBMwT92kZtEZerUroKdpi7VLbvB`](https://explorer.solana.com/tx/4xGAjmqk2ixUsGLGdXnCVKb1HU9gWoSRXGYnQ2LQuzkjMjZYsqghMGhHAYiE5yBMwT92kZtEZerUroKdpi7VLbvB?cluster=devnet)

This transaction demonstrates the monitoring boundary: a confirmed transaction
is atomic. Once it finishes, a webhook can pause future withdrawals but cannot
reverse a transfer performed inside it.

## Reproduce it

Follow [the setup and test walkthrough](../README.md#prerequisites), then use a
fresh vault for each attack. The webhook's public tunnel URL is intentionally
not recorded because temporary tunnel URLs expire.
