require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const multer = require('multer');

const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ---------------------------
// DIRECTORIES
// ---------------------------
const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');
const storageDir = path.join(__dirname, 'storage');
const publicDir = path.join(__dirname, 'public');
const tempRoot = path.join(__dirname, 'temp');

[inputDir, outputDir, storageDir, tempRoot].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ---------------------------
// MIDDLEWARE
// ---------------------------
app.use(express.json({ limit: '10mb' }));
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

function getISOWeek(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return `week${Math.floor((d - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1}`;
}

const IP = getLocalIP();

// ---------------------------
// API: INFO
// ---------------------------
let ngrokUrl = null;

app.get('/api/device-ping', (req, res) => {
  res.json({
    ok: true,
    serverTime: Date.now(),
    serverIP: IP,
  });
});

app.get('/api/ngrok-url', (req, res) => {
  res.json({ url: ngrokUrl });
});

app.get('/api/server-info', (req, res) => {
  res.json({
    local: `http://${IP}:${PORT}`,
    https: ngrokUrl,
    env: process.env.NODE_ENV || 'development',
  });
});

// ======================================================
//  REPORT MODE — DAILY REPORTS (run-all.js)
// ======================================================
app.post('/api/run-all', upload.array('files'), (req, res) => {
  const date = req.query.date;

  if (!date) {
    return res.json({ success: false, message: 'No date provided' });
  }

  // 1) Визначаємо тиждень
  const week = getISOWeek(date);

  // 2) Створюємо temp/weekX
  const tempDir = path.join(tempRoot, week);
  fs.mkdirSync(tempDir, { recursive: true });

  console.log("📁 Temp directory:", tempDir);

  // 3) Формуємо ім'я файлу: DD.MM_transportPlan.xlsx
  const [year, month, day] = date.split('-');
  const fileName = `${day}.${month}_transportPlan.xlsx`;

  // 4) Перейменовуємо файл
  for (const file of req.files) {
    fs.renameSync(file.path, path.join(tempDir, fileName));
    console.log(`📄 Saved ${fileName}`);
  }

  // 5) Запускаємо run-all.js
  const cmd = `node run-all.js ${date} "${tempDir}"`;

  res.json({
    success: true,
    date,
    week,
    message: 'Generation started',
  });

  exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
    console.log('================ RUN-ALL OUTPUT ================');
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    if (err) {
      console.error('❌ run-all error:', err);
      return;
    }

    console.log('================================================');
  });
});

// ======================================================
//  PLAN MODE — WEEKLY PLAN (generate-plan.js)
// ======================================================
app.post('/upload-plan', upload.array('files'), (req, res) => {
  const week = req.query.week;

  if (!week) {
    return res.json({ success: false, message: 'No week provided' });
  }

  const tempDir = path.join(tempRoot, `week${week}`);
  fs.mkdirSync(tempDir, { recursive: true });

  console.log('📁 Temp directory:', tempDir);

  // Перейменування файлів
  for (const file of req.files) {
    const name = file.originalname.toLowerCase();

    if (name.includes('sales')) {
      fs.renameSync(file.path, path.join(tempDir, 'salesPlan.xlsx'));
      console.log('📄 Saved salesPlan.xlsx');
    }
  }

  const cmd = `node generate-plan.js ${week} "${tempDir}"`;

  res.json({
    success: true,
    week,
    message: 'Plan generation started',
  });

  exec(cmd, (err, stdout, stderr) => {
    console.log('================ PLAN OUTPUT ================');
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    if (err) {
      console.error('❌ generate-plan error:', err);
      return;
    }

    console.log('=============================================');
  });
});

// ---------------------------
// START SERVER
// ---------------------------
let server;

async function startServer() {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log(`🚀 Local server: http://${IP}:${PORT}`);
    console.log(`🌐 LAN access: http://${IP}:${PORT}`);
    console.log('====================================');
  });
}

async function shutdown() {
  console.log('\n🛑 Shutting down server...');

  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();