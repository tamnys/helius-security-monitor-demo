# Helius Security Monitor Demo

Design for a minimal Solana devnet proof of concept accompanying the Helius
article **Detect and Contain Security Threats with Helius**.

The example uses a SOL vault, a compromised application admin, a Helius raw
webhook, and an emergency upgrade to a prebuilt program that rejects every
instruction. This repository starts with the agreed design; the sections below
specify the implementation and its acceptance criteria.

## What the demo must prove

An admin change can be valid under the program's signature checks while
violating the operator's approval policy. When the monitor receives that change
through a real Helius webhook, it uses a separate upgrade authority to replace
the program. A subsequent withdrawal fails and the vault retains its funds.

This demonstrates containment when the upgrade takes effect before withdrawal.
It does not demonstrate guaranteed protection against a fast attacker.

## On-chain programs

### Vault program

Use a small Rust program with a program-owned PDA that stores the admin and
authorized withdrawer and holds devnet SOL. Keeping SOL in a program-owned
account makes the outgoing-funds path easy to inspect.

| Instruction | Behavior |
| --- | --- |
| `initialize` | Create the vault once, recording the admin and initial withdrawer. |
| `set_withdrawer` | Require the stored admin's signature and replace the withdrawer. |
| `withdraw` | Require the current withdrawer's signature and transfer the requested spendable lamports to that same account, preserving rent. |

Funding uses a normal System Program transfer to the vault. There is no token
mint, exchange rate, price oracle, multisig, dashboard, or admin-transfer
instruction.

Administrative changes in this demo are direct, top-level instructions.
Enforce that restriction in `set_withdrawer`; do not silently ignore admin
changes made through cross-program invocation. Supporting Squads or other CPI
callers would require extending both the program and monitor deliberately.

The application admin cannot sign for the vault PDA or change the program's
upgrade authority. It can redirect withdrawal permission, which is sufficient
to model the compromise.

### Freeze program

Build a separate minimal binary whose entrypoint always returns a distinct
`Frozen` custom error before changing accounts. Upgrade the existing program
ID to this binary; do not deploy it as a different program and call that a
freeze.

The upgrade leaves the vault account and its lamports in place. It blocks all
instructions to the upgraded program, including initialization, admin changes,
and withdrawals. It does not prevent unrelated accounts from sending SOL into
the vault.

## Separate authorities

| Role | Authority |
| --- | --- |
| Application admin | Change the vault's authorized withdrawer. The attack script acts with this compromised key. |
| Legitimate withdrawer | Withdraw before compromise. |
| Attacker | Receive withdrawal permission and attempt to drain the vault. |
| Upgrade authority / responder | Replace the executable program through Solana's upgradeable loader. |
| Approval operator | Register approved transactions locally before they are broadcast. |

Use separate application-admin and upgrade-authority keypairs. All wallets and
funds are devnet-only. Keep private keys outside the repository and use the
existing project wallet registry when running in the managed workspace.

The responder holds unrestricted upgrade authority in this proof of concept.
Pinning a freeze binary in its configuration does **not** restrict the key's
on-chain powers. A compromised responder could install code that steals the
funds. An on-chain upgrade controller limited to an approved freeze artifact
would address a different, larger design problem and is outside this demo.

## Preparation

1. Build and deploy the vault program with the separate upgrade authority.
2. Initialize and fund a vault.
3. Build the freeze binary and upload it to a loader buffer **before** the
   attack. Assign the buffer to the program's upgrade authority.
4. Record the program ID, vault PDA, buffer address, and freeze binary hash.
   Check the program and buffer owners, authorities, and buffer bytes before
   arming the responder.
5. Start the receiver and expose its webhook route through public HTTPS.
6. Configure a Helius `rawDevnet` webhook for the vault PDA with an
   `authHeader`. Every admin change uses this stable account.

Do not compile or upload the binary after detecting the attack. The response
path should need only the final loader upgrade transaction.

## Approval registry

Use a local SQLite database for approved transaction signatures and received
jobs. A legitimate admin command constructs and signs the complete transaction,
records its signature as approved, then broadcasts those exact signed bytes.
If the transaction is rebuilt with a new blockhash, it needs a new approval.

Approving the exact signed transaction avoids an ambiguous allowlist such as
"this admin may change the withdrawer." The signature commits to the complete
transaction message, including accounts, instruction data, and blockhash.

The attacker can use the compromised admin key but cannot modify the registry
or responder configuration. Provide no public approval endpoint. Never mark a
transaction approved merely because the admin signed it.

## Webhook and response flow

```mermaid
sequenceDiagram
    participant A as Compromised admin
    participant S as Solana devnet
    participant H as Helius raw webhook
    participant M as Monitor
    participant R as Approval registry
    A->>S: set_withdrawer(attacker)
    S-->>H: Confirmed transaction involving vault
    H->>M: Authenticated HTTP POST
    M->>M: Persist job; acknowledge delivery
    M->>S: Fetch confirmed transaction
    M->>R: Look up exact transaction signature
    R-->>M: No approval
    M->>S: Upgrade existing program using prepared buffer
    M->>S: Verify freeze code and effective behavior
    A->>S: withdraw
    S-->>A: Frozen; vault funds unchanged
```

