# Helius Security Monitor Demo

Design for a minimal Solana devnet proof of concept accompanying the Helius
article **Detect and Contain Security Threats with Helius**.

A compromised application admin changes a SOL vault's authorized withdrawer.
A Helius raw webhook notifies an automated bot, which checks an approval
registry and submits a built-in `pause` instruction for an unapproved change.
The bot has a separate pause authority. The admin cannot replace that authority
or unpause the vault. The live proof runs on devnet through RPC; an optional
mainnet response path submits the same pause through Helius Sender Max.

This document describes the design and acceptance criteria.

## What the demo must prove

A transaction can pass the program's admin signature check while violating
the operator's approval policy. When a real Helius webhook delivers an
unapproved admin change, the bot pauses the vault. A subsequent withdrawal
fails and the funds remain in the vault.

Containment must land before withdrawal. The demo does not promise that the
bot can win every race.

## Vault program

Use a small Rust program with a program-owned PDA that holds devnet SOL and
stores `admin`, `withdrawer`, `pause_authority`, and `paused`. Each run uses
a fresh vault identity so a paused vault never needs resetting.

| Instruction | Behavior |
| --- | --- |
| `initialize` | Authenticated, create-once initialization sets the admin, withdrawer, and pause authority, with `paused = false`. |
| `set_withdrawer` | Require the stored admin's signature and an unpaused vault; update only the withdrawer. |
| `withdraw` | Require an unpaused vault and the current withdrawer's signature; transfer the requested spendable lamports to that withdrawer while preserving rent. |
| `pause` | Require the stored pause authority's signature; set `paused = true`. Repeated authorized calls succeed without further effect. |

The pause authority must be distinct from the admin and withdrawer. Preserve
this separation when changing the withdrawer. Passing an account whose public
key matches the pause authority is insufficient: it must actually sign.

There is no unpause instruction, pause-authority setter, generic configuration
overwrite, or vault close/reset instruction. Initialization must not be
repeatable against an existing vault. Validate the intended vault identity,
PDA seeds, ownership, and initialized state on every relevant instruction;
a caller must not substitute an unpaused account to withdraw from a paused one.

Every outgoing-funds path must enforce the pause flag. The demo has only one:
`withdraw`. Admin changes also stop while paused. Funding uses a normal System
Program transfer; outsiders can still send SOL into a paused vault, where it
will remain locked under this program.

Administrative changes in the demo are direct, top-level instructions.
Enforce that restriction in `set_withdrawer`; do not silently ignore admin
changes made through cross-program invocation. Supporting Squads or other CPI
callers would require extending the program and monitor deliberately.

## Authorities and trust assumptions

| Role | Authority |
| --- | --- |
| Application admin | Change the withdrawer while the vault is active. The attack script uses this compromised key. |
| Legitimate withdrawer | Withdraw before compromise. |
| Attacker | Receive withdrawal permission and attempt to drain the vault. |
| Bot / pause authority | Pause the vault. This authority grants no withdrawal, unpause, configuration, or program-upgrade permission. On mainnet it also pays the Sender tip, priority fee, and transaction fee. |
| Approval operator | Register legitimate transactions locally before broadcast. |
| Deployment upgrade authority | Replace the program's code; kept separate from the admin and bot and unused during containment. |

The live proof uses devnet wallets and funds. The optional Sender path is
mainnet-only and requires guardian SOL for its tip, priority fee, and
transaction fee. Keep private keys outside the repository and use the existing
project wallet registry in the managed workspace.

The attacker controls the application admin key after initialization. It does
not control the bot, approval registry, deployment upgrade authority, or RPC.
Separate keys do not provide operational separation if the same compromise can
read all of them; keep the bot's key and approval-writing access outside the
compromised admin's environment.

The bot can stop withdrawals without being able to take custody of the vault.
Compromise of its pause key can cause denial of service. With this one-way
demo, an unnecessary pause locks the vault under the current program.

An upgradeable deployment retains a higher authority: its upgrade key could
install code that ignores the pause or changes its authority. The admin and
bot must not hold that key. The demo's one-way guarantee applies to the
deployed program's instructions, not to a malicious future upgrade. Revoking
upgrade authority would make the code immutable, but that irreversible action
is not required for this demo.

