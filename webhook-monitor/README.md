# Helius security monitor demo

A SOL vault whose admin can change its authorized withdrawer, plus an automated
guardian that pauses it when a Helius webhook reports an unapproved admin change.

The guardian can only pause. Its authority is fixed at initialization, separate
from the admin, and there is no unpause or reset instruction. Each demonstration
uses a fresh vault.

```mermaid
sequenceDiagram
    participant A as Compromised admin
    participant S as Solana
    participant H as Helius
    participant B as Pause bot
    A->>S: Change withdrawer to attacker
    S-->>H: Confirmed transaction involving vault
    H->>B: Raw webhook notification
    B->>B: Persist notification and check approval
    B->>S: Pause using separate guardian key
    A->>S: Withdraw
    S-->>A: Paused; funds remain
```

See [the design](docs/design.md) for the threat model and limitations.

See [the live devnet proof](docs/live-devnet-proof.md) for public
transactions from the completed end-to-end run.

## Components

- [Vault program](src/lib.rs): initialize, change withdrawer, withdraw, and pause.
- [Bot](src/bot.mjs): authenticated HTTP receiver and durable SQLite jobs.
- [Monitor](src/monitor.mjs): re-fetch confirmed transactions, match approvals,
  and submit and confirm a pause through RPC or Helius Sender Max.
- [CLI](src/cli.mjs): create vaults and exercise the approved and attacker paths.
- [Runtime tests](tests/vault.rs) and [receiver tests](test/monitor.test.mjs).

The client and bot use JavaScript modules to run directly on Node, avoiding a
TypeScript build step. Keys are loaded from external files and never generated
by these scripts.

## Build and test

