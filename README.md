
# Real-time WebRTC VLM Multi-Object Detection (Phone → Browser → Inference → Overlay)

**One-line goal:** Real-time multi-object detection on live video streamed from a phone via **WebRTC**, bounding boxes + labels returned to the browser, overlayed in near real-time. Two modes are supported:

- `wasm` (low-resource, default): on-device inference in the **browser** using `onnxruntime-web` + a small ONNX model.
- `server`: the **browser** samples frames from the WebRTC video and sends them to a lightweight **Python** inference server over WebSocket; server returns detection JSON.

This repo includes a 1-command start, QR-based phone join, metrics collection, bench script, Dockerfiles, and docker-compose.

---

## 🚀 Step-by-Step Instructions

### Quick Start (Recommended)
```bash
# 1. Clone the repository
git clone https://github.com/pathakom09/WEBRTC.git
cd WEBRTC

# 2. Start the system (defaults to MODE=wasm if no GPU)
./start.sh
# OR using Docker Compose directly:
# docker-compose up --build

# 3. Open the application
# Open http://localhost:3000 on your laptop
# Scan displayed QR code with your phone
# Allow camera access on phone
# You should see phone video mirrored on laptop with overlays

# 4. Run benchmarks to collect metrics
./bench/run_bench.sh --duration 30 --mode wasm
# Inspect the generated metrics
cat metrics.json
```

### If Phone Cannot Reach Laptop Directly
```bash
# Use ngrok for public access with automatic HTTPS
./start.sh --ngrok
# Copy the displayed ngrok public URL to your phone browser
```

### Alternative: Manual HTTPS Setup
```bash
HTTPS=1 ./start.sh     # enables HTTPS for mobile camera access
# then open https://localhost:3000 on your laptop
```

**Switch modes**

```bash
MODE=server ./start.sh   # server mode (Python CPU inference)
MODE=wasm   ./start.sh   # back to wasm mode (default)
HTTPS=1 MODE=server ./start.sh  # server mode with HTTPS for mobile
```

**Phone connectivity issues?**

The application now automatically detects your local IP address for the phone URL. If you still have issues:

1. **Check same Wi-Fi**: Ensure your phone and laptop are on the same Wi-Fi network.

2. **Manual IP override**: If auto-detection fails, set your IP manually:
   ```bash
   HOST_IP=192.168.1.100 ./start.sh  # Replace with your actual IP
   ```

3. **Find your IP**: Use the helper script:
   ```bash
   ./get-ip.sh  # Shows detected IP addresses
   ```

4. **HTTPS for mobile camera**: Modern browsers require HTTPS for camera access from remote hosts:
   ```bash
   HTTPS=1 ./start.sh  # Enables HTTPS with self-signed certificates
   # Open https://localhost:3000, accept certificate warning
   # On phone: visit https://your-ip:3000 first, accept certificate, then scan QR
   ```

6. **Use ngrok for remote access**:
   ```bash
   NGROK=1 NGROK_AUTHTOKEN=<your-token> ./start.sh --ngrok
   # copy the printed public URL to your phone
   ```

---

## Phone join (QR / short URL)

1. Open **http://localhost:3000** on the laptop (Viewer).
2. Click **"New Room"** → a QR is shown.
3. Scan the QR with the phone to open **/phone.html?room=...** and allow the camera.
4. You should see the phone's video mirrored on the laptop with overlays.

> The phone uses **WebRTC** to stream the camera directly to the viewer browser. No native app needed.

---

## Metrics & Bench

Start a 30s bench from the UI (**Start 30s Bench**), or from CLI:

```bash
./bench/run_bench.sh --duration 30 --mode wasm
# or
./bench/run_bench.sh --duration 30 --mode server
```

This produces `./data/metrics.json` like:

```json
{
  "duration_sec": 30,
  "mode": "wasm",
  "median_e2e_ms": 85,
  "p95_e2e_ms": 140,
  "median_server_ms": 0,
  "p95_server_ms": 0,
  "median_network_ms": 35,
  "p95_network_ms": 80,
  "processed_fps": 12.3,
  "uplink_kbps": 420.5,
  "downlink_kbps": 530.8,
  "timestamp_ms": 1690000000000
}
```

**Definitions** (computed per frame; reported over 30s):

- **E2E latency**: `overlay_display_ts - capture_ts` (ms)
- **Server latency**: `inference_ts - recv_ts` (ms)
- **Network latency**: `recv_ts - capture_ts` (ms)
- **Processed FPS**: frames with detections displayed / seconds
- **Uplink/Downlink kbps**: measured by counting bytes we send/receive for Python WS + WebRTC pings during the bench window

> The **viewer** posts metrics back to the Node server at `POST /api/bench/finish`, which saves `data/metrics.json`.

---

## Low-resource mode (WASM)

- Inference runs **in the viewer browser** using `onnxruntime-web` WASM backend.
- Default input is downscaled to **320×320**; target **10–15 FPS**.
- Frame thinning: we always process the **latest** frame (requestAnimationFrame loop) and discard old ones when slow.
- You must provide a small ONNX detection model at `web/models/yolov5n.onnx` (see below).

