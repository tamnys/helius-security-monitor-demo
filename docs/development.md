# Development

Install each demo's dependencies in its directory. From the repository root,
install the pinned formatter and run the JavaScript suites:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir webhook-monitor install --frozen-lockfile --ignore-scripts
pnpm --dir parsed-streams-monitor install --frozen-lockfile --ignore-scripts
pnpm test
pnpm format:check
pnpm docs:check
```

Inside each demo:

```sh
pnpm test:rust
pnpm build
pnpm test:sbf
```

`test:rust` runs the Rust processor in the Solana runtime harness. `test:sbf`
loads the compiled program from `target/deploy`. JavaScript tests use local
fixtures and simulated RPC responses; they need no Helius credentials or funds.

Use `pnpm format` at the root for JavaScript, Markdown, and configuration files.
Format Rust with `cargo fmt --manifest-path <demo>/Cargo.toml`. Each demo keeps
its own dependencies and runtime modules; the root package is development-only.

CI runs on Linux x64, Linux ARM64, and Apple Silicon macOS. It checks
formatting, documentation links, JavaScript tests, native Rust tests, SBF
builds, and the compiled programs. The tunnel executable is checked without
opening a public endpoint. Live webhook delivery and the credentialed Parsed
Streams smoke test are manual checks described in the walkthroughs.

## Command output

`pnpm demo --help` works without environment variables or network access.
Commands print readable results by default, including devnet transaction links.
Use `pnpm --silent demo <command> --json` for a single JSON result on stdout.
Errors go to stderr and return a nonzero exit code. Bots keep structured JSON
logs for received events, pending jobs, and confirmed containment.

## Compatibility

The examples use fixed instruction tags and account layouts shared by Rust and
JavaScript. Changes must preserve those bytes, exact-signature approvals,
guardian authority separation, and the one-way pause/freeze behavior. The
collateral program's missing admin check is intentional and is part of its test
scenarios.

The historical proof pages describe the artifacts and transactions from their
recorded runs. New runs should be recorded separately rather than overwriting
those records. See the
[November 2, 2026 verification run](verification-2026-11-02.md) for the results
from the current examples.
