# Vault and webhook design

The demo models a compromised application admin, with a separate guardian that
can pause a vault after an unapproved withdrawer change. The
[walkthrough](../README.md) demonstrates the behavior; the
[historical proof](live-devnet-proof.md) records a live run.

## Program and authorities

The vault PDA stores its seed, admin, withdrawer, fixed guardian, and pause
flag.

| Instruction      | Authorization and effect                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| `initialize`     | Admin and guardian sign; creates a fresh vault with distinct authorities |
| `set_withdrawer` | Current admin signs; changes only the withdrawer while active            |
| `withdraw`       | Current withdrawer signs; transfers spendable SOL and preserves rent     |
| `pause`          | Fixed guardian signs; permanently blocks admin changes and withdrawals   |

There is no unpause, guardian setter, reset, or close instruction. The program
checks the account owner, layout, PDA, and required signatures. Admin changes
through CPI are rejected, matching the monitor's top-level instruction parser.
Anyone can still donate SOL to a paused vault, where it remains locked under
this program.

The deployment authority is separate from the admin and guardian. It can upgrade
the program and therefore bypass these rules. The guardian's pause authority
alone does not grant withdrawal or upgrade permission.

## Approval and delivery

An approved CLI command signs the complete transaction and records its exact
signature in SQLite **before** broadcasting it. This binds approval to the
accounts, instructions, arguments, and blockhash. An admin signature alone is
not approval: the attacker is assumed to possess that key.

The HTTP receiver accepts authenticated `POST /webhook` requests containing a
raw transaction array. It extracts `transaction.signatures[0]`, deduplicates
signatures, and commits jobs before returning success. The receiver exposes no
approval-writing endpoint.

For each pending job, the worker:

1. Fetches the confirmed transaction independently from RPC.
2. Checks success, target program, vault, admin signer, and instruction bytes.
3. Ignores donations and other unrelated or failed transactions.
4. Checks the exact signature in the approval registry.
5. Submits a guardian pause for an unapproved change.
6. Reads the vault's paused state before completing the job.

Missing RPC data and uncertain submissions remain pending. New callbacks and
slot notifications wake the worker; startup resumes saved jobs. If a pause
already landed, the worker observes the paused state without submitting another.
The devnet path uses RPC; [Sender Max](sender.md) is an optional mainnet
transport.

## Trust and limitations

The attacker controls the application admin key, not the bot host, approval
registry, RPC, or deployment authority. Keep these roles operationally separate.
The exposed bot runtime needs only its guardian key and access to its job store.

Containment works only when the pause lands before withdrawal. A missed webhook,
unavailable service, insufficient fees, or a faster attacker can prevent it. An
admin change and withdrawal in the same transaction cannot be interrupted. A
completed transfer cannot be reversed by a later pause.

A missing legitimate approval or compromised guardian can lock funds. Losing the
guardian key removes the ability to pause. Production recovery and key rotation
require independent governance beyond this example.

## Code map

- `src/lib.rs`: vault state and instruction authorization.
- `src/commands.mjs`: approved actions and attack scenarios.
- `src/monitor.mjs`: HTTP receiver, classification, and pause decisions.
- `src/store.mjs`: durable approvals and jobs.
- `src/client.mjs`: instruction encoding, account decoding, and RPC submission.
- `src/sender.mjs`: optional Sender routing and identical-byte RPC fallback.

## References

- [Helius raw webhooks](https://www.helius.dev/docs/webhooks)
- [Webhook delivery and retries](https://www.helius.dev/docs/faqs/webhooks)
- [Solana transaction atomicity](https://solana.com/docs/core/transactions)
- [Program upgrade authority](https://solana.com/docs/core/programs/program-deployment)
