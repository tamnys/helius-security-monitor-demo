#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Exact upstream release assets and GitHub-published SHA-256 digests:
# https://github.com/anza-xyz/platform-tools/releases/tag/v1.58
case "$(uname -s)/$(uname -m)" in
  Linux/aarch64) asset=platform-tools-linux-aarch64.tar.bz2; digest=9732174e2217ccfa489dfd644cf9bd86c46226be83354c03b832f1b421596870 ;;
  Linux/x86_64) asset=platform-tools-linux-x86_64.tar.bz2; digest=7b82eb420b5aebd1e5590db0ae25c523eca06724d4238ae02139690535636c37 ;;
  *) echo "Run this build inside a Linux development container." >&2; exit 1 ;;
esac
mkdir -p .tools/platform-v1.58 target/deploy
archive=".tools/$asset"
if [ ! -f "$archive" ]; then
  curl -fL "https://github.com/anza-xyz/platform-tools/releases/download/v1.58/$asset" -o "$archive"
fi
printf '%s  %s\n' "$digest" "$archive" | sha256sum -c -
# Verify the archive on every build; replace extracted tool files from it.
tar -xjf "$archive" --no-same-owner --no-same-permissions --touch \
  --exclude='./llvm/lib/python3.10' -C .tools/platform-v1.58
tools="$(pwd)/.tools/platform-v1.58"
export RUSTC="$tools/rust/bin/rustc"
export CC="$tools/llvm/bin/clang"
export AR="$tools/llvm/bin/llvm-ar"
export CARGO_TARGET_DIR="$(pwd)/target"
cargo build --locked --release --lib --target sbpfv1-solana-solana
"$tools/llvm/bin/llvm-objcopy" --strip-all target/sbpfv1-solana-solana/release/failsafe_vault.so target/deploy/failsafe_vault.so
printf 'Built %s\n' "$(pwd)/target/deploy/failsafe_vault.so"
# Unlike cargo-build-sbf, this build does not generate a signing keypair.
