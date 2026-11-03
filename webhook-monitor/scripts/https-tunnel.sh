#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root/webhook-monitor"
: "${PORT:?Set the receiver port}"
# Cloudflare 2026.10.3 release assets and published SHA-256 digests.
case "$(uname -s)/$(uname -m)" in
  Linux/aarch64) asset=cloudflared-linux-arm64; digest=89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8 ;;
  Linux/x86_64) asset=cloudflared-linux-amd64; digest=053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0 ;;
  Darwin/arm64) asset=cloudflared-darwin-arm64.tgz; digest=1165d14b6f6360a3b8c283d7d1100024d6ec7cd9bc9e32519e96150645f3ec55 ;;
  *) echo 'Supported tunnel hosts: Apple Silicon macOS, Linux x64, and Linux ARM64.' >&2; exit 1 ;;
esac
mkdir -p .tools
archive=".tools/$asset-2026.10.3"
if [ ! -f "$archive" ]; then
  curl -fL "https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/$asset" -o "$archive.download"
  bash "$root/scripts/verify-sha256.sh" "$digest" "$archive.download"
  mv "$archive.download" "$archive"
fi
bash "$root/scripts/verify-sha256.sh" "$digest" "$archive"
case "$asset" in
  *.tgz)
    mkdir -p .tools/cloudflared-2026.10.3
    tar -xzf "$archive" -C .tools/cloudflared-2026.10.3 cloudflared
    binary=.tools/cloudflared-2026.10.3/cloudflared
    ;;
  *) binary="$archive" ;;
esac
chmod 755 "$binary"
# Allows CI to verify the downloaded executable without opening a public tunnel.
if [ "${1:-}" = '--version' ]; then exec "$binary" --version; fi
exec "$binary" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT"
