# WebRTC VLM Demo - Troubleshooting Guide

## 📱 Phone Camera Issues

### Problem: "Camera error: Cannot read properties of undefined (reading 'getUserMedia')"

**Cause**: The browser doesn't support the Media Devices API or you're accessing over HTTP from a remote host.

**Solutions**:

1. **Use HTTPS for remote access**:
   ```bash
   # Generate self-signed certificates
   ./setup-https.sh
   
   # Start with HTTPS
   HTTPS=1 ./start.sh
   ```

2. **Use localhost for testing**:
   - Access `http://localhost:3000` directly on the same machine
   - This bypasses HTTPS requirements for camera access

3. **Check browser support**:
   - Use Chrome, Firefox, Safari, or Edge (modern versions)
   - Avoid older browsers or embedded webviews

### Problem: "Camera requires HTTPS for remote access"

**Cause**: Modern browsers require HTTPS for camera access when not on localhost.

**Solutions**:

1. **Set up HTTPS locally**:
   ```bash
   ./setup-https.sh your-local-ip
   HTTPS=1 HOST_IP=your-local-ip ./start.sh
   ```

2. **Use ngrok for public HTTPS**:
   ```bash
   NGROK=1 NGROK_AUTHTOKEN=your-token ./start.sh --ngrok
   ```

3. **Test on localhost first**:
   - Open `http://localhost:3000` on your laptop
   - Click "New Room" and test the phone URL locally

### Problem: Camera permission denied

**Solutions**:
- Click "Allow" when prompted for camera access
- Check browser settings: Settings > Privacy > Camera
- Clear browser data and try again
- Try a different browser

## 🌐 Network Connection Issues

### Problem: Phone can't reach the laptop

**Check same Wi-Fi**:
- Ensure phone and laptop are on the same network
- Check if devices can ping each other

**Find your IP address**:
```bash
./get-ip.sh  # Shows detected IP addresses
```

**Manual IP override**:
```bash
HOST_IP=192.168.1.100 ./start.sh  # Replace with your actual IP
```

**Check firewall**:
- Windows: Allow port 3000 through Windows Firewall
- macOS: System Preferences > Security & Privacy > Firewall
- Linux: `sudo ufw allow 3000`

### Problem: QR code shows "undefined" in URL

**Cause**: IP detection failed.

**Solutions**:
1. Set IP manually: `HOST_IP=your-ip ./start.sh`
2. Check Docker networking: `docker network ls`
3. Restart Docker and try again

## 🔧 Application Issues

### Problem: WebSocket connection failed

**Check logs**:
```bash
docker compose logs web
```

**Common fixes**:
- Restart the application: `docker compose restart`
- Check port availability: `netstat -an | grep 3000`
- Try different port: `PORT=3001 ./start.sh`

### Problem: Video not showing

**Check WebRTC connection**:
- Open `chrome://webrtc-internals` in Chrome
- Look for connection state and ICE candidates
- Check if STUN server is reachable

**Firewall issues**:
- WebRTC may need additional ports for media
- Try disabling firewall temporarily for testing

## 🐛 Development Issues

### Problem: Docker build fails

**Clear Docker cache**:
```bash
docker system prune -a
docker compose build --no-cache
```

**Check disk space**:
```bash
docker system df
```

### Problem: Model not found

**Download model**:
```bash
# For WASM mode
wget -O web/models/yolov5n.onnx https://github.com/ultralytics/yolov5/releases/download/v6.0/yolov5n.onnx

# Check model exists
ls -la web/models/
```

## 📊 Performance Issues

### Problem: High CPU usage

**Solutions**:
- Use WASM mode: `MODE=wasm ./start.sh`
- Reduce input resolution in code (320px default)
- Close other browser tabs
- Use Chrome for better performance

### Problem: Low FPS

**Check**:
- Network bandwidth between devices
- CPU usage on both devices
- Browser performance (try Chrome)

## 🔍 Debugging Tips

### Enable verbose logging

**Browser console**:
- Open Developer Tools (F12)
- Check Console tab for errors
- Look for WebRTC and camera errors

**Server logs**:
```bash
docker compose logs -f web    # Follow web server logs
docker compose logs -f infer  # Follow inference server logs
```

### Test components individually

1. **Test camera locally**:
   - Open `http://localhost:3000/phone.html?room=test`
   - Click "Start Camera" to test camera access

2. **Test WebSocket**:
   - Check browser Network tab for WebSocket connections
   - Look for connection errors or timeouts

3. **Test inference**:
   - Switch between WASM and server modes
   - Check if detections appear in browser console

### Common error patterns

- `getUserMedia` errors → Camera/HTTPS issues
- WebSocket errors → Network/firewall issues  
- CORS errors → Server configuration issues
- Model loading errors → File path/download issues

## 📞 Getting Help

If you're still having issues:

1. **Check the logs**:
   ```bash
   docker compose logs web > debug.log
   ```

2. **Test with localhost first** before trying remote access

3. **Try HTTPS setup** if camera access fails

4. **Check browser compatibility** - use Chrome for best results

5. **Verify network connectivity** between devices
