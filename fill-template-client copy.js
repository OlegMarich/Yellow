const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// -----------------------------
// HELPERS
// -----------------------------
function safeName(s) {
  return (
    String(s || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'unknown'
  );
}

function normalizeTime(t) {
  if (!t) return '';
  t = String(t).trim().replace('.', ':').replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2}):?(\d{1,2})$/);
  if (!m) return t;
  return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
}

function parseQty(v) {
  if (typeof v === 'string') v = v.replace(',', '.');
  return Number(v) || 0;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

function splitPlates(carNumber) {
  if (!carNumber) return ['', ''];

  const tokens = carNumber.split(' ').filter(Boolean);

  if (tokens.length === 2) return [tokens[0], tokens[1]];
  if (tokens.length === 3) return [tokens[0], tokens.slice(1).join(' ')];
  if (tokens.length >= 4) {
    return [tokens.slice(0, 2).join(' '), tokens.slice(2).join(' ')];
  }

  return [carNumber, ''];
}

function getISOWeek(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return `week${Math.floor((date - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1}`;
}

// -----------------------------
// INPUTS
// -----------------------------
const selectedDate = process.argv[2];
if (!selectedDate) {
  console.error('❌ Не передано дату. Приклад: node fill-template-client.js 2026-01-12');
  process.exit(1);
}

const templatePath = process.argv[3] || path.join(__dirname, 'client-template.xlsx');
const [year, month, day] = selectedDate.split('-');
const fileName = `${day}.${month}_transportPlanData.json`;
const weekArg = getISOWeek(selectedDate);
const transportPath = path.join(__dirname, 'storage', weekArg, fileName);

if (!fs.existsSync(templatePath)) {
  console.error(`❌ Шаблон не знайдено: ${templatePath}`);
  process.exit(1);
}

if (!fs.existsSync(transportPath)) {
  console.error(`❌ Не знайдено транспортний JSON: ${transportPath}`);
  process.exit(1);
}

const transportData = JSON.parse(fs.readFileSync(transportPath, 'utf-8'));
const outputDir = path.join(__dirname, 'output', selectedDate);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});

// -----------------------------
// GROUPING
// -----------------------------
function buildOrderKey(entry) {
  const client =
    `${entry.customer?.short || ''} ${entry.locationCountry || ''} - ${entry.location || ''}`.trim();
  const car = entry.carNumber || '';
  const time = normalizeTime(entry.time || '');
  return `${client}__${car}__${time}`;
}

const grouped = {};
for (const entry of transportData) {
  const key = buildOrderKey(entry);
  if (!grouped[key]) grouped[key] = [];
  grouped[key].push(entry);
}

// -----------------------------
// MAIN
// -----------------------------
async function fillTemplate() {
  let index = 0;

  const sortedGroups = Object.entries(grouped).sort(([k1], [k2]) => k1.localeCompare(k2));

  for (const [key, entries] of sortedGroups) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    const sheet = workbook.getWorksheet('Sheet1');
    if (!sheet) {
      console.error('❌ Не знайдено аркуш "Sheet1" у шаблоні');
      continue;
    }

    const sample = entries[0];
    const clientFull = `${sample.customer?.short || ''} ${sample.locationCountry || ''} - ${sample.location || ''}`;
    const [truckPlate, trailerPlate] = splitPlates(sample.carNumber);
    const driver = sample.driver || '';
    const date = formatDate(sample.shipDate || selectedDate);
    const time = normalizeTime(sample.time || '');

    let bananaQty = 0,
      bananaPal = 0;
    let bioQty = 0,
      bioPal = 0;
    let pineappleQty = 0;

    for (const e of entries) {
      const productId = e.product?.id?.toLowerCase() || '';
      const qty = parseQty(e.qty);
      const pal = parseQty(e.pal);

      if (productId.includes('bio')) {
        bioQty += qty;
        bioPal += pal;
      } else if (productId.includes('pineapple') || productId.includes('ananas')) {
        pineappleQty += qty;
      } else {
        bananaQty += qty;
        bananaPal += pal;
      }
    }

    // BANANA
    sheet.getCell('J8').value = date;
    sheet.getCell('C8').value = clientFull;
    sheet.getCell('J30').value = `${truckPlate} ${trailerPlate}`.trim();
    sheet.getCell('E10').value = time;
    sheet.getCell('J25').value = `${bananaQty} (${bananaPal})`;

    // BIO
    if (bioQty > 0) {
      sheet.getCell('C60').value = clientFull;
      sheet.getCell('J60').value = date;
      sheet.getCell('K63').value = `${truckPlate} ${trailerPlate}`.trim();
      sheet.getCell('E61').value = time;
      sheet.getCell('J69').value = bioQty;
      sheet.getCell('K69').value = bioPal;
    }

    // PINEAPPLE
    if (pineappleQty > 0) {
      sheet.getCell('C60').value = clientFull;
      sheet.getCell('J60').value = date;
      sheet.getCell('K63').value = `${truckPlate} ${trailerPlate}`.trim();
      sheet.getCell('E61').value = time;
      sheet.getCell('I95').value = pineappleQty;
    }

    const safeClient = safeName(clientFull);
    const safeCar = safeName(`${truckPlate}_${trailerPlate}`);
    const clientDir = path.join(outputDir, safeClient);
    if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, {recursive: true});

    index++;
    const outFile = `Client report ${index} - ${safeClient}_${safeCar}.xlsx`;
    const outPath = path.join(clientDir, outFile);

    await workbook.xlsx.writeFile(outPath);
    console.log(`📄 Створено файл: ${outPath}`);
  }

  console.log('✅ Усі звіти згенеровано успішно!');
}

fillTemplate().catch((err) => {
  console.error('❌ Критична помилка:', err);
  process.exit(1);
});
