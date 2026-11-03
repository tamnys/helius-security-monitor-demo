# Helius security monitor demos

Two runnable Solana examples for **Detect and Contain Security Threats with
Helius**. Each detects an unapproved admin action and uses a separate guardian
to stop later withdrawals.

| Demo                                                       | Attack                                                   | Detection                                                         | Response                                  |
| ---------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| [Webhook monitor](webhook-monitor/README.md)               | A compromised admin changes a vault's withdrawer         | Real Helius raw webhooks on devnet                                | Pause the vault                           |
| [Parsed Streams monitor](parsed-streams-monitor/README.md) | An attacker exploits a missing admin authorization check | A local Parsed Streams fixture backed by real devnet transactions | Freeze the affected customer's collateral |

Start with the **webhook monitor** for the shortest path through detection and
containment. The **Parsed Streams monitor** adds account isolation, reconnects,
and historical recovery. Its optional read-only smoke command connects to the
real Helius service separately.

## Get started

1. Install the tools in [native setup](docs/setup.md): Apple Silicon macOS or
   Linux x64. Linux ARM64 also supports the SBF build and tests.
2. Clone this repo and open either demo directory.
3. Follow that demo's README to create external devnet key files, deploy your
   own program, start the monitor, and run the scenarios.

All walkthrough transactions use **devnet SOL**. Pauses and freezes are one-way,
so each attack scenario uses a fresh account. Monitoring cannot interrupt an
atomic transaction or reverse funds already withdrawn.

## Explore

- Each demo's `src/lib.rs` contains its on-chain program.
- `src/commands.mjs` contains the scenario actions; `src/monitor.mjs` contains
  the containment decision.
- Each `docs/design.md` explains the architecture and trust assumptions.
- Each `docs/live-devnet-proof.md` records historical public transactions.
- [Development](docs/development.md) covers formatting, tests, and CI.

The examples are independent JavaScript/Rust projects. Shared scripts only
handle development tooling. The collateral program is intentionally vulnerable;
these examples are educational, not production deployments.
