require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {exec} = require('child_process');
const multer = require('multer');

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
const uploadsDir = path.join(__dirname, 'uploads');

[inputDir, outputDir, storageDir, tempRoot, uploadsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
});

// ---------------------------
// MULTER STORAGE (унікальні імена)
// ---------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({storage});

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
const LAN_URL = `http://${IP}:${PORT}`;

// ---------------------------
// STATIC
// ---------------------------
app.use(express.json({limit: '10mb'}));
app.use('/storage', express.static(storageDir));
app.use('/output', express.static(outputDir));
app.use(express.static(publicDir));

// ======================================================
//  DEVICE PING + SERVER INFO (для scanner.js)
// ======================================================
app.get('/api/device-ping', (req, res) => {
  res.json({
    ok: true,
    serverTime: Date.now(),
    time: new Date().toISOString(),
  });
});

app.get('/api/server-info', (req, res) => {
  res.json({
    status: 'running',
    ip: IP,
    port: PORT,
    tempRoot,
    time: new Date().toISOString(),
    lanUrl: LAN_URL,
    local: LAN_URL,
  });
});

// ======================================================
//  LIST WEEK FILES — /api/list-week
// ======================================================
app.get('/api/list-week', (req, res) => {
  const week = req.query.week;
  if (!week) return res.json([]);

  const dir = path.join(storageDir, week);

  if (!fs.existsSync(dir)) {
    return res.json([]);
  }

  try {
    const files = fs.readdirSync(dir);
    res.json(files);
  } catch (err) {
    console.error('list-week error:', err);
    res.json([]);
  }
});

// ======================================================
//  DAILY REPORTS — /api/run-all
// ======================================================
app.post('/api/run-all', upload.single('file'), (req, res) => {
  try {
    const date = req.query.date;

    if (!date) {
      return res.json({success: false, message: 'No date provided'});
    }

    if (!req.file) {
      return res.json({success: false, message: 'No file uploaded'});
    }

    const week = getISOWeek(date);

    const tempDir = path.join(tempRoot, week);
    fs.mkdirSync(tempDir, {recursive: true});

    console.log('📁 Temp directory:', tempDir);

    const [year, month, day] = date.split('-');
    const fileName = `${day}.${month}_transportPlan.xlsx`;

    const targetPath = path.join(tempDir, fileName);

    fs.renameSync(req.file.path, targetPath);
    console.log(`📄 Saved ${fileName}`);

    const cmd = `node run-all.js ${date} "${tempDir}"`;

    res.json({
      success: true,
      date,
      week,
      message: 'Generation started',
    });

    exec(cmd, {maxBuffer: 1024 * 1024 * 20}, (err, stdout, stderr) => {
      console.log('================ RUN-ALL OUTPUT ================');
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      if (err) console.error('❌ run-all error:', err);
      console.log('================================================');
    });
  } catch (err) {
    console.error('❌ SERVER ERROR:', err);
    res.status(500).json({success: false, message: 'Internal server error'});
  }
});

// ======================================================
//  WEEKLY PLAN — /upload-plan
// ======================================================
app.post('/upload-plan', upload.array('files'), (req, res) => {
  try {
    const week = req.query.week;

    if (!week) {
      return res.json({success: false, message: 'No week provided'});
    }

    const tempDir = path.join(tempRoot, `week${week}`);
    fs.mkdirSync(tempDir, {recursive: true});

    console.log('📁 Temp directory:', tempDir);

    for (const file of req.files) {
      const name = file.originalname.toLowerCase();

      if (name.includes('sales')) {
        const dest = path.join(tempDir, 'salesPlan.xlsx');

        try {
          fs.copyFileSync(file.path, dest);
          fs.unlinkSync(file.path);

          console.log('📄 Saved salesPlan.xlsx');
        } catch (err) {
          console.error('❌ SERVER ERROR (copy/move failed):', err);
          return res.status(500).json({
            success: false,
            message: 'Failed to move uploaded file',
          });
        }
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
      if (err) console.error('❌ generate-plan error:', err);
      console.log('=============================================');
    });
  } catch (err) {
    console.error('❌ SERVER ERROR:', err);
    res.status(500).json({success: false, message: 'Internal server error'});
  }
});

