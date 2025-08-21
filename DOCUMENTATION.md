# WebRTC VLM Demo - Technical Documentation

## Overview
Real-time object detection system that streams video from mobile devices to web browsers using WebRTC, with live YOLO-based detection overlays.

## Architecture

```
Mobile Camera → WebRTC → Browser Viewer → Object Detection → Visual Overlay
                   ↓
              WebSocket Signaling
                   ↓
         [WASM Mode]     [Server Mode]
      Browser Inference  Python Server
```

## Core Components

### 1. Frontend (`web/`)
- **`index.html`**: Main viewer interface
- **`phone.html`**: Mobile camera capture page
- **`js/viewer.js`**: WebRTC handling, object detection, UI
- **`js/phone.js`**: Mobile camera streaming logic
- **`js/common.js`**: Shared utilities

### 2. Backend Services
- **`server/index.js`**: Node.js WebRTC signaling server
- **`server_py/infer_server.py`**: Python inference server (server mode)

### 3. Infrastructure
- **`docker-compose.yml`**: Container orchestration
- **`start.sh`**: One-command startup script
- **`bench/run_bench.sh`**: Performance benchmarking

## Processing Modes

### WASM Mode (Default)
- **Where**: Browser-side inference using ONNX Runtime Web
- **Model**: YOLOv5n ONNX model loaded in browser
- **Pros**: Works everywhere, no server load
- **Cons**: Higher client CPU usage
- **Use Case**: Mobile access, tunneled connections

### Server Mode
- **Where**: Python server-side inference
- **Model**: Same ONNX model, server processing
- **Pros**: Lower client CPU, centralized processing
- **Cons**: Requires direct network access
- **Use Case**: Local networks, high-performance scenarios

## Key Features

### Real-time Video Streaming
- **WebRTC**: Peer-to-peer video streaming
- **Low Latency**: Direct browser-to-browser connection
- **Cross-Platform**: Works on any modern browser

### Object Detection
- **Model**: YOLOv5n ONNX (80 COCO classes)
- **Input**: 320x320 downscaled frames
- **Output**: Bounding boxes with confidence scores
- **Visualization**: Color-coded boxes with labels

### Performance Monitoring
- **Metrics**: FPS, latency (p50/p95), bandwidth
- **Real-time**: Live metrics display
- **Benchmarking**: 30-second performance tests
- **Export**: JSON metrics output

## API Endpoints

### WebRTC Signaling
```
POST /api/room          # Create new room
GET  /api/room/:id      # Get room info
WS   /                  # WebRTC signaling
```

### Metrics
```
POST /api/bench/start   # Start benchmark
POST /api/bench/finish  # Submit metrics
```

### Server Mode (Python)
```
WS ws://localhost:7000  # Frame processing
```

## Configuration

### Environment Variables (`.env`)
```bash
HOST_IP=localhost    # Server host
PORT=3000           # Web server port
PY_PORT=7000        # Python server port
HTTPS=0             # Enable HTTPS
MODE=wasm           # Default mode
```

### Runtime Options
```bash
./start.sh                    # Default WASM mode
MODE=server ./start.sh        # Server mode
HTTPS=1 ./start.sh           # Enable HTTPS
./start.sh --ngrok           # Public tunnel
```

## Data Flow

### WASM Mode
1. **Mobile** captures video → **WebRTC** → **Browser**
2. **Browser** processes frames with **ONNX Runtime Web**
3. **Detections** overlaid on video canvas
4. **Metrics** collected and displayed

### Server Mode
1. **Mobile** captures video → **WebRTC** → **Browser**
2. **Browser** samples frames → **WebSocket** → **Python Server**
3. **Python** processes with **ONNX Runtime** → **JSON response**
4. **Browser** overlays detections and collects metrics

## Performance Characteristics

### Typical Performance
- **FPS**: 10-15 frames/second
- **Latency**: 50-100ms end-to-end
- **Resolution**: 320x320 processing, full display
- **CPU**: Moderate usage on modern devices

### Optimization Strategies
- **Frame Thinning**: Process latest frame only
- **Downscaling**: 320px for inference, full for display
- **Quality Control**: JPEG compression for server mode
- **Backpressure**: No queuing, real-time processing

## Troubleshooting

### Common Issues
- **Camera Access**: Use HTTPS or localhost
- **Network**: Ensure same WiFi or use ngrok
- **Performance**: Check CPU usage, close other apps
- **WebRTC**: Use Chrome for best compatibility

### Debug Tools
- **Browser Console**: Detailed logging
- **Chrome DevTools**: WebRTC internals
- **Docker Logs**: Server-side debugging
- **Metrics**: Performance monitoring

## Development

### Adding New Models
1. Convert model to ONNX format
2. Place in `web/models/`
3. Update preprocessing in `viewer.js`
4. Adjust postprocessing for output format

### Extending Detection
- Modify `postprocessYOLO()` for new classes
- Update color scheme in `drawDetections()`
- Add new object types to color mapping

### Custom Metrics
- Extend `stats` object in `viewer.js`
- Add new metric calculations
- Update display in `updateMetricsDisplay()`

## Deployment

### Local Development
```bash
git clone <repo>
./start.sh
```

### Production Considerations
- Use proper HTTPS certificates
- Configure TURN servers for NAT traversal
- Monitor resource usage
- Set up proper logging

### Scaling
- Load balance multiple inference servers
- Use Redis for session management
- Implement proper error handling
- Add monitoring and alerting

## Security

### Current Implementation
- Self-signed certificates for HTTPS
- No authentication required
- Local network access only

### Production Recommendations
- Implement user authentication
- Use valid SSL certificates
- Add rate limiting
- Secure WebSocket connections
- Validate all inputs

---

*This documentation covers the core technical aspects. For setup instructions, see README.md*
