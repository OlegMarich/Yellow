const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

// ===============================
// 1. Аргумент: дата (YYYY-MM-DD)
// ===============================
const dateArg = process.argv[2];
if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error('❌ Невірний формат дати. Очікується YYYY-MM-DD');
  process.exit(1);
}

// ===============================
// 2. Аргумент: tempDir (від run-all.js)
// ===============================
const baseDir = process.argv[3];
if (!baseDir) {
  console.error('❌ Не передано tempDir для generate-reports.js');
  process.exit(1);
}

// ===============================
// 3. ISO week
// ===============================
function getISOWeek(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const weekNumber = Math.floor((date - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `week${weekNumber}`;
}

const weekArg = getISOWeek(dateArg);

// ===============================
// 4. Дата у форматі DD.MM
// ===============================
const [year, month, day] = dateArg.split('-');
const targetDate = `${day}.${month}`;

// ===============================
// 5. Завантаження mapping
// ===============================
function loadJSON(name) {
  const p = path.join(__dirname, 'config', name);
  if (!fs.existsSync(p)) {
    console.error(`❌ Не знайдено mapping файл: ${name}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const clients = loadJSON('mapping-clients.json');
const locations = loadJSON('mapping-locations.json');
const products = loadJSON('mapping-products.json');
const clientPallets = loadJSON('mapping-client-pallets.json');

// ===============================
// 6. Завантаження salesPlan
// ===============================
const salesPlanPath = path.join(__dirname, 'storage', weekArg, `${weekArg}_salesPlan.json`);
if (!fs.existsSync(salesPlanPath)) {
  console.error(`❌ Не знайдено salesPlan: ${salesPlanPath}`);
  process.exit(1);
}
const salesPlan = JSON.parse(fs.readFileSync(salesPlanPath, 'utf8'));

// ===============================
// HELPERS
// ===============================
function clean(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRow(row) {
  const out = {};
  for (const key in row) {
    out[key.toLowerCase().trim()] = row[key];
  }
  return out;
}

function getQty(r) {
  return Number(r['qty'] || r['quantity'] || r['boxes'] || r['ilosc'] || r['total'] || 0);
}

function getPal(r) {
  return Number(r['pal'] || r['pallet'] || r['pallets'] || r['qty pal'] || r['pal qty'] || 0);
}

function excelTimeToHHMM(value) {
  if (typeof value !== 'number') return value;
  const totalMinutes = Math.round(value * 24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeLocationName(name) {
  return clean(name)
    .replace(/\(.*?\)/g, '')
    .replace(/color\s*\d+(\.\d+)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===============================
// НОВЕ: нормалізація продукту з Excel
// ===============================
function normalizeProductName(name) {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ===============================
// MAIN
// ===============================
async function main() {
  console.log(`📁 Використовуємо temp директорію: ${baseDir}`);

  // ===============================
  // Автоматичний пошук транспортного файлу
  // ===============================
  const transportFile = fs
    .readdirSync(baseDir)
    .find((f) => f.toLowerCase().endsWith('_transportplan.xlsx'));

  if (!transportFile) {
    console.error(`❌ Не знайдено transport plan у temp (очікується *_transportPlan.xlsx)`);
    process.exit(1);
  }

  const transportPath = path.join(baseDir, transportFile);
  console.log(`📄 Використовуємо транспортний файл: ${transportFile}`);

  const workbook = xlsx.readFile(transportPath);

  function normalizeDateString(str) {
    return str.replace(/\D/g, '').padStart(4, '0');
  }

  function findSheetByDate(sheetNames, ddmm) {
    const normalizedTarget = normalizeDateString(ddmm);
    return sheetNames.find((name) => normalizeDateString(name).includes(normalizedTarget));
  }

  const sheetName = findSheetByDate(workbook.SheetNames, targetDate);
  if (!sheetName) {
    console.error(`❌ Не знайдено аркуша з датою ${targetDate}`);
    process.exit(1);
  }

  console.log(`📄 Автовибір вкладки: ${sheetName}`);

  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, {defval: ''});

  const result = [];
  const existingIndex = new Map();

  // ===============================
  // Обробка транспортного плану
  // ===============================
  rows.forEach((raw) => {
    const r = normalizeRow(raw);

    if (!r['customer'] && !r['product']) return;

    const rawCustomer = (r['customer'] || '').trim();

    // НОВЕ: нормалізація продукту
    const productId = normalizeProductName(r['product']);
    const productInfo = products[productId];

    if (!productInfo) {
      console.warn('⚠️ Продукт не знайдено у mapping-products:', r['product'], '→', productId);
      return;
    }

    const qty = getQty(r);
    const pal = getPal(r);

    function findLocation(rawCustomer) {
      const customer = clean(rawCustomer);

      // 1) Точний збіг
      for (const loc of Object.keys(locations)) {
        if (customer === clean(loc)) return loc;
      }

      // 2) Збіг по словах
      const words = customer.split(' ');
      for (const loc of Object.keys(locations)) {
        if (words.includes(clean(loc))) return loc;
      }

      // 3) Лише якщо нічого не знайдено — includes()
      for (const loc of Object.keys(locations)) {
        if (customer.includes(clean(loc))) return loc;
      }

      return null;
    }

    const foundLocation = findLocation(rawCustomer);

    if (!foundLocation) return;

    const clientId = locations[foundLocation];
    const clientInfo = clients[clientId];

    const normalizedLocation = normalizeLocationName(foundLocation);

    const carNumber = `${r['truck plate nr'] || ''} ${r['trailer plate nr'] || ''}`.trim();
    const driver = r['driver'] || '';
    const ifs = r['ifs order nr'] || '';

    let timeRaw = r['loading time'] || r['time'] || '';
    if (typeof timeRaw === 'number') timeRaw = excelTimeToHHMM(timeRaw);

    const palletInfo = clientPallets[foundLocation]?.[productId] || productInfo;

    const palFinal = pal > 0 ? Math.ceil(Number(pal)) : 0;

    const key = `${clientId}|${productId}|${normalizedLocation}|${dateArg}|${carNumber}|${timeRaw}`;

    if (existingIndex.has(key)) {
      const idx = existingIndex.get(key);
      result[idx].qty += qty;
      result[idx].pal += palFinal;
    } else {
      const idx = result.length;
      existingIndex.set(key, idx);

      result.push({
        customer: {
          id: clientId,
          short: clientInfo.short,
          country: clientInfo.country,
        },
        location: foundLocation,
        locationCountry: clientInfo.country,

        product: {
          id: productId,
          name: productId,
          bio: productId.includes('BIO'),
          boxPerPal: palletInfo.boxPerPal,
          weightPerBox: palletInfo.weightPerBox,
          palType: palletInfo.palType,
        },

        qty,
        pal: palFinal,

        carNumber,
        driver,
        ifs,
        shipDate: dateArg,
        time: timeRaw,
      });
    }
  });

  // ===============================
  // Skeleton з salesPlan
  // ===============================
  for (const item of salesPlan.items) {
    const clientId = item.customer.id;
    const productId = item.product.id;
    const location = item.location;

    const dateEntry = item.dates.find((d) => d.date === dateArg);
    if (!dateEntry || dateEntry.qty === 0) continue;

    const normalizedLocation = normalizeLocationName(location);
    const key = `${clientId}|${productId}|${normalizedLocation}|${dateArg}|||`;

    if (existingIndex.has(key)) continue;
    existingIndex.set(key, result.length);

    result.push({
      customer: item.customer,
      location: item.location,
      locationCountry: item.locationCountry,
      product: item.product,
      qty: 0,
      pal: 0,
      carNumber: '',
      driver: '',
      ifs: '',
      shipDate: dateArg,
      time: '',
    });
  }

  // ===============================
  // Збереження результату
  // ===============================
  const storageDir = path.join(__dirname, 'storage', weekArg);
  fs.mkdirSync(storageDir, {recursive: true});

  const fileName = `${day}.${month}_transportPlanData.json`;
  const outPath = path.join(storageDir, fileName);

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  console.log(`✅ Збережено: ${outPath}`);
}

main();
