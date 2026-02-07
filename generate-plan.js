const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

// -----------------------------
// HELPERS
// -----------------------------
function normalize(str) {
  return (str || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s+/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function loadJson(filePath, label) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || raw.trim().length < 2) {
      console.error(`❌ ${label} is empty or invalid`);
      process.exit(1);
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to load ${label}:`, err.message);
    process.exit(1);
  }
}

// -----------------------------
// LOAD MAPPING FILES
// -----------------------------
const clients = loadJson(
  path.join(__dirname, 'config', 'mapping-clients.json'),
  'mapping-clients.json',
);
const locations = loadJson(
  path.join(__dirname, 'config', 'mapping-locations.json'),
  'mapping-locations.json',
);
const products = loadJson(
  path.join(__dirname, 'config', 'mapping-products.json'),
  'mapping-products.json',
);
const productAliases = loadJson(
  path.join(__dirname, 'config', 'mapping-product-aliases.json'),
  'mapping-product-aliases.json',
);

// -----------------------------
// CLEAN LOCATION NAME
// -----------------------------
function cleanLocationName(loc) {
  return loc.replace(/color\s*\d+(\.\d+)?/i, '').trim();
}

// -----------------------------
// DATE EXTRACTION (D4..J4)
// -----------------------------
function extractDates(sheet) {
  const dates = [];

  for (let colIndex = 3; colIndex < 10; colIndex++) {
    const col = xlsx.utils.encode_col(colIndex);
    const addr = `${col}4`;

    const cell = sheet[addr];
    if (!cell || cell.v == null) continue;

    const v = Number(cell.v);
    if (!isNaN(v)) {
      const d = xlsx.SSF.parse_date_code(v);
      if (d) {
        dates.push(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`);
      }
    }
  }

  return dates;
}

// -----------------------------
// PRODUCT RESOLUTION
// -----------------------------
function resolveProduct(rawName) {
  if (!rawName) return null;

  const cleaned = rawName.replace(/\u00A0/g, ' ');
  const norm = normalize(cleaned);

  if (norm.includes('bio') && norm.includes('banana')) {
    return 'BANANA_BIO';
  }

  if (productAliases['BANANA_BIO']) {
    for (const alias of productAliases['BANANA_BIO']) {
      if (norm.includes(normalize(alias))) return 'BANANA_BIO';
    }
  }

  if (productAliases['BANANA']) {
    for (const alias of productAliases['BANANA']) {
      if (norm.includes(normalize(alias))) return 'BANANA';
    }
  }

  for (const [productId, aliasList] of Object.entries(productAliases)) {
    if (productId === 'BANANA' || productId === 'BANANA_BIO') continue;
    for (const alias of aliasList) {
      if (norm.includes(normalize(alias))) return productId;
    }
  }

  return null;
}

// -----------------------------
// ROW TYPE HELPERS
// -----------------------------
function isClientRow(raw) {
  const norm = normalize(raw);

  for (const [clientId, client] of Object.entries(clients)) {
    const normShort = normalize(client.short);
    const normFull = normalize(client.full || '');
    const normId = normalize(clientId);

    if (
      norm === normShort ||
      norm === normFull ||
      norm === normId ||
      norm.includes(normShort) ||
      normShort.includes(norm)
    ) {
      return clientId;
    }
  }

  return null;
}

function isLocationName(raw) {
  const norm = normalize(raw);
  return Object.keys(locations).map(normalize).includes(norm);
}

function findLocationKey(raw) {
  const norm = normalize(raw);
  return Object.keys(locations).find((loc) => normalize(loc) === norm) || null;
}

