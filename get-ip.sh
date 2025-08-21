#!/usr/bin/env bash
# Script to get the local IP address for HOST_IP environment variable

echo "Detecting local IP addresses..."
echo ""

# Try different methods to get local IP
if command -v ip &> /dev/null; then
    echo "Using 'ip' command:"
    ip route get 1.1.1.1 | grep -oP 'src \K\S+' 2>/dev/null || echo "  Could not detect IP with 'ip' command"
    echo ""
fi

if command -v ifconfig &> /dev/null; then
    echo "Using 'ifconfig' command:"
    ifconfig | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1
    echo ""
fi

# For Windows (PowerShell)
if command -v powershell.exe &> /dev/null; then
    echo "Using PowerShell (Windows):"
    powershell.exe -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*','Ethernet*' | Where-Object {$_.IPAddress -ne '127.0.0.1'}).IPAddress" 2>/dev/null | head -1
    echo ""
fi

echo "To use a specific IP address, run:"
echo "  HOST_IP=<your-ip> ./start.sh"
echo ""
echo "For example:"
echo "  HOST_IP=192.168.1.100 ./start.sh"
