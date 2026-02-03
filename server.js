const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3000;

// ---------------------------
// DIRECTORIES
// ---------------------------
const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');
const storageDir = path.join(__dirname, 'storage');
const publicDir = path.join(__dirname, 'public');

[inputDir, outputDir, storageDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
});

// ---------------------------
// MIDDLEWARE
// ---------------------------
app.use(express.json());
app.use('/storage', express.static(storageDir));
app.use('/output', express.static(outputDir));
app.use(express.static(publicDir));

// ---------------------------
// HELPERS
// ---------------------------
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const IP = getLocalIP();

// ---------------------------
// API: DEVICE PING
// ---------------------------
app.get('/api/device-ping', (req, res) => {
  res.json({ok: true, time: Date.now()});
});

// ---------------------------
// API: NGROK URL
// ---------------------------
let ngrokUrl = null;

app.get('/api/ngrok-url', (req, res) => {
  res.json({url: ngrokUrl});
});

// ---------------------------
// START SERVER + NGROK + AUTO-RECONNECT
// ---------------------------
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Local server: http://${IP}:${PORT}`);

  const token = process.env.NGROK_AUTHTOKEN;

  if (!token || token.trim() === "") {
    console.error("❌ NGROK ERROR: NGROK_AUTHTOKEN is not set.");
    return;
  }

  try {
    const ngrok = await import("@ngrok/ngrok");

    const listener = await ngrok.forward({
      addr: PORT,
      authtoken: token,
      region: "eu",
    });

    ngrokUrl = listener.url();
    console.log(`🔐 Public HTTPS (ngrok): ${ngrokUrl}`);

  } catch (err) {
    console.error("❌ NGROK ERROR:", err);
  }
});
