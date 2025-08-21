#!/usr/bin/env bash
set -euo pipefail
DUR=30
MODE="wasm"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration) DUR="$2"; shift 2;;
    --mode) MODE="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

echo "[bench] triggering ${DUR}s bench in MODE=${MODE}"

# Detect if HTTPS is being used
if docker compose exec web env | grep -q "HTTPS=1" 2>/dev/null; then
  PROTOCOL="https"
  CURL_OPTS="-k"  # Skip certificate verification for self-signed certs
else
  PROTOCOL="http"
  CURL_OPTS=""
fi

curl -s $CURL_OPTS -X POST -H 'Content-Type: application/json' \
  -d "{\"duration\": ${DUR}, \"mode\": \"${MODE}\"}" \
  ${PROTOCOL}://localhost:3000/api/bench/start | jq . || true

echo "[bench] waiting ${DUR}s + 3s for metrics to flush..."
sleep $((DUR+3))

if [ -f "./data/metrics.json" ]; then
  echo "[bench] metrics ready at ./data/metrics.json"
  cat ./data/metrics.json
else
  echo "[bench] metrics.json not found. Ensure the viewer page was open and phone streaming."
  exit 1
fi
