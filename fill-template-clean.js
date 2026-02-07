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

function splitPlates(carNumber) {
  if (!carNumber) return ['', ''];
  const tokens = carNumber.split(' ').filter(Boolean);

  if (tokens.length === 1) return [tokens[0], ''];
  if (tokens.length === 2) return [tokens[0], tokens[1]];
  if (tokens.length >= 3) return [tokens[0], tokens.slice(1).join(' ')];

  return ['', ''];
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
const templatePath = path.join(__dirname, 'clean-template.xlsx');
const outputPath = path.join(outputDir, 'Clean list.xlsx');

if (!fs.existsSync(templatePath)) {
  console.error(`❌ Не знайдено шаблон clean-template.xlsx`);
  process.exit(1);
}

// -----------------------------
// GENERATE CLEAN LIST
// -----------------------------
(async () => {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, {recursive: true});

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const sheet = workbook.getWorksheet('sample');
  if (!sheet) {
    console.error('❌ Не знайдено аркуш "sample" у clean-template.xlsx');
    process.exit(1);
  }

  let currentRow = 4;

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
    const tA = a.time || '';
    const tB = b.time || '';
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
      {col: 'B', value: selectedDate},
      {col: 'C', value: client},
      {col: 'D', value: truckPlate},
      {col: 'E', value: trailerPlate},
      {col: 'F', value: selectedDate},
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
  const startRow = 2;
  const endRow = currentRow - 1;

  for (let rowNum = startRow; rowNum <= endRow; rowNum++) {
    const row = sheet.getRow(rowNum);
    for (let col = 1; col <= 9; col++) {
      const cell = row.getCell(col);
      cell.border = borderStyle;
    }
    row.commit();
  }

  await workbook.xlsx.writeFile(outputPath);
  console.log(`✅ Clean list створено: ${outputPath}`);
})();
