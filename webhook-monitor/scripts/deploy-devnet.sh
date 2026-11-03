#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${RPC_URL:?Set a devnet RPC URL}"
: "${DEPLOYER_KEYPAIR:?Set an external devnet deployer keypair path}"
: "${PROGRAM_KEYPAIR:?Set an external program identity keypair path}"
node --input-type=module -e '
import { connection, keypair } from "./src/client.mjs";
await connection();
const deployer = keypair("DEPLOYER_KEYPAIR");
keypair("PROGRAM_KEYPAIR");
for (const name of ["ADMIN_KEYPAIR", "BOT_KEYPAIR"]) {
  if (deployer.publicKey.equals(keypair(name).publicKey)) throw new Error("Deployment authority must be separate from admin and bot");
}
'
# Explicitly separate deployment from the application admin and pause bot.
solana --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" program deploy \
  target/deploy/failsafe_vault.so --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "$DEPLOYER_KEYPAIR"
