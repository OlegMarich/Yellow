const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

function generateCounterFile(date) {
  // Шлях до data.json
  const jsonPath = path.join(__dirname, 'output', date, 'data.json');

  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ Не знайдено файл data.json для дати ${date}`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // Унікальні клієнти
  const clients = [...new Set(rows.map((r) => r['Odbiorca']).filter(Boolean))];

  // Шаблон у корені проекту
  const templatePath = path.join(__dirname, 'Counter.xlsx');

  if (!fs.existsSync(templatePath)) {
    console.error(`❌ Не знайдено шаблон Counter.xlsx за шляхом: ${templatePath}`);
    process.exit(1);
  }

  // Читаємо шаблон
  const workbook = XLSX.readFile(templatePath);

  // Базова вкладка
  const baseSheetName = 'Customer';
  const baseSheet = workbook.Sheets[baseSheetName];

  if (!baseSheet) {
    console.error(`❌ У шаблоні немає вкладки "Customer"`);
    process.exit(1);
  }

  // Створюємо вкладки для кожного клієнта
  clients.forEach((client) => {
    const newSheet = JSON.parse(JSON.stringify(baseSheet)); // deep copy
    workbook.Sheets[client] = newSheet;
    workbook.SheetNames.push(client);
  });

  // Видаляємо базову вкладку
  delete workbook.Sheets[baseSheetName];
  workbook.SheetNames = workbook.SheetNames.filter((n) => n !== baseSheetName);

  // Шлях до вихідного файлу
  const outFile = path.join(__dirname, 'output', date, `counter_${date}.xlsx`);

  // Зберігаємо
  XLSX.writeFile(workbook, outFile);

  console.log(`✔ Counter.xlsx створено: ${outFile}`);
}

// --- CLI MODE ---
const date = process.argv[2];

if (!date) {
  console.error('❌ Не передано дату як аргумент');
  process.exit(1);
}

generateCounterFile(date);
