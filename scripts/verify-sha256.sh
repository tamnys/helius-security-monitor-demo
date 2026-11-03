#!/usr/bin/env bash
set -euo pipefail
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$1" "$2" | sha256sum -c -
else
  printf '%s  %s\n' "$1" "$2" | shasum -a 256 -c -
fi
