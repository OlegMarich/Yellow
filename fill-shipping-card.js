const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// -----------------------------
// HELPERS
// -----------------------------
function formatClientLocation(entry) {
  const customerShort = entry.customer?.short || 'UNKNOWN CLIENT';
  const locationCountry = entry.locationCountry || 'UNKNOWN COUNTRY';
  const location = entry.location || 'UNKNOWN LOCATION';
  return `${customerShort} ${locationCountry} - ${location}`;
}

function parseQty(value) {
  if (typeof value === 'string') value = value.replace(',', '.').trim();
  return Number(value) || 0;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

function getISOWeek(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return `week${Math.floor((date - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1}`;
}

function splitPlates(carNumber) {
  if (!carNumber) return ['', ''];
  const tokens = carNumber.split(' ').filter(Boolean);

  if (tokens.length === 1) return [tokens[0], ''];
  if (tokens.length === 2) return [tokens[0], tokens[1]];
  if (tokens.length >= 3) return [tokens[0], tokens.slice(1).join(' ')];

  return ['', ''];
}

// -----------------------------
// MAIN
// -----------------------------
const selectedDate = process.argv[2];
if (!selectedDate) {
  console.error('❌ Не передано дату як аргумент');
  process.exit(1);
}

const [year, month, day] = selectedDate.split('-');
const fileName = `${day}.${month}_transportPlanData.json`;
const weekArg = getISOWeek(selectedDate);

const jsonPath = path.join(__dirname, 'storage', weekArg, fileName);
if (!fs.existsSync(jsonPath)) {
  console.error(`❌ Не знайдено файл ${jsonPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const templatePath = path.join(__dirname, 'shipping card.xlsx');

if (!fs.existsSync(templatePath)) {
  console.error(`❌ Не знайдено шаблон shipping card.xlsx`);
  process.exit(1);
}

// Якщо JSON порожній — створюємо один пустий запис, щоб не падати
const safeData =
  Array.isArray(data) && data.length > 0
    ? data
    : [
        {
          customer: null,
          location: null,
          locationCountry: null,
          product: null,
          qty: 0,
          pal: 0,
          carNumber: '',
          driver: '',
          ifs: '',
          shipDate: selectedDate,
        },
      ];

// -----------------------------
// GROUPING
// -----------------------------
function groupByOrders(entries) {
  const grouped = {};

  entries.forEach((entry) => {
    const clientName = formatClientLocation(entry);
    const car = entry.carNumber || '';
    const date = entry.shipDate || selectedDate;

    const key = `${clientName}__${car}__${date}`;

    if (!grouped[key]) {
      grouped[key] = {
        entries: [],
        clientName,
        car,
        date,
      };
    }

    grouped[key].entries.push(entry);
  });

  return grouped;
}

const groupedOrders = groupByOrders(safeData);

// -----------------------------
// GENERATE SHIPPING CARDS
// -----------------------------
async function fillTemplate() {
  const outputDir = path.join(__dirname, 'output', selectedDate);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});

  const sortedKeys = Object.keys(groupedOrders).sort();

  for (const key of sortedKeys) {
    const {entries, clientName} = groupedOrders[key];
    const first = entries[0];

    const carNumber = first.carNumber || '';
    const driver = first.driver || '';
    const shipDate = formatDate(first.shipDate || selectedDate);
    const palletType = first.product?.palType || '';
    const ifs = first.ifs || '';

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.getWorksheet('KARTA');

    if (!sheet) {
      console.error(`❌ Не знайдено аркуш "KARTA"`);
      continue;
    }

    // -----------------------------
    // HEADER
    // -----------------------------
    sheet.getCell('A1').value = `KARTA WYSYŁKOWA / SHIPPING CARD`;
    sheet.getCell('G1').value = `Data/Date: ${shipDate}`;
    sheet.getCell('B11').value = `DRIVER: ${driver}`;
    sheet.getCell('B13').value = `CAR NUMBER: ${carNumber}`;
    sheet.getCell('B15').value = `DESTINATION: ${clientName}`;
    sheet.getCell('H26').value = `${palletType}`;

    sheet.getCell('G2').value = 'IFS:';
    sheet.getCell('H2').value = ifs;

    // -----------------------------
    // TOTALS
    // -----------------------------
    let totalBananaQty = 0,
      totalBananaPal = 0;
    let totalBioQty = 0,
      totalBioPal = 0;
    let totalPineQty = 0,
      totalPinePal = 0;

    for (const e of entries) {
      const qty = parseQty(e.qty);
      const pal = parseQty(e.pal);
      const productId = (e.product?.id || '').toLowerCase();

      if (productId.includes('pineapple') || productId.includes('ananas')) {
        totalPineQty += qty;
        totalPinePal += pal;
      } else if (productId.includes('bio')) {
        totalBioQty += qty;
        totalBioPal += pal;
      } else {
        totalBananaQty += qty;
        totalBananaPal += pal;
      }
    }

    const totalQty = totalBananaQty + totalBioQty + totalPineQty;
    sheet.getCell('H3').value = totalQty;

    // -----------------------------
    // ORDER: PINEAPPLE → BANANA → BIO
    // -----------------------------
    let rowIndex = 27;

    if (totalPineQty > 0) {
      sheet.getCell(`A${rowIndex}`).value = 'PINEAPPLE';
      sheet.getCell(`D${rowIndex}`).value = totalPineQty;
      sheet.getCell(`H${rowIndex}`).value = totalPinePal;
      rowIndex++;
    }

    if (totalBananaQty > 0) {
      sheet.getCell(`A${rowIndex}`).value = 'BANANA';
      sheet.getCell(`D${rowIndex}`).value = totalBananaQty;
      sheet.getCell(`H${rowIndex}`).value = totalBananaPal;
      rowIndex++;
    }

    if (totalBioQty > 0) {
      sheet.getCell(`A${rowIndex}`).value = 'BIO BANANA';
      sheet.getCell(`D${rowIndex}`).value = totalBioQty;
      sheet.getCell(`H${rowIndex}`).value = totalBioPal;
    }

    // -----------------------------
    // SAVE FILE
    // -----------------------------
    const safeClient = clientName.replace(/[\\/:*?"<>|]/g, '_');
    const safeCar = carNumber.replace(/[\\/:*?"<>|]/g, '_');

    const folderPath = path.join(outputDir, safeClient);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, {recursive: true});

    const outFile = `Shipping card ${safeClient} - ${safeCar}.xlsx`;
    const outPath = path.join(folderPath, outFile);

    await workbook.xlsx.writeFile(outPath);
    console.log(`✅ Створено: ${outPath}`);
  }
}

fillTemplate().catch(console.error);
