#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PORT:?Set the receiver port}"
# Cloudflare 2026.10.3, published 2026-10-21; upstream GitHub SHA-256 digests.
case "$(uname -s)/$(uname -m)" in
  Linux/aarch64) asset=cloudflared-linux-arm64; digest=89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8 ;;
  Linux/x86_64) asset=cloudflared-linux-amd64; digest=053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0 ;;
  *) echo "Run the tunnel inside the Linux container that runs the bot." >&2; exit 1 ;;
esac
mkdir -p .tools
binary=".tools/$asset-2026.10.3"
if [ ! -f "$binary" ]; then
  curl -fL "https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/$asset" -o "$binary"
fi
printf '%s  %s\n' "$digest" "$binary" | sha256sum -c -
chmod 755 "$binary"
exec "$binary" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT"