## Preparation

1. Build and deploy the vault program with a separate deployment authority.
2. Initialize a fresh vault with distinct admin, withdrawer, and bot accounts.
3. Fund the vault with devnet SOL.
4. Start the receiver and expose its webhook route through public HTTPS.
5. Configure a Helius `rawDevnet` webhook for the vault PDA with an
   `authHeader`.
6. Confirm the bot can submit transactions and has devnet SOL for fees before
   starting the attack.

There is one program binary. The response is an ordinary `pause` transaction;
it needs no freeze binary, loader buffer, or upgrade signing key.

## Approval registry and receiver

Use a local SQLite database for approved transaction signatures and received
jobs. A legitimate admin command constructs and signs the complete transaction,
records its signature as approved, then broadcasts those exact signed bytes.
Rebuilding it with a different blockhash requires a new approval.

The signature commits to the complete transaction message, including accounts,
instruction data, and blockhash. Never approve an action solely because the
admin signed it. The attacker cannot write the registry, and the receiver has
no public approval endpoint. An absent entry means unapproved under this
policy; it does not establish malicious intent.

Authenticate deliveries with the configured Authorization header. Persist each
job before acknowledging it, then process asynchronously. Helius documents a
one-second acknowledgment requirement, duplicate deliveries, and finite
delivery retries. Acknowledging before durable storage can lose an event if
the process crashes.

Fetch the transaction from the configured devnet RPC and require a successful
confirmed transaction before classifying it. Check the exact target program,
vault, instruction, and account roles. Inspect all top-level instructions.
Ignore failed transactions, donations, and instructions that do not change the
withdrawer. Missing RPC data is unresolved work, not evidence that an event is
harmless.

For an unapproved admin change, submit `pause` with the bot's key. Track jobs
by signature and resume unfinished work after restart. Confirm the transaction
and read the intended vault's `paused` flag before recording containment.
If the result of a submission is uncertain, inspect chain state; an already
paused vault is a successful containment outcome.

The devnet proof submits through the configured RPC. On mainnet, the bot can
use Helius Sender Max to route one atomic transaction containing a compute unit
limit, a priority fee, the pause instruction, and a Sender tip to a current tip
account. The bot checks the genesis hash and refuses Sender on devnet. If the
Sender HTTP call fails, it submits the identical signed bytes through the RPC.
Because the bytes are identical, routing the retry through a second transport
does not create a second transaction signature.

## Response flow

```mermaid
sequenceDiagram
    participant A as Compromised admin
    participant S as Solana devnet
    participant H as Helius raw webhook
    participant B as Bot
    participant R as Approval registry
    participant X as Sender Max (mainnet path)
    A->>S: set_withdrawer(attacker)
    S-->>H: Confirmed transaction involving vault
    H->>B: Authenticated HTTP POST
    B->>B: Persist job; acknowledge delivery
    B->>S: Fetch confirmed transaction
    B->>R: Look up exact transaction signature
    R-->>B: No approval
    B->>X: pause + priority fee + tip
    X->>S: Route pause transaction
    B->>S: Confirm paused state
    A->>S: withdraw
    S-->>A: Paused; vault funds unchanged
```

## What can still go wrong

- **The attacker acts first.** Webhooks arrive after confirmation. A withdrawal
  in the same transaction as the admin change completes before the bot can
  respond. Separate transactions can also outrun it. A pause does not undo
  transfers.
- **The response never lands.** A missed webhook, unavailable receiver or RPC,
  stopped bot, missing fee funds, or transaction failure can prevent containment.
  Delivery retries do not guarantee eventual receipt.
- **Sender does not guarantee inclusion.** Mainnet Sender Max requires enough
  guardian balance for its tip and priority fee, and current competition can
  still delay landing. The RPC fallback preserves a second transport, but both
  paths can be unavailable or arrive too late.
- **The bot pauses unnecessarily.** A compromised pause key or an approval
  registration error can lock legitimate funds. One-way pausing deliberately
  makes this consequence visible in the demo.
- **A program path bypasses the pause.** An unchecked withdrawal, account
  substitution, reset, or privileged escape route invalidates containment.
  The minimal program must enforce the flag and fixed authority on-chain.
