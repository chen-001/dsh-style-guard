#!/bin/bash
# 客户端打包。tsdown 从 dsh checkout 的 node_modules 里取，插件自己不带构建依赖。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ]; then
  for candidate in "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
    if [ -d "$candidate/packages" ]; then CHECKOUT="$candidate"; break; fi
  done
fi
if [ -z "$CHECKOUT" ] || [ ! -d "$CHECKOUT/packages" ]; then
  echo "build:client: cannot locate the dsh checkout (set DSH_CHECKOUT)" >&2
  exit 1
fi

TSDOWN="$CHECKOUT/node_modules/.bin/tsdown"
if [ ! -x "$TSDOWN" ] && [ ! -f "$TSDOWN.cmd" ]; then
  echo "build:client: tsdown not found at $TSDOWN" >&2
  exit 1
fi

echo "=== Building client bundle ==="
"$TSDOWN"
echo "=== Client build complete ==="