// ======================================================
//  SALES REPORT PAGE + DATA
// ======================================================
app.get('/output/:week', (req, res) => {
  const week = req.params.week;
  res.redirect(`/components/sales-report.html?week=${week}`);
});

app.get('/api/sales-data', (req, res) => {
  const week = req.query.week;
  if (!week) return res.json({ok: false, error: 'No week provided'});

  const jsonPath = path.join(storageDir, week, `${week}_salesPlan.json`);

  if (!fs.existsSync(jsonPath)) {
    return res.status(404).json({ok: false, error: 'JSON not found'});
  }

  const data = fs.readFileSync(jsonPath, 'utf8');
  res.json(JSON.parse(data));
});

// ======================================================
//  TRANSPORT REPORT PAGE + DATA
// ======================================================
app.get('/report/day/:date', (req, res) => {
  const date = req.params.date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).send('Invalid date format');
  }

  res.redirect(`/components/transport-report.html?date=${date}`);
});

app.get('/api/transport-data', (req, res) => {
  const date = req.query.date;

  if (!date) return res.json({ok: false, error: 'No date provided'});

  const [year, month, day] = date.split('-');
  const week = getISOWeek(date);
  const fileName = `${day}.${month}_transportPlanData.json`;

  const jsonPath = path.join(storageDir, week, fileName);

  if (!fs.existsSync(jsonPath)) {
    return res.status(404).json({ok: false, error: 'Not found'});
  }

  const data = fs.readFileSync(jsonPath, 'utf8');
  res.json(JSON.parse(data));
});

// ======================================================
//  SAVE SCAN RESULT — /api/save-scan-result
// ======================================================
app.post('/api/save-scan-result', (req, res) => {
  try {
    console.log('SCAN RESULT BODY:', req.body);
    const {client, date, boxCounts, totalBoxes, boxesPerPallet, totalPallets} = req.body;

    if (!client || !date || !boxCounts) {
      return res.status(400).json({ok: false, error: 'Missing fields'});
    }

    // --- NEW: визначаємо тиждень
    const week = getISOWeek(date); // наприклад "week07"

    // --- NEW: шлях storage/weekX/date/
    const resultsDir = path.join(storageDir, week, date);
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, {recursive: true});
    }

    // клієнт у безпечному форматі
    const safeClient = client.replace(/[^a-z0-9_-]/gi, '_');

    // ім'я файлу
    const fileName = `${safeClient}.json`; // можна додати дату, якщо хочеш
    const filePath = path.join(resultsDir, fileName);

    const payload = {
      client,
      date,
      boxCounts,
      totalBoxes,
      boxesPerPallet,
      totalPallets,
      savedAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

    return res.json({ok: true, file: filePath});
  } catch (err) {
    console.error('❌ save-scan-result error:', err);
    return res.status(500).json({ok: false, error: 'Server error'});
  }
});

// ======================================================
//  RUN FILL-TEMPLATE — /api/run-fill-template
// ======================================================
app.post('/api/run-fill-template', (req, res) => {
  try {
    const {date} = req.body;

    if (!date) {
      return res.json({ok: false, error: 'Missing date'});
    }

    const scriptPath = path.join(__dirname, 'fill-template-client.js');
    const cmd = `node "${scriptPath}" ${date}`;

    console.log('▶ Running fill-template-client.js:', cmd);

    exec(cmd, {maxBuffer: 1024 * 1024 * 20}, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ fill-template error:', err);
        return res.json({ok: false, error: 'Script failed'});
      }

      console.log('📄 fill-template output:', stdout);
      return res.json({ok: true, output: stdout});
    });
  } catch (err) {
    console.error('❌ run-fill-template error:', err);
    return res.status(500).json({ok: false, error: 'Server error'});
  }
});
// ---------------------------
// START SERVER
// ---------------------------
let server;

async function startServer() {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log(`🚀 Local server: http://localhost:${PORT}`);
    console.log(`🌐 LAN access: ${LAN_URL}`);
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
