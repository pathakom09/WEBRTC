#!/usr/bin/env bash
# Script to set up HTTPS for local development

set -euo pipefail

CERT_DIR="./certs"
DOMAIN="${1:-localhost}"

echo "Setting up HTTPS certificates for domain: $DOMAIN"

# Create certs directory
mkdir -p "$CERT_DIR"

# Generate self-signed certificate
if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
    echo "Generating self-signed certificate..."
    
    # Create a config file for the certificate
    cat > "$CERT_DIR/cert.conf" << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = Local
L = Local
O = WebRTC VLM Demo
CN = $DOMAIN

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = localhost
DNS.3 = *.local
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

    # Generate private key and certificate
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/server.key" \
        -out "$CERT_DIR/server.crt" \
        -config "$CERT_DIR/cert.conf" \
        -extensions v3_req

    echo "✅ Certificate generated successfully!"
else
    echo "✅ Certificate already exists"
fi

echo ""
echo "📋 Next steps:"
echo "1. Trust the certificate in your browser:"
echo "   - Open https://$DOMAIN:3000 in your browser"
echo "   - Click 'Advanced' -> 'Proceed to $DOMAIN (unsafe)'"
echo "   - Or add the certificate to your system's trusted certificates"
echo ""
echo "2. Start the application with HTTPS:"
echo "   HTTPS=1 ./start.sh"
echo ""
echo "3. On mobile, you may need to:"
echo "   - Visit https://$DOMAIN:3000 first to accept the certificate"
echo "   - Then scan the QR code"
echo ""
echo "Certificate files created in: $CERT_DIR/"
echo "- server.crt (certificate)"
echo "- server.key (private key)"
