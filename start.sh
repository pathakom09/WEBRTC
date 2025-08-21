#!/usr/bin/env bash
set -euo pipefail

# Read from .env file if it exists
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

NGROK="${NGROK:-0}"    # 1 to run ngrok (requires NGROK_AUTHTOKEN env var)
MODE="${MODE:-wasm}"   # wasm | server
HTTPS="${HTTPS:-0}"    # 1 to enable HTTPS

echo "[start] MODE=$MODE"
export MODE

if [ "$HTTPS" = "1" ]; then
  echo "[start] HTTPS enabled"
  export HTTPS=1
  if [ ! -f "./certs/server.crt" ] || [ ! -f "./certs/server.key" ]; then
    echo "[start] HTTPS certificates not found. Generating..."
    ./setup-https.sh
  fi
else
  export HTTPS=0
fi

docker compose up --build -d

if [ "$HTTPS" = "1" ]; then
  echo "[start] Open https://localhost:3000 then click 'New Room' to get a QR for your phone."
  echo "[start] Camera access will work on mobile devices with HTTPS."
else
  echo "[start] Open http://localhost:3000 then click 'New Room' to get a QR for your phone."
  echo "[start] For mobile camera access, use: HTTPS=1 ./start.sh"
fi

if [ "$MODE" = "server" ]; then
  echo "[start] Ensure a model exists at web/models/yolov5n.onnx (see README for download)."
fi

if [ "${1:-}" = "--ngrok" ] || [ "$NGROK" = "1" ]; then
  if [ -z "${NGROK_AUTHTOKEN:-}" ]; then
    echo "Set NGROK_AUTHTOKEN to use ngrok." >&2
    exit 1
  fi
  docker run --rm -it -e NGROK_AUTHTOKEN -p 4040:4040 ngrok/ngrok:3 http --domain=auto 3000
fi
