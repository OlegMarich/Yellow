require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {exec} = require('child_process');
const multer = require('multer');

// ---------------------------
// MULTER STORAGE (унікальні імена)
// ---------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({storage});

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

[inputDir, outputDir, storageDir, tempRoot, 'uploads'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
});

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
    time: new Date().toISOString(),
  });
});

app.get('/api/server-info', (req, res) => {
  res.json({
    status: 'running',
    ip: IP,
    port: PORT,
    lanUrl: `http://${IP}:${PORT}`,
    tempRoot,
    time: new Date().toISOString(),
  });
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
      if (err) console.error('❌ generate-plan error:', err);
      console.log('=============================================');
    });
  } catch (err) {
    console.error('❌ SERVER ERROR:', err);
    res.status(500).json({success: false, message: 'Internal server error'});
  }
});

// ======================================================
//  SALES PLAN REPORT
// ======================================================
app.get('/output/:week', (req, res) => {
  const week = req.params.week;
  const jsonPath = path.join(storageDir, week, `${week}_salesPlan.json`);

  if (!fs.existsSync(jsonPath)) {
    return res.status(404).send(`<h2>❌ JSON not found for ${week}</h2>`);
  }

  const data = fs.readFileSync(jsonPath, 'utf8');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Sales Report ${week}</title>
      <style>
        body { font-family: Arial; padding: 20px; background: #fafafa; }
        h1 { margin-bottom: 20px; }
        .filters { margin-bottom: 20px; }
        select { padding: 6px; margin-right: 10px; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ccc; padding: 6px 10px; }
        th { background: #f0f0f0; }
        .client-block { margin-top: 40px; padding: 10px; background: #fff; border-radius: 6px; }
        .location-block { margin-left: 20px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>Sales Report for ${week}</h1>

      <div class="filters">
        <select id="filterClient"><option value="">All Clients</option></select>
        <select id="filterCountry"><option value="">All Countries</option></select>
        <select id="filterProduct"><option value="">All Products</option></select>
        <select id="filterDate"><option value="">All Dates</option></select>
      </div>

      <div id="reportContainer"></div>

      <script>
        const rawData = ${data};

        const container = document.getElementById('reportContainer');
        const fClient = document.getElementById('filterClient');
        const fCountry = document.getElementById('filterCountry');
        const fProduct = document.getElementById('filterProduct');
        const fDate = document.getElementById('filterDate');

        function initFilters() {
          const clients = new Set();
          const countries = new Set();
          const products = new Set();
          const dates = new Set(rawData.dates);

          rawData.items.forEach(item => {
            clients.add(item.customer.short);
            countries.add(item.customer.country);
            products.add(item.product.id);
          });

          for (const c of clients) fClient.innerHTML += '<option>' + c + '</option>';
          for (const c of countries) fCountry.innerHTML += '<option>' + c + '</option>';
          for (const p of products) fProduct.innerHTML += '<option>' + p + '</option>';
          for (const d of dates) fDate.innerHTML += '<option>' + d + '</option>';
        }

        function render() {
          const fc = fClient.value;
          const fco = fCountry.value;
          const fp = fProduct.value;
          const fd = fDate.value;

          let html = '';

          const grouped = {};

          rawData.items.forEach(item => {
            if (fc && item.customer.short !== fc) return;
            if (fco && item.customer.country !== fco) return;
            if (fp && item.product.id !== fp) return;
            if (fd && !item.dates.some(d => d.date === fd && d.qty > 0)) return;

            const client = item.customer.short;
            const location = item.location;

            if (!grouped[client]) grouped[client] = {};
            if (!grouped[client][location]) grouped[client][location] = [];

            grouped[client][location].push(item);
          });

          for (const client of Object.keys(grouped)) {
            html += '<div class="client-block"><h2>Client: ' + client + '</h2>';

            for (const loc of Object.keys(grouped[client])) {
              html += '<div class="location-block"><h3>Location: ' + loc + '</h3>';

              html += '<table><tr><th>Product</th>';
              rawData.dates.forEach(d => html += '<th>' + d + '</th>');
              html += '</tr>';

              grouped[client][loc].forEach(item => {
                html += '<tr><td>' + item.product.id + '</td>';
                item.dates.forEach(d => html += '<td>' + d.qty + '</td>');
                html += '</tr>';
              });

              html += '</table></div>';
            }

            html += '</div>';
          }

          container.innerHTML = html || '<p>No data for selected filters.</p>';
        }

        initFilters();
        render();

        fClient.onchange = render;
        fCountry.onchange = render;
        fProduct.onchange = render;
        fDate.onchange = render;
      </script>
    </body>
    </html>
  `);
});

// ======================================================
//  DAILY TRANSPORT REPORT
// ======================================================
app.get('/report/day/:date', (req, res) => {
  const date = req.params.date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).send('Invalid date format');
  }

  const [year, month, day] = date.split('-');
  const week = getISOWeek(date);
  const fileName = `${day}.${month}_transportPlanData.json`;

  const jsonPath = path.join(storageDir, week, fileName);

  if (!fs.existsSync(jsonPath)) {
    return res.status(404).send(`<h2>❌ No transport data for ${date}</h2>`);
  }

  const data = fs.readFileSync(jsonPath, 'utf8');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Transport Report ${date}</title>
      <style>
        body { font-family: Arial; padding: 20px; background: #fafafa; }
        h1 { margin-bottom: 20px; }
        .filters { margin-bottom: 20px; }
        select { padding: 6px; margin-right: 10px; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ccc; padding: 6px 10px; }
        th { background: #f0f0f0; }
        .client-block { margin-top: 40px; padding: 10px; background: #fff; border-radius: 6px; }
        .location-block { margin-left: 20px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>Transport Report for ${date}</h1>

      <div class="filters">
        <select id="filterClient"><option value="">All Clients</option></select>
        <select id="filterCountry"><option value="">All Countries</option></select>
        <select id="filterProduct"><option value="">All Products</option></select>
        <select id="filterCar"><option value="">All Trucks</option></select>
        <select id="filterTime"><option value="">All Times</option></select>
      </div>

      <div id="reportContainer"></div>

      <script>
        const rawData = ${data};

        const container = document.getElementById('reportContainer');
        const fClient = document.getElementById('filterClient');
        const fCountry = document.getElementById('filterCountry');
        const fProduct = document.getElementById('filterProduct');
        const fCar = document.getElementById('filterCar');
        const fTime = document.getElementById('filterTime');

        function initFilters() {
          const clients = new Set();
          const countries = new Set();
          const products = new Set();
          const cars = new Set();
          const times = new Set();

          rawData.forEach(item => {
            clients.add(item.customer.short);
            countries.add(item.customer.country);
            products.add(item.product.id);
            if (item.carNumber) cars.add(item.carNumber);
            if (item.time) times.add(item.time);
          });

          for (const c of clients) fClient.innerHTML += '<option>' + c + '</option>';
          for (const c of countries) fCountry.innerHTML += '<option>' + c + '</option>';
          for (const p of products) fProduct.innerHTML += '<option>' + p + '</option>';
          for (const c of cars) fCar.innerHTML += '<option>' + c + '</option>';
          for (const t of times) fTime.innerHTML += '<option>' + t + '</option>';
        }

        function render() {
          const fc = fClient.value;
          const fco = fCountry.value;
          const fp = fProduct.value;
          const fcar = fCar.value;
          const ft = fTime.value;

          let html = '';

          const grouped = {};

          rawData.forEach(item => {
            if (fc && item.customer.short !== fc) return;
            if (fco && item.customer.country !== fco) return;
            if (fp && item.product.id !== fp) return;
            if (fcar && item.carNumber !== fcar) return;
            if (ft && item.time !== ft) return;

            const client = item.customer.short;
            const location = item.location;

            if (!grouped[client]) grouped[client] = {};
            if (!grouped[client][location]) grouped[client][location] = [];

            grouped[client][location].push(item);
          });

          for (const client of Object.keys(grouped)) {
            html += '<div class="client-block"><h2>Client: ' + client + '</h2>';

            for (const loc of Object.keys(grouped[client])) {
              html += '<div class="location-block"><h3>Location: ' + loc + '</h3>';

              html += '<table><tr><th>Product</th><th>Qty</th><th>Pal</th><th>Truck</th><th>Driver</th><th>Time</th></tr>';

              grouped[client][loc].forEach(item => {
                html += '<tr>' +
                  '<td>' + item.product.id + '</td>' +
                  '<td>' + item.qty + '</td>' +
                  '<td>' + item.pal + '</td>' +
                  '<td>' + item.carNumber + '</td>' +
                  '<td>' + item.driver + '</td>' +
                  '<td>' + item.time + '</td>' +
                '</tr>';
              });

              html += '</table></div>';
            }

            html += '</div>';
          }

          container.innerHTML = html || '<p>No data for selected filters.</p>';
        }

        initFilters();
        render();

        fClient.onchange = render;
        fCountry.onchange = render;
        fProduct.onchange = render;
        fCar.onchange = render;
        fTime.onchange = render;
      </script>
    </body>
    </html>
  `);
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
