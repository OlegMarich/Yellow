require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {exec} = require('child_process');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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
app.use(express.json({limit: '10mb'}));
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
// API
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
  res.json({url: ngrokUrl});
});

app.get('/api/server-info', (req, res) => {
  res.json({
    local: `http://${IP}:${PORT}`,
    https: ngrokUrl,
    env: process.env.NODE_ENV || 'development',
  });
});

// ---------------------------
// RUN-ALL API (with folder open)
// ---------------------------
app.post('/api/run-all', (req, res) => {
  const date = req.query.date;

  if (!date) {
    return res.json({success: false, message: 'No date provided'});
  }

  const cmd = `node run-all.js ${date} temp`;

  console.log('▶️ Running:', cmd);

  // Відповідаємо одразу, щоб браузер не зависав
  res.json({
    success: true,
    date,
    message: 'Generation started',
  });

  // Запускаємо run-all.js у фоновому режимі
  exec(cmd, {maxBuffer: 1024 * 1024 * 20}, (err, stdout, stderr) => {
    console.log('================ RUN-ALL OUTPUT ================');
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    if (err) {
      console.error('❌ run-all error:', err);
      return;
    }

    // Шукаємо дату завершення
    const match = stdout.match(/@@@DONE:(\d{4}-\d{2}-\d{2})/);
    const resultDate = match ? match[1] : date;

    // Формуємо шлях до папки
    const folderPath = path.join(outputDir, resultDate);

    console.log('📂 Opening folder:', folderPath);

    // Відкриваємо папку у Windows Explorer
    exec(`start "" "${folderPath}"`, (openErr) => {
      if (openErr) {
        console.error('❌ Error opening folder:', openErr);
      }
    });

    console.log('================================================');
  });
});

// ---------------------------
// START SERVER + NGROK
// ---------------------------
let server;
let ngrokListener;

// async function startNgrok() {
//   const token = process.env.NGROK_AUTHTOKEN;
//   if (!token) {
//     console.error('❌ NGROK_AUTHTOKEN is missing!');
//     return;
//   }

//   try {
//     const ngrok = await import('@ngrok/ngrok');

//     ngrokListener = await ngrok.forward({
//       addr: PORT,
//       authtoken: token,
//       region: 'eu',
//     });

//     ngrokUrl = ngrokListener.url();
//     console.log(`🔐 Public HTTPS (ngrok): ${ngrokUrl}`);
//   } catch (err) {
//     console.error('❌ NGROK ERROR, retry in 5s:', err.message);
//     setTimeout(startNgrok, 5000);
//   }
// }

async function startServer() {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log(`🚀 Local server: http://${IP}:${PORT}`);
    console.log(`🌐 LAN access: http://${IP}:${PORT}`);
    console.log('====================================');
  });

  //await startNgrok();
}

// ---------------------------
// GRACEFUL SHUTDOWN
// ---------------------------
async function shutdown() {
  console.log('\n🛑 Shutting down server...');

  if (ngrokListener) {
    try {
      await ngrokListener.close();
      console.log('✅ Ngrok closed');
    } catch (e) {
      console.error('⚠️ Failed to close ngrok');
    }
  }

  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------------------
// RUN
// ---------------------------
startServer();
