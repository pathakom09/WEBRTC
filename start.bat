@echo off
setlocal

REM Set default values
if "%MODE%"=="" set MODE=wasm
if "%NGROK%"=="" set NGROK=0
if "%HTTPS%"=="" set HTTPS=0

echo [start] MODE=%MODE%

if "%HTTPS%"=="1" (
    echo [start] HTTPS enabled
    if not exist ".\certs\server.crt" (
        echo [start] HTTPS certificates not found. Please run: bash setup-https.sh
        echo [start] Or use Git Bash to run: ./setup-https.sh
        pause
        exit /b 1
    )
)

docker compose up --build -d

if "%HTTPS%"=="1" (
    echo [start] Open https://localhost:3000 then click 'New Room' to get a QR for your phone.
    echo [start] Camera access will work on mobile devices with HTTPS.
) else (
    echo [start] Open http://localhost:3000 then click 'New Room' to get a QR for your phone.
    echo [start] For mobile camera access, use: set HTTPS=1 ^& start.bat
)

if "%MODE%"=="server" (
    echo [start] Ensure a model exists at web/models/yolov5n.onnx (see README for download).
)

if "%NGROK%"=="1" (
    if "%NGROK_AUTHTOKEN%"=="" (
        echo Set NGROK_AUTHTOKEN to use ngrok.
        exit /b 1
    )
    docker run --rm -it -e NGROK_AUTHTOKEN -p 4040:4040 ngrok/ngrok:3 http --domain=auto 3000
)

endlocal