**Model setup**

Place a lightweight ONNX detection model at `web/models/yolov5n.onnx`. Examples:
- YOLOv5n or YOLOv8n (exported to ONNX; quantized where possible).
- MobileNet-SSD variants (converted to ONNX).

> The frontend loads the model from `/models/yolov5n.onnx`. Adjust `web/js/viewer.js` if you use a different filename or input signature.

---

## Server mode (Python CPU)

- Viewer samples JPEG frames (~320px, moderate quality) from the WebRTC video (phone stream).
- Frames are sent over **WebSocket** to `infer` (Python), which runs ONNX Runtime CPU inference.
- Server returns detection JSON in the contract:

```json
{
  "frame_id": 1,
  "capture_ts": 1690000000000,
  "recv_ts": 1690000000100,
  "inference_ts": 1690000000120,
  "detections": [
    { "label": "person", "score": 0.93, "xmin": 0.12, "ymin": 0.08, "xmax": 0.34, "ymax": 0.67 }
  ]
}
```

> Coordinates are normalized [0..1] to simplify overlay across resolutions.

**Provide model**: mount the same `web/models/yolov5n.onnx` into the Python container (already mounted via docker-compose).

---

## One-command run (Docker)

This repo comes with two containers:

- `web` → Node server (Express + WS) serving static frontend and handling signaling + metrics.
- `infer` → Python ONNXRuntime WS server (only needed in `MODE=server`).

```bash
./start.sh                 # builds & starts both containers (infer is idle in wasm mode)
docker compose logs -f     # tail logs if needed
```

---

## Design choices (short) & backpressure

- **Signaling**: minimal **WebSocket** relay (no external STUN/TURN beyond public STUN). Suitable for same-network demos; use TURN for WAN/CGNAT.
- **Two modes**: `wasm` for portability; `server` for heavier models and centralized tuning.
- **Backpressure**:
  - **WASM mode**: process only the **latest** frame (no queue). `requestAnimationFrame` naturally adapts to CPU.
  - **Server mode**: downscale to ~320px and JPEG quality ~0.6; only send a new frame if the WS is open; no client-side queue.
- **Frame alignment**: phone sends `(frame_id, capture_ts)` over WS at ~12.5 FPS; viewer uses nearest metadata for latency accounting.
- **Overlay**: drawn on a `<canvas>` sized to the remote `<video>` element.
- **Low-resource**: works on modest laptops (i5/8GB) with ~10–15 FPS at 320px.

---

## Modes & controls

- Toggle between **WASM** and **Server** from the Viewer: **"Toggle Inference"**.
- Start a 30s bench from UI or CLI (script). Metrics appear in `data/metrics.json`.

---

## Troubleshooting

- **Phone won’t connect**:
  - Ensure phone and laptop are on the **same Wi‑Fi** network
  - Check the phone URL in browser logs: `docker compose logs web`
  - Try manual IP: `HOST_IP=<your-ip> ./start.sh`
  - Use ngrok for remote access: `NGROK=1 ./start.sh --ngrok`
- **Camera permission denied**:
  - Modern browsers require HTTPS for camera access from remote hosts
  - Use `localhost` for testing or set up HTTPS/ngrok for remote access
  - Check browser console for detailed error messages
- **Overlays misaligned**: confirm timestamps are in **ms** and ensure phone metadata is flowing (WS events `phone:frame`).
- **High CPU**: keep input at **320px**, or use `MODE=wasm`; close extra tabs; prefer Chrome.
- **Model mismatch**: adjust the pre/postprocess in `viewer.js` and `infer_server.py` to your model’s I/O signature.
- **WebRTC stats**: open `chrome://webrtc-internals` to inspect RTP metrics.

---

## Loom video checklist (1 minute)

1. Show **phone → browser** live overlay on the Viewer.
2. Click **Start 30s Bench** → briefly show `data/metrics.json` in your editor.
3. State one-line improvement (e.g., “Add WebTransport + quantized YOLOv8n with WASM SIMD & threads for lower latency”).

---

## Appendix: How it works (architecture)

```
Phone (WebRTC getUserMedia) ──► Viewer (browser)
           │                         │
           │ (frame meta via WS)     │
           └────────────────────────► │
                                     │
 WASM mode:  onnxruntime-web in Viewer (320px) → overlay on canvas
 Server mode: Viewer → WS JPEG (320px) → Python ONNXRuntime → detections JSON → Viewer overlay
```

**Why WS to Python (server mode)?** Simpler than terminating WebRTC server-side (aiortc/mediasoup). The task only mandates WebRTC for phone → browser, which we satisfy; detections can return via WebSocket per the contract.

---

## Development notes

- This demo intentionally avoids bundlers (Vite/React) for reproducibility. The frontend is plain ES modules.
- If you prefer a model other than `yolov5n.onnx`, adjust I/O shapes in `preprocess/postprocess` paths.
- Add TURN (e.g., coturn) if you need robust NAT traversal.

