# 📱 Camera Access Fix - Complete Guide

## 🎯 **The Problem**
You're getting: `Camera error: Camera API not supported. Use HTTPS or a modern browser.`

**Root Cause**: Modern browsers require HTTPS for camera access when accessing from a remote IP address (like `192.168.1.14`).

## ✅ **The Solution: Use HTTPS**

### **Quick Fix (Windows):**
```cmd
set HTTPS=1
docker compose up --build -d
```

### **Quick Fix (Linux/Mac):**
```bash
HTTPS=1 ./start.sh
```

## 📋 **Step-by-Step Instructions:**

### **Step 1: Stop Current Application**
```cmd
docker compose down
```

### **Step 2: Generate HTTPS Certificates**
```bash
# If you have Git Bash or WSL
bash setup-https.sh

# Or manually generate (if you have OpenSSL)
mkdir certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost"
```

### **Step 3: Start with HTTPS**
```cmd
set HTTPS=1
docker compose up --build -d
```

### **Step 4: Open HTTPS URL**
1. Open: **https://localhost:3000**
2. **Accept the certificate warning** (click "Advanced" → "Proceed to localhost")
3. Click **"New Room"**
4. **Scan QR code** with your phone

### **Step 5: Accept Certificate on Phone**
1. **Before scanning QR**: Visit **https://192.168.1.14:3000** on your phone
2. **Accept the certificate warning**
3. **Then scan the QR code** - camera will work!

## 🔧 **Alternative Solutions:**

### **Option 1: Test on Localhost First**
```cmd
docker compose up --build -d
# Open http://localhost:3000/phone.html?room=test
# Click "Start Camera" - should work on localhost
```

### **Option 2: Use ngrok for Public HTTPS**
```cmd
set NGROK_AUTHTOKEN=your_token
set NGROK=1
docker compose up --build -d
```

## 🎯 **What URLs to Use:**

### **✅ These Work for Camera:**
- `https://localhost:3000` (with certificates)
- `https://192.168.1.14:3000` (with certificates)
- `http://localhost:3000` (localhost only)
- `http://127.0.0.1:3000` (localhost only)

### **❌ These DON'T Work for Camera:**
- `http://192.168.1.14:3000` (remote HTTP)
- `http://your-ip:3000` (any remote HTTP)

## 🔍 **Troubleshooting:**

### **Error: "Certificate not found"**
**Solution**: Run certificate generation:
```bash
bash setup-https.sh
# Or use the manual OpenSSL command above
```

### **Error: "Certificate not trusted"**
**Solution**: 
1. Click "Advanced" in browser
2. Click "Proceed to localhost (unsafe)"
3. Do this on both laptop and phone

### **Error: "Still getting HTTP URLs"**
**Solution**: Make sure HTTPS environment variable is set:
```cmd
echo %HTTPS%  # Should show "1"
set HTTPS=1   # If not set
docker compose down
docker compose up --build -d
```

### **Error: "Phone can't connect"**
**Solution**:
1. Ensure phone and laptop on same Wi-Fi
2. Visit HTTPS URL on phone first to accept certificate
3. Then scan QR code

## 🎉 **Success Indicators:**

### **✅ HTTPS Working:**
- Server logs show: `[web] HTTPS enabled`
- URLs start with `https://`
- Browser shows lock icon (even if "not secure")

### **✅ Camera Working:**
- Phone shows camera feed
- No "getUserMedia" errors in console
- Status shows "Publishing camera..."

## 📱 **Mobile Testing Steps:**

1. **Start with HTTPS**: `set HTTPS=1 & docker compose up --build -d`
2. **Open laptop**: https://localhost:3000
3. **Accept certificate** on laptop
4. **Create room**: Click "New Room"
5. **Open phone browser**: Visit https://192.168.1.14:3000
6. **Accept certificate** on phone
7. **Scan QR code**: Camera should work!

## 🚀 **Quick Commands:**

### **Start with HTTPS (Windows):**
```cmd
set HTTPS=1 & docker compose up --build -d
```

### **Start with HTTPS (Linux/Mac):**
```bash
HTTPS=1 ./start.sh
```

### **Check if HTTPS is working:**
```cmd
docker compose logs web | findstr HTTPS
```

### **Generate certificates manually:**
```bash
mkdir certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost"
```

## 💡 **Pro Tips:**

1. **Always use HTTPS for mobile camera access**
2. **Accept certificates on both laptop and phone**
3. **Test localhost first** to verify camera works
4. **Check browser console** for detailed error messages
5. **Use Chrome/Safari** for best compatibility

**The camera will work once you use HTTPS! 🎉**
