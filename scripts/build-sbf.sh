#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in
  webhook-monitor) program=failsafe_vault ;;
  parsed-streams-monitor) program=rain_collateral_guard ;;
  *) echo 'Usage: bash scripts/build-sbf.sh <webhook-monitor|parsed-streams-monitor>' >&2; exit 1 ;;
esac
# Anza v1.58 release assets and published SHA-256 digests.
case "$(uname -s)/$(uname -m)" in
  Linux/aarch64) asset=platform-tools-linux-aarch64.tar.bz2; digest=9732174e2217ccfa489dfd644cf9bd86c46226be83354c03b832f1b421596870 ;;
  Linux/x86_64) asset=platform-tools-linux-x86_64.tar.bz2; digest=7b82eb420b5aebd1e5590db0ae25c523eca06724d4238ae02139690535636c37 ;;
  Darwin/arm64) asset=platform-tools-osx-aarch64.tar.bz2; digest=17a89dae89936f045789d484140fd19a7bd992d4522d4ab0e9adeae565e35d12 ;;
  *) echo 'Supported build hosts: Apple Silicon macOS, Linux x64, and Linux ARM64.' >&2; exit 1 ;;
esac
cd "$root/$1"
mkdir -p "$root/.tools/platform-v1.58" target/deploy
archive="$root/.tools/$asset"
if [ ! -f "$archive" ]; then
  curl -fL "https://github.com/anza-xyz/platform-tools/releases/download/v1.58/$asset" -o "$archive.download"
  bash "$root/scripts/verify-sha256.sh" "$digest" "$archive.download"
  mv "$archive.download" "$archive"
fi
bash "$root/scripts/verify-sha256.sh" "$digest" "$archive"
tar -xjf "$archive" -m --no-same-owner --no-same-permissions \
  --exclude='./llvm/lib/python3.10' -C "$root/.tools/platform-v1.58"
tools="$root/.tools/platform-v1.58"
export RUSTC="$tools/rust/bin/rustc"
export CC="$tools/llvm/bin/clang"
export AR="$tools/llvm/bin/llvm-ar"
export CARGO_TARGET_DIR="$(pwd)/target"
cargo build --locked --release --lib --target sbpfv1-solana-solana
"$tools/llvm/bin/llvm-objcopy" --strip-all \
  "target/sbpfv1-solana-solana/release/$program.so" "target/deploy/$program.so"
printf 'Built %s\n' "$(pwd)/target/deploy/$program.so"
