const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// -----------------------------
// HELPERS
// -----------------------------
function parseQty(value) {
  if (typeof value === 'string') {
    value = value.replace(',', '.').trim();
  }
  return Number(value) || 0;
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

function getISOWeek(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  const weekNumber = Math.floor((date - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `week${weekNumber}`;
}

const weekArg = getISOWeek(selectedDate);

// -----------------------------
// LOAD JSON
// -----------------------------
const jsonPath = path.join(__dirname, 'storage', weekArg, fileName);

if (!fs.existsSync(jsonPath)) {
  console.error(`❌ Не знайдено файл ${jsonPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const outputDir = path.join(__dirname, 'output', selectedDate);

// 📄 Шлях до шаблону
const templatePath = path.join(__dirname, 'Loading for day.xlsx');
const outputPath = path.join(outputDir, 'Loading list.xlsx');

// -----------------------------
// GENERATE LOADING LIST
// -----------------------------
(async () => {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const sheet = workbook.getWorksheet(1);

  // 📅 Вставка дати у перший рядок
  sheet.getRow(1).getCell('A').value = formatDate(selectedDate);

  let currentRow = 3;

  const borderStyle = {
    top: {style: 'thin'},
    left: {style: 'thin'},
    bottom: {style: 'thin'},
    right: {style: 'thin'},
  };

  // -----------------------------
  // Сортуємо за часом
  // -----------------------------
  data.sort((a, b) => {
    const tA = a.time || '99:99';
    const tB = b.time || '99:99';
    return tA.localeCompare(tB);
  });

  // -----------------------------
  // Заповнення рядків
  // -----------------------------
  for (const entry of data) {
    const client = `${entry.customer?.short || ''} ${entry.locationCountry || ''} - ${entry.location || ''}`;

    const [truckPlate, trailerPlate] = splitPlates(entry.carNumber);

    const row = sheet.getRow(currentRow);

    const cells = [
      {col: 'A', value: client},
      {col: 'B', value: truckPlate},
      {col: 'C', value: trailerPlate},
      {col: 'D', value: entry.driver || ''},
      {col: 'E', value: entry.time || ''},
      {col: 'F', value: ''},
      {col: 'G', value: parseQty(entry.qty)},
      {col: 'H', value: parseQty(entry.pal)},
    ];

    for (const {col, value} of cells) {
      const cell = row.getCell(col);
      cell.value = value;
      cell.border = borderStyle;
    }

    row.commit();
    currentRow++;
  }

  // -----------------------------
  // Обведення клітинок
  // -----------------------------
  for (let r = 3; r < currentRow; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= 10; c++) {
      row.getCell(c).border = borderStyle;
    }
    row.commit();
  }

  await workbook.xlsx.writeFile(outputPath);
  console.log(`✅ Loading list створено: ${outputPath}`);
})();