Use Linux, Node 22.13 or newer, the pinned pnpm from `package.json`, and a
Rust toolchain compatible with `Cargo.lock`. Under the managed Codex workspace,
run these commands inside `codex-in-container`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
cargo test --locked
bash scripts/build-sbf.sh
```

The SBF build script downloads the exact Anza platform-tools v1.58 release,
checks its pinned SHA-256 digest before extraction, and builds with the lockfile.
It supports Linux ARM64 and x86-64. It does not mutate Rustup or generate a
program signing keypair. The deployment artifact is
`target/deploy/failsafe_vault.so`.

To exercise the compiled binary in the Solana runtime harness:

```sh
BPF_OUT_DIR=target/deploy cargo test --locked --test vault
```

Without `BPF_OUT_DIR`, the runtime tests execute the Rust processor directly.
The Node tests use a local HTTP server and a simulated RPC; they do not contact
Helius or establish live webhook delivery.

## Configure devnet accounts

Use separate devnet accounts for the deployment authority, application admin,
initial withdrawer, attacker, and bot, plus a program identity keypair.
Use the existing project wallet registry when running in the managed workspace.
Keep all secret files outside this checkout.

Copy `.env.example` to an external configuration file and fill in:

| Variable | Value |
| --- | --- |
| `RPC_URL` | Solana devnet RPC; a Helius devnet RPC can be used |
| `PROGRAM_ID` | Public key of the program identity |
| `DEPLOYER_KEYPAIR` | External deployment-authority keypair file |
| `PROGRAM_KEYPAIR` | External program identity keypair file |
| `ADMIN_KEYPAIR` | External admin keypair file |
| `WITHDRAWER_KEYPAIR` | External initial-withdrawer keypair file |
| `ATTACKER_KEYPAIR` | External attacker keypair file |
| `BOT_KEYPAIR` | External guardian keypair file |
| `DB_PATH` | Path to the local SQLite registry and jobs database |
| `WEBHOOK_AUTH` | Secret Authorization header value configured in Helius |
| `PORT` | Receiver TCP port |
| `SENDER_ENABLED` | `1` to submit pauses through Helius Sender Max on mainnet; use `0` for the devnet demo |
| `ALLOW_MAINNET` | Must be `1` together with `SENDER_ENABLED=1`; prevents accidental mainnet use |
| `SENDER_URL` | Sender endpoint; use the global HTTPS `/fast` endpoint or a keyless regional HTTP endpoint |
| `SENDER_TIP_LAMPORTS` | Sender Max tip; at least `1000000` lamports |
| `SENDER_PRIORITY_MICROLAMPORTS` | Compute unit price; defaults to `200000` micro-lamports per compute unit |

New callbacks wake the worker immediately. Solana slot notifications wake
pending work again as chain state advances, and startup resumes saved jobs.
No polling interval needs configuring. The RPC must support standard Solana
WebSocket subscriptions; Helius devnet endpoints provide them.

Fund the deployment authority for program rent and fees, the admin for vault
rent and its chosen deposit, and the other transaction senders for fees.
Use devnet SOL only. Determine deployment rent from the compiled program size.

Helius Sender is a mainnet service. It cannot submit this devnet demo's pause
transaction. With Sender disabled, the bot uses the configured devnet RPC as
shown in this walkthrough.

The scripts verify the devnet genesis hash before sending. A loopback validator
is allowed only with `ALLOW_LOCALNET=1`. The demo CLI rejects mainnet. The bot
permits it only when both `SENDER_ENABLED=1` and `ALLOW_MAINNET=1` are set.

## Submit production pauses through Helius Sender Max

The bot can use [Helius Sender Max](https://www.helius.dev/docs/sending-transactions/sender-max)
when the monitored vault is on mainnet. This is separate from the devnet
walkthrough below. Enable it only with a mainnet RPC and all three explicit
settings:

```sh
ALLOW_MAINNET=1
SENDER_ENABLED=1
SENDER_URL=https://sender.helius-rpc.com/fast
```

The bot checks the RPC genesis hash and refuses to use Sender on devnet. It
warms the Sender connection during idle periods and, for an unapproved change,
builds one atomic transaction containing:

1. A compute unit limit and priority fee.
2. The guardian-only pause instruction.
3. A transfer of at least 0.001 SOL to a current Sender tip account.

The default priority fee is 20,000 lamports. Fund the guardian with enough SOL
for the tip, priority fee, and transaction fee. A higher `SENDER_TIP_LAMPORTS`
can increase placement priority; `SENDER_PRIORITY_MICROLAMPORTS` can be tuned to
current network conditions.

The global HTTPS endpoint is the safe default. For lower server-to-server
latency, Helius also publishes regional HTTP endpoints. Leave the Sender URL
keyless if using HTTP so an API key is not sent over plaintext. Keyless Sender
requests are limited to one per second, which is sufficient for this
low-frequency guardian.

Sender submissions skip preflight and disable its internal retries. A Sender
HTTP failure falls back to submitting the exact same signed transaction through
the configured RPC. An uncertain result remains a pending durable job; the bot
checks authoritative vault state before retrying, so an already landed pause is
not submitted again.

The bot's runtime needs only its own signing key. Keep admin signing and
approval-writing access out of the bot's exposed HTTP interface. The demo's
threat model assumes the attacker has the admin key, not access to the registry
or bot host.

## Deploy and initialize

Load your external environment configuration into a shell, for example:

```sh
set -a
source /absolute/path/outside-the-checkout/demo.env
set +a
bash scripts/deploy-devnet.sh
```

The deployment script requires an installed Solana CLI and rejects reuse of
the admin or bot as the deployment authority. It leaves the upgrade key with
the separate deployer.

Choose your deposit in lamports and initialize a vault:

```sh
node src/cli.mjs init "$VAULT_LAMPORTS"
```

Set `VAULT` to the public address printed by that command, both in your shell
and the configuration used to start the bot. The initializer requires signatures
from the admin and guardian and deposits the chosen funds atomically.

```sh
node src/cli.mjs state
node src/cli.mjs withdraw "$WITHDRAWAL_LAMPORTS"
```

The withdrawal command uses the initial withdrawer. Its amount must leave rent
in the vault. Amount variables in this walkthrough are your chosen positive
integer lamport values.

## Connect the Helius webhook

1. Start the bot with the external environment loaded:
   `node src/bot.mjs`.
2. Expose its port using a public HTTPS endpoint or an HTTPS tunnel.
3. In the [Helius dashboard](https://dashboard.helius.dev), create a webhook:
   choose **Devnet**, **Raw**, and the vault address as the monitored account.
   Set its URL to your HTTPS endpoint followed by `/webhook`.
4. Configure the webhook's authorization value to match `WEBHOOK_AUTH`.
5. Confirm deliveries are successful in the dashboard.

For a temporary development endpoint, run `bash scripts/https-tunnel.sh` in
the same Linux container as the bot, with the same `PORT`. The helper downloads
a pinned Cloudflare tunnel binary, verifies its SHA-256 digest, and prints a
public HTTPS URL. Keep it running and append `/webhook` when configuring Helius.
Runtime auto-update is disabled.

The receiver expects the JSON array used by raw webhooks, with each transaction's
signature at `transaction.signatures[0]`. It returns 403 for a wrong
authorization header. It commits valid signatures to SQLite before returning
200, then processes them asynchronously. Helius documents a one-second
acknowledgment requirement.

The worker fetches the confirmed transaction independently and checks its
program, vault, admin signer, and instruction bytes. It ignores failed
transactions and donations. Admin changes through CPI are rejected by the
on-chain program so the parser's top-level scope cannot be bypassed.

## Run the demonstrations

Use the same database for the approved-change command and the bot.

**Approved change and irrelevant activity**

```sh
node src/cli.mjs approved-change "$LEGITIMATE_WITHDRAWER_PUBLIC_KEY"
node src/cli.mjs donate "$DONATION_LAMPORTS"
node src/cli.mjs jobs
node src/cli.mjs state
```

The approved command records the exact signed transaction signature before
broadcast. Both transactions should leave the vault active. The signature
covers the entire transaction; the registry never approves solely on the
basis of an admin signature.

**Uncontained attack**

With the bot stopped, use a fresh funded vault:

```sh
node src/cli.mjs attack-change
node src/cli.mjs drain
```

The attacker withdraws the entire spendable balance, leaving rent.

**Contained attack**

Create a fresh funded vault. Update `VAULT`, restart the bot, and point the
Helius webhook at that vault. Then run:

```sh
node src/cli.mjs attack-change
node src/cli.mjs wait-paused
node src/cli.mjs expect-paused
node src/cli.mjs jobs
```

`wait-paused` waits until confirmed state reports a pause; interrupt it if the
delivery or response needs investigation. `expect-paused` submits the
attacker's withdrawal on-chain with preflight skipped and requires the
specific `Paused` custom error and an unchanged vault balance.

This sequence proves functional containment after the pause lands. It is not
a race benchmark. Preserve the public transaction signatures and bot timestamps
for the article, and distinguish local elapsed time from chain block time.

**Same-transaction limitation**

On another fresh funded vault:

```sh
node src/cli.mjs attack-atomic
```

This combines the admin change and drain in one transaction. Both succeed
before the bot can respond, even if monitoring is enabled.

## Boundaries

The on-chain guardian's pause is one-way. A false positive or compromised
guardian can lock funds under this program, and losing the guardian key removes
the ability to pause. Unrelated senders can still deposit SOL into a paused
vault.

The separate deployment authority can replace the program and bypass its
rules; neither the admin nor the bot should hold that key. A production recovery
or rotation policy would need independent governance.

Webhooks arrive after confirmation. The bot cannot undo a completed withdrawal,
and delayed or missing deliveries can prevent containment. The code models a
compromised-admin sequence and does not establish that it would have prevented
a particular historical exploit.

Helius Sender improves the chance and speed of inclusion, but does not
eliminate the race. Its availability, tip competition, priority-fee market,
and the guardian's SOL balance all affect whether a pause lands before an
attacker's next transaction.

References: [Helius webhook FAQ](https://www.helius.dev/docs/faqs/webhooks),
[Solana transaction atomicity](https://solana.com/docs/core/transactions),
[Solana upgrade authority](https://solana.com/docs/core/programs/program-deployment).
