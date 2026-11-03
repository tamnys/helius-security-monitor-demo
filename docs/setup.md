# Native setup

Use Apple Silicon macOS or Linux x64 for the complete devnet walkthrough. The
SBF build also supports Linux ARM64. Intel Macs are not supported by the pinned
Anza platform-tools release.

## Install the tools

| Tool       | Version | Installation                                                                                                                                                                                             |
| ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | 22.22.3 | Use the matching archive and signed checksums from the [Node release](https://nodejs.org/dist/v22.22.3/)                                                                                                 |
| pnpm       | 10.34.5 | With Node's Corepack: `corepack enable` then `corepack prepare pnpm@10.34.5 --activate`                                                                                                                  |
| Rust       | 1.95.0  | Install [rustup](https://rustup.rs/), then `rustup toolchain install 1.95.0 --profile minimal --component rustfmt`                                                                                       |
| Solana CLI | 2.2.1   | Download the matching macOS ARM64 or Linux x64 archive from the [Agave release](https://github.com/anza-xyz/agave/releases/tag/v2.2.1), extract it, and add its `solana-release/bin` directory to `PATH` |

On macOS, install the command-line tools with `xcode-select --install`. On
Linux, install your distribution's C/C++ build tools, `pkg-config`, OpenSSL
development headers, `curl`, `tar`, and `bzip2`. Rust runtime tests also need
`protoc`.

Check the selected versions:

```sh
node --version
pnpm --version
rustc --version
solana --version
solana-keygen --version
```

The build helper downloads Anza platform-tools **1.58** and verifies its pinned
SHA-256 before extraction. The optional webhook tunnel helper does the same for
Cloudflare **2026.10.3**. Neither creates signing keys.

Linux ARM64 users can build and test the programs natively. Agave 2.2.1 does not
provide a Linux ARM64 CLI archive; deployment requires a compatible CLI built
from the [pinned Agave source](https://github.com/anza-xyz/agave/tree/v2.2.1).

## Clone and choose a demo

```sh
git clone https://github.com/tamnys/helius-security-monitor-demo.git
cd helius-security-monitor-demo
```

Open `webhook-monitor/` or `parsed-streams-monitor/` and continue with its
README. Run installs with `pnpm install --frozen-lockfile --ignore-scripts`. The
lockfiles pin application dependencies; no TypeScript compilation is required.

## Keys and funding

Create the keys listed in the selected walkthrough in an external directory. Use
these keys only for devnet. Do not reuse a personal wallet, and do not put key
files or API credentials in this checkout.

Each walkthrough has a distinct deployment authority, program identity, app
admin/customer, attacker, and guardian. The webhook demo also has an initial
withdrawer. The guardian cannot withdraw or upgrade the program.

Fund the deployment authority for program rent and fees, the app admin/customer
for account rent plus the chosen deposit, and other transaction senders for
fees. The program identity does not need a separate transfer. Check program rent
with `solana rent` using the built `.so` file's byte count; deployment also
needs buffer rent and transaction fees.

Use the [Solana devnet faucet](https://faucet.solana.com/) or request an airdrop
for each role you need to fund:

```sh
solana --url devnet airdrop "$FUNDING_SOL" "$ROLE_PUBLIC_KEY"
solana --url devnet balance "$ROLE_PUBLIC_KEY"
```

Choose `FUNDING_SOL` for the role's needs. Faucet availability and request
limits vary. All deposit and withdrawal arguments in the demos are positive
integer lamport amounts: **1 SOL = 1,000,000,000 lamports**.

## Common setup problems

| Symptom                           | Next step                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Missing environment variable      | Load the external `.env` file in that terminal with `set -a; source /absolute/path/demo.env; set +a`          |
| Invalid key or address            | Check the named variable; use a keypair file for `*_KEYPAIR` and a public address for `VAULT` or `COLLATERAL` |
| Wrong network                     | Set `RPC_URL` to devnet; the demo CLI rejects mainnet                                                         |
| Guardian mismatch                 | Use the guardian that signed this account's initialization                                                    |
| A scenario has no spendable funds | Initialize a fresh account, update its address, and restart the monitor                                       |
| No pause or freeze appears        | Check bot logs and the delivery/fixture connection; use Ctrl-C to stop the waiting command                    |

For an existing managed Codex workspace, use its container and registered
wallets instead of generating replacements. That environment is optional;
readers do not need Codex to run the demos.
