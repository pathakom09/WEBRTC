import { qs, getParam, sleep, now, median, p95, clamp01 } from './common.js';

// Settings
let MODE = (getParam('mode') || 'wasm'); // 'wasm' or 'server'
let roomId = (getParam('room') || '');

// UI
const logEl = qs('#log');
const vid = qs('#remoteVideo');
const canvas = qs('#overlay');
const ctx = canvas.getContext('2d');
const modeTag = qs('#modeTag');
const roomTag = qs('#roomTag');
const latencyEl = qs('#latency');
const serverLatencyEl = qs('#serverLatency');
const netLatencyEl = qs('#netLatency');
const fpsEl = qs('#fps');
const upkbpsEl = qs('#upkbps');
const downkbpsEl = qs('#downkbps');

function log(...args){ logEl.textContent = [logEl.textContent, args.join(' ')].filter(Boolean).join('\n').slice(-4000); }

async function initRoom(){
  // Request server to create room (or reuse given room)
  console.log('[viewer] Creating room...');
  try {
    const resp = await fetch('/api/room', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roomId }) });
    console.log('[viewer] Room API response status:', resp.status);
    const data = await resp.json();
    console.log('[viewer] Room data:', data);
    roomId = data.roomId;
    qs('#phoneUrl').textContent = data.phoneUrl; qs('#phoneUrl').href = data.phoneUrl;
    qs('#viewerUrl').textContent = data.viewerUrl; qs('#viewerUrl').href = data.viewerUrl;
    qs('#qr').src = data.qrDataUrl;
    modeTag.textContent = `MODE=${MODE}`;
    roomTag.textContent = `ROOM=${roomId}`;
    history.replaceState({}, '', `/?room=${roomId}&mode=${MODE}`);
    return data;
  } catch (error) {
    console.error('[viewer] Room creation error:', error);
    log(`Room creation failed: ${error.message}`);
    throw error;
  }
}