// -----------------------------
// MAIN PARSER
// -----------------------------
function parseSales(sheetJson, dates) {
  const items = [];
  const dateCount = dates.length;

  let currentClientId = null;
  let currentLocation = null;
  let locationQuantities = null;

  for (let i = 0; i < sheetJson.length; i++) {
    const row = sheetJson[i];
    if (!row || !row[0]) continue;

    const raw = row[0].toString().trim();
    const norm = normalize(raw);

    if (norm.startsWith('total')) continue;

    const numericCells = row.slice(2, 2 + dateCount).map(toNumber);
    const hasNumbers = numericCells.some((n) => n > 0);

    // LOCATION ROW
    if (currentClientId && isLocationName(raw) && hasNumbers) {
      const rawLocKey = findLocationKey(raw);
      const clientIdFromLocation = locations[rawLocKey];

      const clientId = clientIdFromLocation || currentClientId;
      const clientInfo = clients[clientId];

      const cleanedLocation = cleanLocationName(rawLocKey);
      const locationCountry = clientInfo.country;

      currentClientId = clientId;
      currentLocation = cleanedLocation;
      locationQuantities = numericCells;

      const productInfo = products['BANANA'];

      items.push({
        customer: {
          id: clientId,
          short: clientInfo.short,
          country: clientInfo.country,
        },
        location: cleanedLocation,
        locationCountry,
        product: {
          id: 'BANANA',
          name: 'BANANA',
          bio: false,
          boxPerPal: productInfo.boxPerPal,
          weightPerBox: productInfo.weightPerBox,
          palType: productInfo.palType,
        },
        dates: dates.map((d, idx) => ({
          date: d,
          qty: locationQuantities[idx] || 0,
        })),
      });

      continue;
    }

    // PRODUCT ROW
    const productId = resolveProduct(raw);
    if (productId && currentClientId && currentLocation) {
      const qty = hasNumbers ? numericCells : locationQuantities;

      const productInfo = products[productId];
      const clientInfo = clients[currentClientId];
      const locationCountry = clientInfo.country;

      items.push({
        customer: {
          id: currentClientId,
          short: clientInfo.short,
          country: clientInfo.country,
        },
        location: currentLocation,
        locationCountry,
        product: {
          id: productId,
          name: productId,
          bio: productId === 'BANANA_BIO',
          boxPerPal: productInfo.boxPerPal,
          weightPerBox: productInfo.weightPerBox,
          palType: productInfo.palType,
        },
        dates: dates.map((d, idx) => ({
          date: d,
          qty: qty[idx] || 0,
        })),
      });

      continue;
    }

    // CLIENT ROW
    const clientId = isClientRow(raw);
    if (clientId && !hasNumbers) {
      currentClientId = clientId;
      currentLocation = null;
      locationQuantities = null;
      continue;
    }
  }

  return items;
}

// -----------------------------
// MAIN
// -----------------------------
async function main() {
  const dateArg = process.argv[2];
  const tempDir = process.argv[3];

  if (!dateArg) {
    console.error('❌ No date provided');
    process.exit(1);
  }

  if (!tempDir) {
    console.error('❌ No temp directory provided');
    process.exit(1);
  }

  const salesPath = path.join(tempDir, 'salesPlan.xlsx');

  if (!fs.existsSync(salesPath)) {
    console.error(`❌ Sales plan not found in temp: ${salesPath}`);
    process.exit(1);
  }

  const workbook = xlsx.readFile(salesPath);
  const sheetNames = workbook.SheetNames;

  let weekNumber;

  // Якщо формат "week5"
  if (/week\d+/i.test(dateArg)) {
    weekNumber = parseInt(dateArg.replace(/week/i, ''));
  }
  // Якщо просто число "5"
  else if (/^\d+$/.test(dateArg)) {
    weekNumber = parseInt(dateArg);
  }
  // Якщо дата
  else {
    weekNumber = getISOWeek(dateArg);
  }

  if (!weekNumber || isNaN(weekNumber)) {
    console.error('❌ Invalid week argument:', dateArg);
    process.exit(1);
  }

  // 🔥 універсальний пошук листа
  const targetSheetName =
    sheetNames.find((s) => normalize(s).includes(`week${weekNumber}`)) ||
    sheetNames.find((s) => normalize(s).includes('week')) ||
    sheetNames[0];

  const sheet = workbook.Sheets[targetSheetName];

  const dates = extractDates(sheet);
  const sheetJson = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  });

  const items = parseSales(sheetJson, dates);

  const outDir = path.join(__dirname, 'storage', `week${weekNumber}`);
  fs.mkdirSync(outDir, {recursive: true});

  const outPath = path.join(outDir, `week${weekNumber}_salesPlan.json`);

  fs.writeFileSync(
    outPath,
    JSON.stringify({week: `Week${weekNumber}`, dates, items}, null, 2),
    'utf8',
  );

  console.log(`📄 Sales plan saved: ${outPath}`);
}

// -----------------------------
// ISO WEEK CALC
// -----------------------------
function getISOWeek(dateStr) {
  const d = new Date(dateStr);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round(diff / 604800000);
}

main();
