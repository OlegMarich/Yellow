@echo off
title Logistics Platform Startup

echo 🟢 Запуск сервера (Node.js + ngrok)...
cd /d "%~dp0"

start "" cmd /k "node server.js"

timeout /t 3 >nul

echo 🌐 Відкриваємо сервер у браузері...
start "" chrome http://localhost:3000

echo ==========================================
echo ✔ Сервер запущений
echo ✔ ngrok запускається всередині Node.js
echo ✔ Public HTTPS дивись у консолі сервера
echo ==========================================

pause
