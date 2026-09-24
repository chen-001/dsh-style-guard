#!/bin/bash
# 客户端开关的离线自测。走 dsh 源码目录里的 tsx 跑 TypeScript，自带 jsdom。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ]; then
  for candidate in "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
    if [ -d "$candidate/node_modules" ]; then CHECKOUT="$candidate"; break; fi
  done
fi
TSX="$CHECKOUT/node_modules/.bin/tsx"
if [ ! -x "$TSX" ] && [ ! -f "$TSX.cmd" ]; then
  echo "test:client: tsx not found at $TSX" >&2
  exit 1
fi

exec "$TSX" scripts/test-client.mts
