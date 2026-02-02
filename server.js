const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {exec} = require('child_process');
const os = require('os');
const ngrok = require('ngrok');

const app = express();
const PORT = 3000;

// ---------------------------
// DIRECTORIES
// ---------------------------
const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');
const publicDir = path.join(__dirname, 'public');
const storageDir = path.join(__dirname, 'storage');

// ensure dirs exist
[inputDir, outputDir, storageDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
});

// ---------------------------
// MIDDLEWARE
// ---------------------------
app.use('/storage', express.static(storageDir));
app.use('/output', express.static(outputDir));
app.use(express.static(publicDir));
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
app.post('/api/save-scan-result', (req, res) => {
  try {
    const {client, date, boxCounts, totalBoxes, boxesPerPallet, totalPallets} = req.body;

    const folder = path.join(storageDir, 'scan-results');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, {recursive: true});

    const safeClient = client.replace(/[^a-z0-9]/gi, '_');
    const fileName = `${date}_${safeClient}.json`;
    const filePath = path.join(folder, fileName);

    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          client,
          date,
          totalBoxes,
          boxesPerPallet,
          totalPallets,
          boxCounts,
          savedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );

    res.json({ok: true, file: fileName});
  } catch (err) {
    console.error(err);
    res.json({ok: false, error: err.message});
  }
});

// ---------------------------
// API: RUN POST SCAN (scan → counter)
// ---------------------------
app.post('/api/run-post-scan', (req, res) => {
  const {date, client} = req.body;

  if (!date || !client) {
    return res.json({ok: false, error: 'Missing date or client'});
  }

  const scanBoxPath = path.join(__dirname, 'scanBox.js');
  const counterPath = path.join(__dirname, 'fill-template-counter.js');

  exec(`node "${scanBoxPath}" "${date}" "${client}"`, (err) => {
    if (err) {
      console.error('scanBox error:', err);
      return res.json({ok: false});
    }

    exec(`node "${counterPath}" "${date}"`, (err) => {
      if (err) {
        console.error('counter error:', err);
        return res.json({ok: false});
      }

      res.json({ok: true});
    });
  });
});

// ---------------------------
// API: DOWNLOAD COUNTER
// ---------------------------
app.get('/api/download-counter', (req, res) => {
  const {date} = req.query;
  const filePath = path.join(outputDir, date, `counter_${date}.xlsx`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Counter file not found');
  }

  res.download(filePath, `counter_${date}.xlsx`);
});

// ---------------------------
// API: OPEN FOLDER
// ---------------------------
app.get('/api/open-folder', (req, res) => {
  const {date} = req.query;
  const dir = path.join(outputDir, date);

  if (!fs.existsSync(dir)) {
    return res.status(404).send('Folder not found');
  }

  const files = fs.readdirSync(dir);

  res.send(`
    <h2>Files for ${date}</h2>
    <ul>
      ${files.map((f) => `<li><a href="/output/${date}/${f}" download>${f}</a></li>`).join('')}
    </ul>
  `);
});

// ---------------------------
// SERVER IP
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
// START SERVER + NGROK (HTTPS)
// ---------------------------
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Local server: http://${IP}:${PORT}`);

  try {
    const url = await ngrok.connect({
      addr: PORT,
      proto: 'http',
    });

    console.log(`🔐 Public HTTPS (ngrok): ${url}`);
  } catch (err) {
    console.error('ngrok error:', err);
  }
});
