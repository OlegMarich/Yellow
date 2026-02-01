@echo off
title Logistics Platform Startup

echo 🟢 Запуск локального сервера...
start "" cmd /k "node server.js"

timeout /t 2 >nul

echo 🌐 Запуск ngrok тунелю...
start "" cmd /k "ngrok http 3000"

echo ⏳ Очікуємо запуск ngrok...
timeout /t 4 >nul

echo 🌐 Відкриваємо локальну версію в Google Chrome...
start "" chrome http://localhost:3000

echo ==========================================
echo ✔ Сервер і ngrok запущені
echo ✔ HTTPS доступ з'явиться у вікні ngrok
echo ==========================================

pause