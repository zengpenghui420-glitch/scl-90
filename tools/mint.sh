#!/usr/bin/env bash
# scl-90: mint limited-use codes (collection sc/, prefix SC)
# Usage: MANTLE_KEY=... ./tools/mint.sh [count]
#    or: MANTLE_CREDS=/path/to/mantle.json ./tools/mint.sh [count]
# Each code has MAX_USES uses (default 3). Alphabet matches history-quiz (no I,L,O,0,1).
set -euo pipefail
NS="${MANTLE_NS:-catquiz-zph420-codes}"
COL="${MANTLE_COL:-sc}"
PREFIX="${CODE_PREFIX:-SC}"
KEY="${MANTLE_KEY:-}"
COUNT="${1:-10}"
MAX_USES="${MAX_USES:-3}"
if [[ -z "$KEY" && -f "${MANTLE_CREDS:-}" ]]; then
  KEY=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['key'])" "$MANTLE_CREDS")
fi
if [[ -z "$KEY" ]]; then
  echo "Set MANTLE_KEY env (write key for namespace $NS)" >&2
  exit 1
fi
ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789'
minted=()
i=0
while [[ $i -lt $COUNT ]]; do
  code="$PREFIX"
  for _ in 1 2 3 4; do
    code+=${ALPHABET:RANDOM%${#ALPHABET}:1}
  done
  st=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Mantle-Key: $KEY" "https://mantledb.sh/v2/$NS/$COL/$code")
  [[ "$st" == "404" ]] || continue
  resp=$(curl -sS -X POST "https://mantledb.sh/v2/$NS/$COL/$code" \
    -H "Content-Type: application/json" \
    -H "X-Mantle-Key: $KEY" \
    -H "User-Agent: scl90-mint/1.0" \
    -d "{\"remaining\":$MAX_USES,\"max\":$MAX_USES,\"created\":\"$(date -Iseconds)\"}")
  echo "$code  $resp"
  if [[ "$resp" != *'"success":true'* ]]; then
    echo "mint failed for $code" >&2
    exit 1
  fi
  minted+=("$code")
  i=$((i+1))
done
echo "-----"
echo "Minted ${#minted[@]} codes (each $MAX_USES uses) in $NS/$COL/:"
printf '%s\n' "${minted[@]}"
