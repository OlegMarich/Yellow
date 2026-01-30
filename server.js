const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {exec} = require('child_process');

const app = express();
const PORT = 3000;

const inputDir = path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');
const publicDir = path.join(__dirname, 'public');
// ДОДАТИ ПІСЛЯ public та output
const storageDir = path.join(__dirname, 'storage');
app.use('/storage', express.static(storageDir));

app.use(express.static(publicDir));
app.use('/output', express.static(outputDir));
app.use(express.json());

// ---------------------------
// Multer: upload to /input
// ---------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, inputDir),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({storage});

// ---------------------------
// Helpers
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
// MAIN ROUTE: /api/run-all
// ---------------------------
app.post('/api/run-all', upload.array('files', 2), (req, res) => {
  const userDate = req.query.date;

  if (!userDate || !/^\d{4}-\d{2}-\d{2}$/.test(userDate)) {
    return res.status(400).json({success: false, message: 'Invalid or missing date parameter'});
  }

  // ---------------------------
  // Identify uploaded files
  // ---------------------------
  const salesFile = req.files.find((f) => f.originalname.toLowerCase().includes('sales'));
  const transportFile = req.files.find((f) => f.originalname.toLowerCase().includes('plan'));

  if (!salesFile || !transportFile) {
    return res.status(400).json({success: false, message: 'Missing sales or transport file'});
  }

  // ---------------------------
  // Use single temp directory
  // ---------------------------
  const tempDir = path.join(__dirname, 'temp');
  fs.mkdirSync(tempDir, {recursive: true});

  // Normalize filenames inside temp
  const salesTemp = path.join(tempDir, 'salesPlan.xlsx');
  const transportTemp = path.join(tempDir, 'transportPlan.xlsx');

  // Overwrite files every run
  fs.copyFileSync(salesFile.path, salesTemp);
  fs.copyFileSync(transportFile.path, transportTemp);

  // ---------------------------
  // Run parser-sales.js
  // ---------------------------
  const week = getISOWeek(userDate);
  const sheetName = `${week} WEEK`;
  const parseCmd = `node parser-sales.js "${sheetName}" "${tempDir}"`;

  console.log(`📄 Parsing sales plan: ${parseCmd}`);

  exec(parseCmd, (parseErr, parseOut, parseErrOut) => {
    if (parseErr) {
      console.error('❌ Parser error:', parseErr.message);
      console.error('stderr:', parseErrOut);
      return res.status(500).json({success: false, message: parseErrOut || parseErr.message});
    }

    console.log('✅ Parser output:', parseOut);

    // ---------------------------
    // Run run-all.js with tempDir
    // ---------------------------
    const runCmd = `node run-all.js ${userDate} "${tempDir}"`;
    console.log(`🚀 Running full report: ${runCmd}`);

    exec(runCmd, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Error during script run:', err.message);
        console.error('stderr:', stderr);
        return res.status(500).json({success: false, message: stderr || err.message});
      }

      console.log(stdout);

      const match = stdout.match(/@@@DONE:(\d{4}-\d{2}-\d{2})/);
      const resultDate = match ? match[1] : null;

      if (!resultDate) {
        return res.status(500).json({success: false, message: 'No completion confirmation found'});
      }

      // ---------------------------
      // Open output folder
      // ---------------------------
      const folderPath = path.join(outputDir, resultDate);
      exec(`start "" "${folderPath}"`, (openErr) => {
        if (openErr) {
          console.error('❌ Error opening folder:', openErr);
        }
      });

      res.json({
        success: true,
        message: 'Report generated successfully',
        date: resultDate,
      });
    });
  });
});

app.post('/api/scanner/save', (req, res) => {
  try {
    const {date, client, scanned, expectedQty, expectedPal, timestamp} = req.body;

    if (!date || !client || !scanned) {
      return res.status(400).json({success: false, message: 'Missing required fields'});
    }

    const dayFolder = path.join(storageDir, 'scanner');
    fs.mkdirSync(dayFolder, {recursive: true});

    const filePath = path.join(dayFolder, `${date}.json`);

    let existing = {};
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }

    existing[client] = {
      scanned,
      expectedQty,
      expectedPal,
      timestamp,
    };

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

    res.json({success: true, message: 'Scanner data saved'});
  } catch (err) {
    console.error(err);
    res.status(500).json({success: false, message: 'Server error'});
  }
});

// ---------------------------
// Start server
// ---------------------------

const os = require('os');

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

// ДОДАТИ ПЕРЕД app.listen(...)
app.get('/api/server-ip', (req, res) => {
  res.json({ip: IP, port: PORT});
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://${IP}:${PORT}`);
});
