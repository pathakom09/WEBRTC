import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import bodyParser from 'body-parser';
import morgan from 'morgan';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import fs from 'fs';
import { networkInterfaces } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const MODE = process.env.MODE || 'wasm'; // 'wasm' | 'server'
const USE_HTTPS = process.env.HTTPS === '1';

// Function to get local network IP address
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost'; // fallback
}

const app = express();

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Create server (HTTP or HTTPS)
let server;
if (USE_HTTPS) {
  try {
    const certPath = path.join(__dirname, '../certs/server.crt');
    const keyPath = path.join(__dirname, '../certs/server.key');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };
      server = https.createServer(options, app);
      console.log('[web] HTTPS enabled');
    } else {
      console.log('[web] HTTPS requested but certificates not found, falling back to HTTP');
      console.log('[web] Run ./setup-https.sh to generate certificates');
      server = http.createServer(app);
    }
  } catch (error) {
    console.log('[web] HTTPS setup failed, falling back to HTTP:', error.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const wss = new WebSocketServer({ server });

app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({limit: '20mb'}));
app.use(bodyParser.urlencoded({extended: true}));

// Simple in-memory state
const rooms = new Map(); // roomId -> { clients: Set<ws>, roles: Map<ws,'viewer'|'phone'> }
const benchState = { active: false, duration: 30, mode: MODE };

// Static files
app.use('/', express.static(path.join(__dirname, '../web')));

// Health
app.get('/api/health', (_, res) => res.json({ ok: true, mode: MODE }));

// Create a room and return join URLs + QR
app.post('/api/room', async (req, res) => {
  console.log('[room] POST /api/room request received');
  const roomId = (req.body.roomId || uuidv4()).slice(0,8);
  if (!rooms.has(roomId)) rooms.set(roomId, { clients: new Set(), roles: new Map() });

  // Detect if request is coming through a tunnel (like localtunnel)
  const requestHost = req.get('host');
  const forwardedProto = req.get('x-forwarded-proto');
  const isTunnel = requestHost && (requestHost.includes('.loca.lt') || requestHost.includes('.ngrok.io')) || forwardedProto;

  let protocol, hostIP, port;
  if (isTunnel) {
    // Use tunnel URL with HTTPS (no port needed for tunnels)
    protocol = 'https';
    hostIP = requestHost;
    port = '';
    console.log(`[room] Tunnel detected: ${protocol}://${hostIP}`);
  } else {
    // Use configured settings
    protocol = USE_HTTPS ? 'https' : 'http';
    hostIP = process.env.HOST_IP || getLocalIP();
    port = `:${PORT}`;

    // If getLocalIP returns localhost, try using request host
    if (hostIP === 'localhost' && requestHost) {
      hostIP = requestHost.split(':')[0];
    }
  }

  const base = `${protocol}://${hostIP}${port}`;
  const viewerUrl = `${base}/?room=${roomId}`;
  const phoneUrl  = `${base}/phone.html?room=${roomId}`;
  const qrDataUrl = await QRCode.toDataURL(phoneUrl);

  console.log(`[room] Created room ${roomId} with phone URL: ${phoneUrl} (${isTunnel ? 'TUNNEL' : USE_HTTPS ? 'HTTPS' : 'HTTP'})`);
  res.json({ roomId, viewerUrl, phoneUrl, qrDataUrl, mode: MODE });
});

// Bench control
app.post('/api/bench/start', (req, res) => {
  const duration = Number(req.body.duration || 30);
  const mode = (req.body.mode || MODE);
  benchState.active = true;
  benchState.duration = duration;
  benchState.mode = mode;

  // Broadcast to all viewers in all rooms
  wss.clients.forEach(ws => {
    try { ws.send(JSON.stringify({ type: 'bench:start', duration, mode })); } catch {}
  });

  res.json({ ok: true, duration, mode });
});

// Receive metrics from browser; save to disk
app.post('/api/bench/finish', (req, res) => {
  const metrics = req.body || {};
  const outDir = path.join(__dirname, '../data');
  const outPath = path.join(outDir, 'metrics.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(metrics, null, 2));
  res.json({ ok: true, saved: '/data/metrics.json' });
});

// WebSocket signaling + event bus
wss.on('connection', (ws, req) => {
  let roomId = null;
  let role = null; // 'viewer' | 'phone' | 'other'

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'hello') {
        roomId = (data.roomId || '').slice(0,8);
        role = data.role || 'other';
        if (!rooms.has(roomId)) rooms.set(roomId, { clients: new Set(), roles: new Map() });
        const room = rooms.get(roomId);
        room.clients.add(ws);
        room.roles.set(ws, role);
        ws.send(JSON.stringify({ type: 'hello:ack', roomId, role, mode: MODE }));
        // Inform others
        room.clients.forEach(c => {
          if (c !== ws) try { c.send(JSON.stringify({ type: 'peer:join', role })); } catch {}
        });
      }
      // Plain signaling relay within a room
      else if (data.type === 'signal' && roomId) {
        const room = rooms.get(roomId);
        room.clients.forEach(c => {
          if (c !== ws) try { c.send(JSON.stringify({ type: 'signal', from: role, payload: data.payload })); } catch {}
        });
      }
      // Forward bench pings so viewer can compute bandwidth if desired
      else if (data.type === 'bench:ping' && roomId) {
        const room = rooms.get(roomId);
        room.clients.forEach(c => {
          if (c !== ws) try { c.send(JSON.stringify({ type: 'bench:pong', t: data.t })); } catch {}
        });
      }
      // Server-mode relay of detection JSON (optional if using WS to Python directly)
      else if (data.type === 'detections' && roomId) {
        const room = rooms.get(roomId);
        room.clients.forEach(c => {
          if (c !== ws) try { c.send(JSON.stringify({ type: 'detections', payload: data.payload })); } catch {}
        });
      }
    } catch (e) {
      console.error('WS message error', e);
    }
  });

  ws.on('close', () => {
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.clients.delete(ws);
      room.roles.delete(ws);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const protocol = USE_HTTPS ? 'https' : 'http';
  console.log(`[web] listening on ${protocol}://localhost:${PORT} (MODE=${MODE})`);
  console.log(`[web] Server bound to 0.0.0.0:${PORT} for Docker compatibility`);
  if (USE_HTTPS) {
    console.log(`[web] HTTPS enabled - camera access should work on mobile devices`);
  } else {
    console.log(`[web] HTTP mode - camera may require localhost or HTTPS for mobile devices`);
  }
});