Authenticate the webhook using the configured Authorization header. Persist
the job before acknowledging it, then process asynchronously. Helius documents
a one-second acknowledgment requirement, duplicate deliveries, and finite
delivery retries.

Treat the webhook as a notification: fetch the transaction from the configured
devnet RPC and require a successful confirmed transaction before classifying
it. Check the exact target program, vault, instruction, and account roles.
Inspect all top-level instructions, not just the first one. Ignore failed
transactions, SOL donations, and calls that do not change this vault's
withdrawer.

If the administrative transaction is absent from the registry, submit the
upgrade using the prepared buffer. "Absent" means unapproved under this policy;
it does not prove that an attacker submitted it.

Persist job state by signature, resume unfinished jobs after restart, and make
the response idempotent. Do not mark a job complete merely because an upgrade
was submitted. If a submission result is uncertain, reconcile chain state
before retrying. An already installed freeze binary is a successful result;
a consumed buffer is not a reason to attempt a fresh deployment.

Confirm the upgrade and verify the deployed freeze bytes. Solana documents
that the new code becomes effective in the slot after deployment, so upgrade
submission alone is not evidence that the withdrawal path is frozen.

## End-to-end demonstrations

| Scenario | Required observation |
| --- | --- |
| Normal operation | An authorized withdrawal works before containment. |
| Approved change | A pre-registered admin transaction changes the withdrawer without triggering an upgrade. |
| Noise and failure | An unrelated SOL transfer and a failed admin instruction do not trigger an upgrade. |
| Attack without containment | An unapproved change followed by withdrawal drains the vault's spendable balance when the responder is disabled. |
| Attack with containment | A real Helius callback triggers the upgrade; a later submitted withdrawal fails specifically with `Frozen`; the vault balance is unchanged by that attempt. |
| Duplicate delivery and restart | Replaying a callback or restarting with an unfinished job does not lose the job or redeploy unnecessarily. |
| Atomic attack | A transaction containing both the admin change and withdrawal drains the vault before a webhook can respond. |

Use fresh vaults and restore the original program through the separate upgrade
authority between scenarios as necessary. Prepare a new freeze buffer for each
actual upgrade; the loader consumes the old buffer.

For the contained demonstration, explicitly wait for containment before
submitting the withdrawal. Label this as a functional end-to-end test, not a
race benchmark. Submit the failed withdrawal on-chain rather than reporting
only a preflight simulation error.

Record public transaction signatures, slots, receiver timestamps, upgrade
submission and confirmation timestamps, and vault balances. Distinguish local
elapsed times from chain block times. These observations describe that run;
they are not a delivery SLA or a general prevention guarantee.

The atomic-attack scenario is an intentional limitation test. Adding an
on-chain delay could create a response window, but would change the mechanism
being demonstrated.

## Implementation shape

- Rust vault program and separate freeze program.
- TypeScript command-line scripts for setup, approved changes, attacks, and
  checking outcomes.
- A TypeScript HTTP receiver and worker sharing a local SQLite database.
- Public devnet configuration and an example environment file containing
  placeholders only.
- A walkthrough with the commands and public transaction links from the live
  demonstration.

Use locked dependencies. Keep key material, Helius credentials, authorization
headers, local databases, and generated signing artifacts out of Git.

## Article wording

> A protocol's application admin and its program upgrade authority can be
> controlled by different keys. Our demo deliberately separates them. Even
> after an attacker compromises the admin and changes the vault's withdrawal
> account, the independent upgrade authority can replace the program with a
> prebuilt version that rejects every instruction.
>
> This response only protects funds that have not already moved. Webhooks
> arrive after confirmation, so the upgrade must take effect before the
> attacker withdraws. If the configuration change and withdrawal happen in
> the same transaction, this monitor cannot intervene between them.

The example models a compromised-admin sequence. It does not reproduce Drift
or establish that this exact design would have prevented that incident.

## Live-run prerequisites

A Helius API key and a public HTTPS receiver are needed for the real delivery
test. A local receiver exposed through an HTTPS tunnel is sufficient. Create
the Helius account separately and provide credentials through local environment
configuration; never paste them into the article or commit them.

Program development and local transaction tests can proceed before this setup.
Local webhook fixtures alone do not establish that the Helius integration works.

## References

- [Helius webhook overview](https://www.helius.dev/docs/webhooks)
- [Helius webhook FAQ: devnet, authentication, delivery, and retries](https://www.helius.dev/docs/faqs/webhooks)
- [Helius create-webhook parameters](https://www.helius.dev/docs/api-reference/webhooks/create-webhook)
- [Solana program deployment and upgrade behavior](https://solana.com/docs/core/programs/program-deployment)
- [Solana transaction atomicity](https://solana.com/docs/core/transactions)