- **The upgrade authority is compromised.** Replacing the program can bypass
  the restrictions entirely. This remains a separate trust assumption.

A production protocol needs a recovery and key-rotation policy controlled
independently of the application admin. Permanently fixing a raw bot key makes
loss and compromise hard to recover from. "The admin cannot change it" need
not mean "no independent governance can ever rotate it." Recovery, rotation,
and an on-chain delay for sensitive changes are outside this minimal demo.

## Acceptance scenarios

| Scenario | Required observation |
| --- | --- |
| Normal operation | An authorized withdrawal works while active. |
| Approved change | A pre-registered admin transaction changes the withdrawer without pausing. |
| Noise and failure | A SOL donation and a failed admin instruction do not trigger a pause. |
| Authority separation | Admin and unrelated accounts cannot pause; the bot cannot change the withdrawer or withdraw; unsigned authority accounts are rejected. |
| Fixed authority and one-way state | Admin changes preserve the pause authority; reinitialization cannot replace it or clear the pause; admin changes and withdrawals fail after pausing. |
| Attack without containment | An unapproved change followed by withdrawal drains the spendable balance with the responder disabled. |
| Attack with containment | A real Helius callback triggers a confirmed pause; a later withdrawal fails specifically with `Paused`; its attempt does not change the vault balance. |
| Duplicate delivery and restart | Repeated delivery and resuming an unfinished job retain the intended outcome; an already paused vault is handled successfully. |
| Sender mainnet response | Sender receives one atomic priority-fee, pause, and tip transaction; confirmation uses RPC; failure submits the identical signed bytes through RPC. |
| Atomic attack | Admin change plus withdrawal in one transaction drains the vault before webhook containment. |

Use fresh vaults between scenarios. For the contained demonstration, explicitly
wait for the confirmed pause before attempting withdrawal. This proves the
functional integration, not a race benchmark. Submit the failed withdrawal
on-chain rather than reporting only a preflight simulation error.

Record public transaction signatures, slots, receiver timestamps, pause
submission/confirmation timestamps, and vault balances. Distinguish local
elapsed times from chain block times. Report observations without presenting
them as a delivery SLA or guaranteed response window.

## Implementation shape and live prerequisites

- Rust vault program.
- JavaScript scripts for initialization, approved changes, attacks, and outcomes.
- JavaScript HTTP receiver and worker using a local SQLite database.
- Public devnet configuration and an example environment file with placeholders.
- A walkthrough linking the live demonstration's public transactions.

Use locked dependencies. Keep key material, API credentials, authorization
headers, databases, and generated signing artifacts out of Git.

The live delivery test needs a Helius API key and a public HTTPS receiver.
A local receiver exposed through an HTTPS tunnel is sufficient. Program
development and local tests can proceed first; local webhook fixtures alone
do not establish that the Helius integration works.

## Article wording

> The vault has two independent authorities. The admin can change who is
> allowed to withdraw, while a separate automated guardian can pause the vault.
> The admin cannot replace that guardian or undo a pause. If our monitor sees
> an admin change that was not approved in advance, it submits a pause
> transaction. On mainnet, Helius Sender Max routes that transaction through
> multiple fast submission paths with a priority fee and a tip. Once it
> succeeds, subsequent withdrawals fail.
>
> The guardian has limited power: it can stop withdrawals, but its pause
> authority cannot move funds or replace the program. That reduces the damage
> a compromised bot can cause, although an unnecessary pause can still lock
> users out of their funds.
>
> This protects funds only if the pause lands before withdrawal. A webhook
> cannot intervene between instructions in a transaction that both changes the
> configuration and drains the vault.

This models a compromised-admin sequence. It does not reproduce Drift or
establish that this exact design would have prevented that incident.

## References

- [Helius webhook overview](https://www.helius.dev/docs/webhooks)
- [Helius webhook FAQ: devnet, authentication, delivery, and retries](https://www.helius.dev/docs/faqs/webhooks)
- [Helius Sender Max](https://www.helius.dev/docs/sending-transactions/sender-max)
- [Solana program upgrade authority](https://solana.com/docs/core/programs/program-deployment)
- [Solana transaction atomicity](https://solana.com/docs/core/transactions)
