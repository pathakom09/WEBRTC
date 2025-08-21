import { qs, getParam, now, sleep } from './common.js';

const startBtn = qs('#start');
const video = qs('#localVideo');
const statusEl = qs('#status');

let roomId = getParam('room');
let ws, pc;

function connectWS(){
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  // For tunnels (like ngrok, localtunnel), don't include port
  const isTunnel = window.location.hostname.includes('.loca.lt') ||
                   window.location.hostname.includes('.ngrok.io') ||
                   window.location.hostname.includes('.ngrok-free.app');

  let wsUrl;
  if (isTunnel) {
    wsUrl = `${wsProtocol}//${window.location.hostname}`;
  } else {
    wsUrl = `${wsProtocol}//${window.location.hostname}:${window.location.port}`;
  }

  console.log('[phone] Connecting to WebSocket:', wsUrl, isTunnel ? '(tunnel)' : '(direct)');
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[phone] WebSocket connected');
    ws.send(JSON.stringify({ type:'hello', roomId, role:'phone' }));
  };
  ws.onerror = (error) => {
    console.error('[phone] WebSocket error:', error);
    statusEl.textContent = 'Connection error. Check network.';
  };
  ws.onclose = () => {
    console.log('[phone] WebSocket closed');
    statusEl.textContent = 'Connection lost. Refresh to retry.';
  };
}

async function publish(){
  try {
    statusEl.textContent = 'Checking camera support...';

    const browserInfo = {
      userAgent: navigator.userAgent,
      protocol: location.protocol,
      hostname: location.hostname,
      hasNavigator: !!navigator,
      hasMediaDevices: !!navigator.mediaDevices,
      hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      hasLegacyGetUserMedia: !!(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia)
    };
    console.log('[phone] Browser info:', browserInfo);

    // Also display on page for debugging
    statusEl.innerHTML = `<pre>Browser Info:\n${JSON.stringify(browserInfo, null, 2)}</pre>`;

    // Try to get getUserMedia from various sources
    let getUserMedia = null;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    } else if (navigator.getUserMedia) {
      getUserMedia = navigator.getUserMedia.bind(navigator);
    } else if (navigator.webkitGetUserMedia) {
      getUserMedia = navigator.webkitGetUserMedia.bind(navigator);
    } else if (navigator.mozGetUserMedia) {
      getUserMedia = navigator.mozGetUserMedia.bind(navigator);
    }

    if (!getUserMedia) {
      const currentUrl = `${location.protocol}//${location.hostname}:${location.port}`;
      throw new Error(`Camera API not supported. Current URL: ${currentUrl}. Browser: ${navigator.userAgent.substring(0, 50)}...`);
    }

    // For now, allow camera access on any URL for testing
    // Modern browsers will enforce their own security policies
    console.log('[phone] Allowing camera access for:', {
      protocol: location.protocol,
      hostname: location.hostname,
      url: location.href
    });

    statusEl.textContent = 'Requesting camera access...';

    const constraints = {
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    console.log('[phone] Requesting camera with constraints:', constraints);

    let stream;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } else {
      // Fallback for older browsers
      stream = await new Promise((resolve, reject) => {
        getUserMedia(constraints, resolve, reject);
      });
    }

    video.srcObject = stream;
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
  } catch (error) {
    console.error('[phone] Camera access error:', error);
    let errorMsg = error.message;

    // Provide more specific error messages
    if (error.name === 'NotAllowedError') {
      errorMsg = 'Camera permission denied. Please allow camera access and try again.';
    } else if (error.name === 'NotFoundError') {
      errorMsg = 'No camera found. Please check your device has a camera.';
    } else if (error.name === 'NotSupportedError') {
      errorMsg = 'Camera not supported. Try a different browser or device.';
    } else if (error.name === 'NotReadableError') {
      errorMsg = 'Camera is busy or unavailable. Close other apps using the camera.';
    }

    statusEl.innerHTML = `<div style="color: red;">Camera error: ${errorMsg}</div><pre>Debug info:\n${JSON.stringify({
      name: error.name,
      message: error.message,
      protocol: location.protocol,
      hostname: location.hostname,
      userAgent: navigator.userAgent.substring(0, 100)
    }, null, 2)}</pre>`;
    return;
  }

  pc.onicecandidate = (ev) => {
    if (ev.candidate && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type:'signal', payload:{ candidate: ev.candidate } }));
    } else if (ev.candidate) {
      console.log('[phone] WebSocket not ready, queuing ICE candidate');
    }
  };

  // handle remote signals from viewer
  ws.addEventListener('message', async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'signal' && msg.payload && msg.from === 'viewer') {
      if (msg.payload.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
      } else if (msg.payload.candidate) {
        try { await pc.addIceCandidate(msg.payload.candidate); } catch(e){}
      }
    }
  });

  // Create and send offer
  const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
  await pc.setLocalDescription(offer);

  // Wait for WebSocket to be ready before sending offer
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type:'signal', payload:{ sdp: pc.localDescription } }));
  } else {
    console.log('[phone] Waiting for WebSocket connection...');
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type:'signal', payload:{ sdp: pc.localDescription } }));
    }, { once: true });
  }

  statusEl.textContent = 'Publishing camera...';

  // Send frame metadata periodically for alignment
  let frame_id = 0;
  const sendMeta = () => {
    frame_id += 1;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type:'phone:frame', payload: { frame_id, capture_ts: Date.now() } }));
    }
    setTimeout(sendMeta, 80); // ~12.5 FPS meta
  };
  sendMeta();
}

// Check browser compatibility on page load
function checkBrowserSupport() {
  const warnings = [];

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    warnings.push('Camera API not supported');
  }

  if (!window.RTCPeerConnection) {
    warnings.push('WebRTC not supported');
  }

  const isSecure = location.protocol === 'https:' ||
                  location.hostname === 'localhost' ||
                  location.hostname === '127.0.0.1' ||
                  location.hostname.endsWith('.local');

  if (!isSecure) {
    warnings.push('HTTPS required for camera access');
  }

  if (warnings.length > 0) {
    const httpsUrl = `https://${location.hostname}:${location.port}${location.pathname}${location.search}`;
    statusEl.textContent = `⚠️ ${warnings.join(', ')}. Try: ${httpsUrl}`;
    statusEl.style.color = '#ff6b6b';
  } else {
    statusEl.textContent = 'Ready to start camera';
    statusEl.style.color = '#51cf66';
  }
}

startBtn.onclick = async () => {
  if (!roomId) {
    alert('Missing ?room=... in URL. Open from Viewer QR.');
    return;
  }
  try {
    connectWS();
    await publish();
  } catch (error) {
    console.error('[phone] Start error:', error);
    statusEl.textContent = `Error: ${error.message}`;
  }
};

// Run compatibility check when page loads
checkBrowserSupport();