let ws;
function connectWS(){
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  // For tunnels (like ngrok, localtunnel), don't include port
  const isTunnel = window.location.hostname.includes('.ngrok.io') ||
                   window.location.hostname.includes('.loca.lt') ||
                   window.location.hostname.includes('.ngrok-free.app');

  let wsUrl;
  if (isTunnel) {
    wsUrl = `${wsProtocol}//${window.location.hostname}`;
  } else {
    wsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port}`;
  }

  console.log('[viewer] Connecting to WebSocket:', wsUrl, isTunnel ? '(tunnel)' : '(direct)');
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    console.log('[viewer] WebSocket connected');
    ws.send(JSON.stringify({ type:'hello', roomId, role:'viewer' }));
  };
  ws.onerror = (error) => {
    console.error('[viewer] WebSocket error:', error);
  };
  ws.onclose = () => {
    console.log('[viewer] WebSocket closed');
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'signal') {
      // viewer only consumes signals for remote track; it doesn't send
      // no-op here
    } else if (msg.type === 'detections') {
      // If server sends detection JSON (alternate path), handle it
      handleDetections(msg.payload);
    } else if (msg.type === 'bench:start') {
      startBench(msg.duration || 30, msg.mode || MODE);
    }
  };
}

let pc, dc;
async function createPeer(){
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  dc = pc.createDataChannel('viewer'); // for pings, optional

  pc.ontrack = (ev) => {
    console.log('[viewer] Received remote track:', ev.streams[0]);
    vid.srcObject = ev.streams[0];
    resizeCanvas();

    // Ensure video is playing for inference
    vid.onloadedmetadata = () => {
      console.log('[viewer] Video metadata loaded, dimensions:', vid.videoWidth, 'x', vid.videoHeight);
      // Set video properties for autoplay
      vid.muted = true;
      vid.playsInline = true;

      // Try to play immediately
      const playPromise = vid.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log('[viewer] Video playing automatically');
          // Hide play overlay if it exists
          const playOverlay = document.getElementById('playOverlay');
          if (playOverlay) playOverlay.style.display = 'none';
        }).catch(e => {
          console.log('[viewer] Video autoplay blocked, showing play button:', e.message);
          // Show play overlay
          const playOverlay = document.getElementById('playOverlay');
          if (playOverlay) {
            playOverlay.style.display = 'flex';
            playOverlay.onclick = () => {
              vid.play().then(() => {
                playOverlay.style.display = 'none';
                console.log('[viewer] Video started after user interaction');
              }).catch(e => console.error('[viewer] Video play error:', e));
            };
          }
        });
      }
    };
  };

  pc.onconnectionstatechange = () => {
    console.log('[viewer] Connection state:', pc.connectionState);
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[viewer] ICE connection state:', pc.iceConnectionState);
  };
  // signaling with WS
  ws.addEventListener('message', async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'signal' && msg.from === 'phone' && msg.payload) {
      if (msg.payload.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'signal', payload: { sdp: pc.localDescription } }));
      } else if (msg.payload.candidate) {
        try { await pc.addIceCandidate(msg.payload.candidate); } catch(e) { console.warn('addIceCandidate', e); }
      }
    }
  });
  pc.onicecandidate = (ev) => {
    if (ev.candidate) ws.send(JSON.stringify({ type:'signal', payload: { candidate: ev.candidate } }));
  };
}

function resizeCanvas(){
  canvas.width = vid.videoWidth;
  canvas.height = vid.videoHeight;
}

window.addEventListener('resize', resizeCanvas);
vid.addEventListener('loadedmetadata', resizeCanvas);

// ---- Inference paths ----
let ortSession = null;
async function ensureORT(){
  if (MODE !== 'wasm') {
    console.log('[viewer] Not in WASM mode, skipping ONNX Runtime');
    return;
  }

  console.log('[viewer] Ensuring ONNX Runtime...');

  // Load ONNX Runtime if not already loaded
  if (!window.ort) {
    console.log('[viewer] Loading ONNX Runtime Web...');
    try {
      // Create script tag to load ONNX Runtime
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js';
      script.async = true;

      const loadPromise = new Promise((resolve, reject) => {
        script.onload = () => {
          console.log('[viewer] ONNX Runtime script loaded');
          resolve();
        };
        script.onerror = (error) => {
          console.error('[viewer] Failed to load ONNX Runtime script:', error);
          reject(error);
        };
      });

      document.head.appendChild(script);
      await loadPromise;

      // Wait for the library to be available
      let attempts = 0;
      while (!window.ort && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        window.ort = window.ort || globalThis.ort;
        attempts++;
        console.log(`[viewer] Waiting for ONNX Runtime... attempt ${attempts}`);
      }

      if (window.ort) {
        log('ONNX Runtime Web loaded successfully');
        console.log('[viewer] ONNX Runtime object:', typeof window.ort, Object.keys(window.ort || {}));
      } else {
        throw new Error('ONNX Runtime not available after loading');
      }
    } catch (error) {
      console.error('[viewer] Failed to load ONNX Runtime:', error);
      log('Failed to load ONNX Runtime: ' + error.message);
      return false;
    }
  }

  if (!window.ort) {
    log('ONNX Runtime Web not available after loading');
    console.error('[viewer] window.ort is still undefined');
    return false;
  }

  // Create session if not already created
  if (!ortSession) {
    console.log('[viewer] Creating ONNX session...');
    try {
      window.ort.env.wasm.numThreads = 1;
      window.ort.env.wasm.simd = true;
      ortSession = await window.ort.InferenceSession.create('/models/yolov5n.onnx', {
        executionProviders: ['wasm']
      });
      log('ONNX Runtime Web session ready');
      console.log('[viewer] ONNX session created successfully');
      return true;
    } catch (error) {
      console.error('[viewer] Failed to create ONNX session:', error);
      log('Failed to load ONNX model: ' + error.message);
      return false;
    }
  }

  return true;
}

function preprocessToTensor(video, size=320){
  // Draw frame to an offscreen canvas, letterbox to square, normalize to [0,1]
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  const octx = off.getContext('2d');
  const scale = Math.min(size/video.videoWidth, size/video.videoHeight);
  const nw = Math.round(video.videoWidth*scale);
  const nh = Math.round(video.videoHeight*scale);
  const dx = Math.floor((size-nw)/2), dy = Math.floor((size-nh)/2);
  octx.drawImage(video, 0,0, video.videoWidth, video.videoHeight, dx, dy, nw, nh);
  const imgData = octx.getImageData(0,0,size,size);
  const data = imgData.data;
  const arr = new Float32Array(size*size*3);
  let p=0;
  for (let i=0;i<data.length;i+=4){
    arr[p++] = data[i]/255;     // R
    arr[p++] = data[i+1]/255;   // G
    arr[p++] = data[i+2]/255;   // B
  }
  // NHWC->NCHW
  if (!window.ort || typeof window.ort.Tensor !== 'function') {
    log('ONNX Runtime Web not loaded (preprocess)');
    return { tensor: null, dx, dy, scale, size };
  }
  const chw = new Float32Array(size*size*3);
  let c=0;
  for (let ch=0; ch<3; ch++){
    for (let y=0; y<size; y++){
      for (let x=0; x<size; x++){
        chw[c++] = arr[(y*size + x)*3 + ch];
      }
    }
  }
  const tensor = new window.ort.Tensor('float32', chw, [1,3,size,size]);
  return { tensor, dx, dy, scale, size };
}

// COCO class names for YOLOv5
const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
  "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush"
];

function postprocessYOLO(output, meta){
  // Expect YOLO output [1, N, 85] or [1, 84, S, S] etc. This is highly model-specific.
  // For demo, we parse boxes if output has shape [1,25200,85] style.

  // Debug the output structure (only log once)
  if (!window.onnxOutputLogged) {
    console.log('[viewer] ONNX output keys:', Object.keys(output));
    console.log('[viewer] ONNX output structure:', Object.keys(output).map(key => ({
      key,
      dims: output[key]?.dims,
      dataLength: output[key]?.data?.length
    })));
    window.onnxOutputLogged = true;
  }

  // Try to find the correct output tensor - usually 'output' or the largest one
  let outputTensor = null;
  if (output['output']) {
    outputTensor = output['output']; // Prefer 'output' if it exists
  } else {
    // Find the output with the most data (likely the main detection output)
    const outputKeys = Object.keys(output);
    let maxDataLength = 0;
    for (const key of outputKeys) {
      if (output[key]?.data?.length > maxDataLength) {
        maxDataLength = output[key].data.length;
        outputTensor = output[key];
      }
    }
  }

  if (!outputTensor || !outputTensor.data) {
    console.error('[viewer] Invalid ONNX output format:', output);
    return []; // Return empty detections
  }

  const logits = outputTensor.data; // Float32Array
  const dims = outputTensor.dims;
  const detections = [];

  console.log('[viewer] Processing output with dims:', dims, 'data length:', logits.length);

  // Handle different YOLO output formats
  let num, step;
  if (dims.length === 3 && dims[0] === 1) {
    // Format: [1, N, 85] - standard YOLO format
    num = dims[1];
    step = dims[2];
  } else if (dims.length === 2) {
    // Format: [N, 85] - flattened format
    num = dims[0];
    step = dims[1];
  } else {
    console.log('[viewer] Unexpected output format, dims:', dims);
    return [];
  }

  console.log('[viewer] Parsing', num, 'detections with step', step);

  for (let i = 0; i < num; i++) {
    const off = i * step;
    if (off + 4 >= logits.length) break; // Safety check

    const obj = logits[off + 4]; // Objectness score
    if (obj < 0.25) continue; // Lower threshold for testing
    // pick best class
    let bestC=-1, bestS=0;
    for (let c=5;c<step;c++){
      const s = logits[off+c];
      if (s>bestS){ bestS=s; bestC=c-5; }
    }
    const score = obj*bestS;
    if (score < 0.3) continue; // Lower threshold for better detection
    const cx = logits[off+0], cy = logits[off+1], w = logits[off+2], h = logits[off+3];
    const xmin = clamp01((cx - w/2 - meta.dx)/ (meta.size*meta.scale));
    const ymin = clamp01((cy - h/2 - meta.dy)/ (meta.size*meta.scale));
    const xmax = clamp01((cx + w/2 - meta.dx)/ (meta.size*meta.scale));
    const ymax = clamp01((cy + h/2 - meta.dy)/ (meta.size*meta.scale));
    const label = bestC < COCO_CLASSES.length ? COCO_CLASSES[bestC] : String(bestC);
    detections.push({ label, score, xmin, ymin, xmax, ymax });
  }

  if (detections.length > 0) {
    console.log('[viewer] Found', detections.length, 'detections:', detections.map(d => `${d.label}(${d.score.toFixed(2)})`));
  }

  return detections;
}

function drawDetections(dets){
  ctx.clearRect(0,0,canvas.width, canvas.height);

  dets.forEach(d => {
    const x = d.xmin*canvas.width, y = d.ymin*canvas.height;
    const w = (d.xmax-d.xmin)*canvas.width, h = (d.ymax-d.ymin)*canvas.height;

    // Professional color scheme for different objects
    const colors = {
      'person': '#FF6B6B',
      'car': '#4ECDC4',
      'truck': '#45B7D1',
      'bus': '#96CEB4',
      'motorcycle': '#FFEAA7',
      'bicycle': '#DDA0DD',
      'cell phone': '#FF8C42',
      'laptop': '#6C5CE7',
      'bottle': '#A8E6CF',
      'cup': '#FFB6C1',
      'default': '#00D2FF'
    };

    const color = colors[d.label] || colors.default;

    // Draw semi-transparent filled rectangle
    ctx.fillStyle = color + '25'; // 25 = ~15% opacity
    ctx.fillRect(x, y, w, h);

    // Draw professional border
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    // Enhanced label styling
    const text = `${d.label} ${(d.score*100).toFixed(0)}%`;
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const padding = 6;

    const labelX = x;
    const labelY = y > 25 ? y - 22 : y + h + 4;

    // Label background with rounded corners effect
    ctx.fillStyle = color + 'F0'; // F0 = ~94% opacity
    ctx.fillRect(labelX - 2, labelY - 2, textWidth + padding + 2, 18);

    // Label text with shadow effect
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, labelX + padding/2, labelY + 12);
  });
}

const stats = {
  e2e: [], server: [], net: [], frames: 0, displayed: 0, bytesUp: 0, bytesDown: 0, t0: now()
};
let benchActive = false;
let latestFrame = null;

function updateMetricsDisplay(){
  if (stats.e2e.length > 0) {
    latencyEl.textContent = `p50=${Math.round(median(stats.e2e))}, p95=${Math.round(p95(stats.e2e))}`;
  } else {
    latencyEl.textContent = 'No data';
  }

  if (stats.server.length > 0) {
    serverLatencyEl.textContent = `p50=${Math.round(median(stats.server))}, p95=${Math.round(p95(stats.server))}`;
  } else {
    serverLatencyEl.textContent = MODE === 'wasm' ? 'N/A (WASM mode)' : 'No data';
  }

  if (stats.net.length > 0) {
    netLatencyEl.textContent = `p50=${Math.round(median(stats.net))}, p95=${Math.round(p95(stats.net))}`;
  } else {
    netLatencyEl.textContent = 'No data';
  }

  const secs = Math.max(1, (now()-stats.t0)/1000);
  fpsEl.textContent = (stats.displayed/secs).toFixed(1);
  upkbpsEl.textContent = ((stats.bytesUp*8/1000)/secs).toFixed(1);
  downkbpsEl.textContent = ((stats.bytesDown*8/1000)/secs).toFixed(1);
}

function startBench(duration=30, mode=MODE){
  benchActive = true;
  stats.e2e = []; stats.server=[]; stats.net=[]; stats.frames=0; stats.displayed=0; stats.bytesUp=0; stats.bytesDown=0; stats.t0 = now();

  log(`Starting ${duration}s benchmark in ${mode.toUpperCase()} mode...`);

  // Update metrics display every second during bench
  const benchInterval = setInterval(() => {
    if (!benchActive) {
      clearInterval(benchInterval);
      return;
    }
    updateMetricsDisplay();
  }, 1000);

  setTimeout(async () => {
    benchActive = false;
    clearInterval(benchInterval);

    const metrics = {
      duration_sec: duration,
      mode,
      median_e2e_ms: Math.round(median(stats.e2e)),
      p95_e2e_ms: Math.round(p95(stats.e2e)),
      median_server_ms: Math.round(median(stats.server)),
      p95_server_ms: Math.round(p95(stats.server)),
      median_network_ms: Math.round(median(stats.net)),
      p95_network_ms: Math.round(p95(stats.net)),
      processed_fps: Number((stats.displayed/Math.max(1,(now()-stats.t0)/1000)).toFixed(2)),
      uplink_kbps: Number(((stats.bytesUp*8/1000)/Math.max(1,(now()-stats.t0)/1000)).toFixed(2)),
      downlink_kbps: Number(((stats.bytesDown*8/1000)/Math.max(1,(now()-stats.t0)/1000)).toFixed(2)),
      timestamp_ms: now()
    };
    await fetch('/api/bench/finish', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(metrics) });
    log('Bench finished. metrics.json saved on server.');
    log(`Final results: ${metrics.processed_fps} FPS, ${metrics.median_e2e_ms}ms latency`);
  }, duration*1000);
}

async function wasmLoop(){
  console.log('[viewer] Starting WASM inference loop...');
  const ortReady = await ensureORT();

  // Wait for ONNX Runtime to be fully loaded
  if (!ortReady || !window.ort || !ortSession) {
    console.log('[viewer] ONNX Runtime not ready, retrying in 2 seconds...');
    setTimeout(wasmLoop, 2000);
    return;
  }

  console.log('[viewer] ONNX Runtime ready, starting inference process');

  let consecutiveErrors = 0;
  const maxErrors = 10;

  const process = async () => {
    if (!vid.videoWidth) {
      // console.log('[viewer] Waiting for video dimensions...', vid.videoWidth, vid.videoHeight);
      // Add delay to prevent infinite loop
      setTimeout(() => requestAnimationFrame(process), 100);
      return;
    }

    // Double-check ONNX Runtime is still available
    if (!window.ort || !ortSession) {
      console.log('[viewer] ONNX Runtime lost, restarting...');
      setTimeout(wasmLoop, 1000);
      return;
    }

    const fid = (latestFrame?.frame_id ?? 0) + 1;
    const capture_ts = now();
    const t0 = performance.now();
    const meta = preprocessToTensor(vid, 320);
    if (!meta.tensor) {
      console.log('[viewer] Skipping inference: ONNX Runtime not loaded in preprocess');
      // Add delay to prevent infinite loop
      setTimeout(() => requestAnimationFrame(process), 100);
      return;
    }

    try {
      const out = await ortSession.run({ images: meta.tensor });
      const dets = postprocessYOLO(out, meta);
      const inf_ts = now();

      // For WASM mode, create proper timing data for metrics
      const payload = {
        frame_id: fid,
        capture_ts,
        recv_ts: capture_ts, // In WASM mode, no network delay
        inference_ts: inf_ts,
        detections: dets
      };

      if (dets.length > 0) {
        console.log('[viewer] Detected objects:', dets.length, dets.map(d => d.label));
      }

      handleDetections(payload);
    } catch (error) {
      console.error('[viewer] Inference error:', error);
      consecutiveErrors++;
      if (consecutiveErrors >= maxErrors) {
        console.error('[viewer] Too many consecutive errors, stopping inference loop');
        log('Object detection stopped due to repeated errors. Check console for details.');
        return;
      }
      // Add delay on error to prevent infinite loop
      setTimeout(() => requestAnimationFrame(process), 1000);
      return;
    }

    // Reset error counter on success
    consecutiveErrors = 0;
    requestAnimationFrame(process);
  };
  requestAnimationFrame(process);
}

let pyWS = null;
function serverConnect(){
  if (pyWS && pyWS.readyState === WebSocket.OPEN) return;

  // For tunnels (like ngrok), we need to use a different approach
  const isTunnel = window.location.hostname.includes('.ngrok.io') ||
                   window.location.hostname.includes('.loca.lt') ||
                   window.location.hostname.includes('.ngrok-free.app');

  let wsUrl;
  if (isTunnel) {
    // For tunnels, the Python server is not directly accessible
    // We'll need to proxy through the main server or disable server mode
    console.log('[server] Tunnel detected - server mode not available through tunnel');
    log('Server mode not available through tunnel. Use WASM mode instead.');
    return;
  } else {
    // Use Docker service name for backend connection when running locally
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'localhost:7000'
      : 'infer:7000';
    wsUrl = protocol + host;
  }

  console.log('[server] Connecting to:', wsUrl);
  pyWS = new WebSocket(wsUrl);
  pyWS.binaryType = 'arraybuffer';
  pyWS.onopen = () => log('[server] ws connected');
  pyWS.onmessage = (ev) => {
    stats.bytesDown += (typeof ev.data === 'string' ? ev.data.length : ev.data.byteLength || 0);
    try { const payload = JSON.parse(ev.data); handleDetections(payload); } catch{}
  };
  pyWS.onclose = () => setTimeout(serverConnect, 1000);
}

function encodeFrameBlob(video, size=320, quality=0.6){
  const off = document.createElement('canvas');
  off.width = size; off.height = Math.round(size*video.videoHeight/video.videoWidth);
  const octx = off.getContext('2d');
  octx.drawImage(video, 0,0, off.width, off.height);
  return new Promise(res => off.toBlob(b => res(b), 'image/jpeg', quality));
}

async function serverLoop(){
  serverConnect();
  const loop = async () => {
    if (!vid.videoWidth || !pyWS || pyWS.readyState !== WebSocket.OPEN) return requestAnimationFrame(loop);
    const frame_id = (latestFrame?.frame_id ?? 0) + 1;
    const capture_ts = latestFrame?.capture_ts || now(); // approximate if phone didn't send meta
    const jpeg = await encodeFrameBlob(vid, 320, 0.6);
    const header = JSON.stringify({ type:'frame', frame_id, capture_ts });
    const headerBytes = new TextEncoder().encode(header);
    const delim = new TextEncoder().encode('\n\n');
    const buf = new Uint8Array(headerBytes.length + delim.length + jpeg.size);
    buf.set(headerBytes, 0);
    buf.set(delim, headerBytes.length);
    const arrBuf = await jpeg.arrayBuffer();
    buf.set(new Uint8Array(arrBuf), headerBytes.length + delim.length);
    stats.bytesUp += buf.byteLength;
    if (pyWS && pyWS.readyState === WebSocket.OPEN) {
      pyWS.send(buf);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Phone -> viewer metadata channel (capture_ts per frame)
let phoneMetaWS = null;
function initMetaWS(){
  // Reuse same WS used for signaling; phone sends JSON with capture_ts/frame_id periodically (at 10-15 FPS)
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'phone:frame' && msg.payload) {
      latestFrame = msg.payload;
    }
  });
}

function handleDetections(payload){
  const { frame_id, capture_ts, recv_ts, inference_ts, detections } = payload;
  drawDetections(detections || []);
  const display_ts = now();

  // Always update stats for live metrics
  if (capture_ts) {
    stats.e2e.push(display_ts - capture_ts);
    if (recv_ts && inference_ts) {
      stats.server.push(inference_ts - recv_ts);
      stats.net.push(recv_ts - capture_ts);
    }
    stats.displayed++;

    // Keep only last 100 measurements for live display
    if (stats.e2e.length > 100) stats.e2e = stats.e2e.slice(-100);
    if (stats.server.length > 100) stats.server = stats.server.slice(-100);
    if (stats.net.length > 100) stats.net = stats.net.slice(-100);

    updateMetricsDisplay();
  }
}

async function main(){
  const info = await initRoom();

  // Check if we're using a tunnel
  const isTunnel = window.location.hostname.includes('.ngrok.io') ||
                   window.location.hostname.includes('.loca.lt') ||
                   window.location.hostname.includes('.ngrok-free.app');

  // Force WASM mode for tunnels since server mode won't work
  if (isTunnel && !((new URL(location.href)).searchParams.get('mode'))) {
    MODE = 'wasm';
    console.log('[viewer] Tunnel detected, forcing WASM mode');
    log('Using WASM mode (required for tunnel/mobile access)');
  } else {
    MODE = (new URL(location.href)).searchParams.get('mode') || info.mode || MODE;
  }

  modeTag.textContent = `MODE=${MODE}${isTunnel ? ' (Tunnel)' : ''}`;
  connectWS();
  await createPeer();
  initMetaWS();

  // Start live metrics update interval
  setInterval(updateMetricsDisplay, 1000);

  // Control buttons
  qs('#newRoom').onclick = async () => { await initRoom(); };
  qs('#startBench').onclick = async () => {
    fetch('/api/bench/start', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ duration: 30, mode: MODE }) });
  };
  let inferenceLoopId = null;
  function stopInferenceLoop() {
    if (inferenceLoopId) {
      cancelAnimationFrame(inferenceLoopId);
      inferenceLoopId = null;
    }
  }
  qs('#toggleInference').onclick = () => {
    stopInferenceLoop();

    // Check if we're using a tunnel
    const isTunnel = window.location.hostname.includes('.ngrok.io') ||
                     window.location.hostname.includes('.loca.lt') ||
                     window.location.hostname.includes('.ngrok-free.app');

    if (isTunnel && MODE === 'wasm') {
      log('Server mode not available through tunnel. Staying in WASM mode.');
      return;
    }

    MODE = (MODE === 'wasm') ? 'server' : 'wasm';
    modeTag.textContent = `MODE=${MODE}`;

    // Update URL to reflect mode change
    const url = new URL(location.href);
    url.searchParams.set('mode', MODE);
    history.replaceState({}, '', url.toString());

    log(`Switched to ${MODE.toUpperCase()} mode`);

    if (MODE === 'wasm') {
      inferenceLoopId = wasmLoop();
    } else {
      inferenceLoopId = serverLoop();
    }
  };
  qs('#clear').onclick = () => { ctx.clearRect(0,0,canvas.width, canvas.height); };

  console.log('[viewer] Starting inference in', MODE, 'mode');
  if (MODE === 'wasm') {
    console.log('[viewer] Starting WASM inference loop');
    inferenceLoopId = wasmLoop();
  } else {
    console.log('[viewer] Starting server inference loop');
    inferenceLoopId = serverLoop();
  }
}

main().catch(e => log('ERR', e));
