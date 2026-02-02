const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {exec} = require('child_process');
const os = require('os');

const app = express();
const PORT = 3000;

// ---------------------------
// DIRECTORIES
// ---------------------------
const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');
const publicDir = path.join(__dirname, 'public');
const storageDir = path.join(__dirname, 'storage');

app.use('/storage', express.static(storageDir));
app.use(express.static(publicDir));
app.use('/output', express.static(outputDir));
app.use(express.json());

// ---------------------------
// MULTER
// ---------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, inputDir),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({storage});

// ---------------------------
// HELPERS
// ---------------------------
function getISOWeek(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return `week${Math.floor((date - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1}`;
}

// ---------------------------
// API: SAVE SCAN RESULT
// ---------------------------
app.post('/api/save-scan-result', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');

    const {client, date, boxCounts, totalBoxes, boxesPerPallet, totalPallets} = req.body;

    // Папка для збереження
    const folder = path.join(__dirname, 'storage', 'scan-results');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, {recursive: true});

    // Формуємо ім'я файлу
    const safeClient = client.replace(/[^a-z0-9]/gi, '_');
    const fileName = `${date}_${safeClient}.json`;
    const filePath = path.join(folder, fileName);

    // Дані для збереження
    const data = {
      client,
      date,
      totalBoxes,
      boxesPerPallet,
      totalPallets,
      boxCounts,
      savedAt: new Date().toISOString(),
    };

    // Запис у файл
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

    res.json({ok: true, file: fileName});
  } catch (err) {
    console.error(err);
    res.json({ok: false, error: err.message});
  }
});

const {exec} = require('child_process');
const path = require('path');

app.post('/api/run-post-scan', async (req, res) => {
  const {date, client} = req.body;

  try {
    const scanBoxPath = path.join(__dirname, 'scanBox.js');
    const generateCounterPath = path.join(__dirname, 'generateCounterFromScan.js');

    exec(`node "${scanBoxPath}" "${date}" "${client}"`, (err) => {
      if (err) console.error('scanBox error:', err);
    });

    exec(`node "${generateCounterPath}" "${date}"`, (err) => {
      if (err) console.error('generateCounter error:', err);
    });

    res.json({ok: true});
  } catch (err) {
    console.error(err);
    res.json({ok: false, error: err.message});
  }
});

// ---------------------------
// API: GENERATE COUNTER
// ---------------------------
const generateCounterFromScan = require('./generateCounterFromScan');

app.post('/api/generate-counter', (req, res) => {
  const {date} = req.body;

  if (!date) {
    return res.json({ok: false, error: 'Missing date'});
  }

  try {
    generateCounterFromScan(date);
    res.json({
      ok: true,
      file: `/output/${date}/counter_${date}.xlsx`,
    });
  } catch (err) {
    console.error(err);
    res.json({ok: false, error: err.message});
  }
});

// ---------------------------
// API: DOWNLOAD COUNTER
// ---------------------------
app.get('/api/download-counter', (req, res) => {
  const date = req.query.date;
  const filePath = path.join(outputDir, date, `counter_${date}.xlsx`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Counter file not found');
  }

  res.download(filePath, `counter_${date}.xlsx`);
});

// ---------------------------
// API: OPEN FOLDER (WEB VIEW)
// ---------------------------
app.get('/api/open-folder', (req, res) => {
  const date = req.query.date;
  const dir = path.join(outputDir, date);

  if (!fs.existsSync(dir)) {
    return res.status(404).send('Folder not found');
  }

  const files = fs.readdirSync(dir);

  const html = `
    <h2>Files in ${dir}</h2>
    <ul>
      ${files.map((f) => `<li><a href="/output/${date}/${f}" download>${f}</a></li>`).join('')}
    </ul>
  `;

  res.send(html);
});

// ---------------------------
// API: SERVER IP
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

app.get('/api/server-ip', (req, res) => {
  res.json({ip: IP, port: PORT});
});

// ---------------------------
// START SERVER
// ---------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://${IP}:${PORT}`);
});
