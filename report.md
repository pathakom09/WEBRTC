
# Design Report (1 page)

**Goal.** Real-time multi-object detection for phone → browser via WebRTC, with overlays in near real-time and reproducible metrics.

## Architecture & Tradeoffs
- **Transport**: Phone camera uses **WebRTC** directly into the Viewer (browser). Chosen for low-latency RTP and native phone support (Chrome/Safari).
- **Signaling**: Minimal **WebSocket** relay in Node — trivial to run under Docker; avoids external dependencies.
- **Inference placement**:
  - **WASM mode (default)**: `onnxruntime-web` in the viewer browser. Pros: no server GPU/CPU required; lowest dependency footprint. Cons: constrained by JS/WASM perf; needs compact models.
  - **Server mode**: Viewer samples frames to **Python ONNXRuntime** over WebSocket. Pros: flexible models, central optimization. Cons: extra encode/decode hop; slightly higher latency.
- **Model**: small ONNX detector (e.g., YOLOv5n quantized). Shapes differ by export — code includes simple pre/post stubs that you should adapt to your exact model.

## Low-resource Path
- Downscale to **~320px**.
- Target **10–15 FPS**.
- WASM backend with **SIMD**; single thread to minimize contention.
- Frame thinning: **latest-frame-only** (discard backlog).
- JPEG quality ~0.6 in server mode to balance bandwidth vs. artifacts.

## Backpressure Policy
- **WASM**: processing loop uses `requestAnimationFrame`; CPU saturation naturally reduces rate. No queues.
- **Server**: don't enqueue — send one frame per RAF; if WS not open, skip. This bounds memory and latency.

## Metrics
- **E2E**: `overlay_display_ts - capture_ts`.
- **Server**: `inference_ts - recv_ts` (from Python).
- **Network**: `recv_ts - capture_ts`.
- **FPS**: displayed frames / seconds.
- **Bandwidth**: byte counters in viewer for WS path; WebRTC RTP kbps can be derived from `getStats()` if needed.

## Next Improvement (one-liner)
Switch JPEG-over-WS to **WebCodecs + WebTransport**, add **INT8-quantized YOLOv8n** with **WASM SIMD+threads**, and a simple **coturn** for robust NAT traversal.

