// generateCounterFromScan.js
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

function getISOWeek(dateString) {
  const date = new Date(dateString);
  const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  return Math.ceil(((temp - yearStart) / 86400000 + 1) / 7);
}

function generateCounterFromScan(date) {
  const baseDir = path.join(__dirname, 'output', date);

  // ---------------- LOAD TRANSPORT PLAN ----------------
  const transportPath = path.join(baseDir, `${date}_transportPlanData.json`);
  if (!fs.existsSync(transportPath)) {
    console.error(`❌ Не знайдено ${transportPath}`);
    process.exit(1);
  }
  const transportData = JSON.parse(fs.readFileSync(transportPath, 'utf8'));

  // ---------------- LOAD SCAN RESULTS ----------------
  const week = getISOWeek(date);
  const scanDir = path.join(__dirname, 'storage', `week${week}`, date, 'scanResults');

  if (!fs.existsSync(scanDir)) {
    console.error(`❌ Не знайдено папку scanResults для дати ${date}`);
    process.exit(1);
  }

  const scanFiles = fs.readdirSync(scanDir).filter((f) => f.endsWith('.json'));
  if (scanFiles.length === 0) {
    console.error(`❌ Немає жодного scanResult JSON для дати ${date}`);
    process.exit(1);
  }

  // ---------------- LOAD TEMPLATE ----------------
  const templatePath = path.join(__dirname, 'Counter.xlsx');
  if (!fs.existsSync(templatePath)) {
    console.error(`❌ Не знайдено шаблон Counter.xlsx за шляхом: ${templatePath}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(templatePath);
  const baseSheetName = 'Customer';
  const baseSheet = workbook.Sheets[baseSheetName];

  if (!baseSheet) {
    console.error(`❌ У шаблоні немає вкладки "Customer"`);
    process.exit(1);
  }

  // ============================================================
  // PROCESS EACH SCAN FILE
  // ============================================================
  scanFiles.forEach((file) => {
    const fullPath = path.join(scanDir, file);
    const scan = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

    const clientName = scan.client;
    const boxCounts = scan.boxCounts || {};

    const sheetName = clientName.substring(0, 31);
    const sheet = JSON.parse(JSON.stringify(baseSheet));
    workbook.Sheets[sheetName] = sheet;
    workbook.SheetNames.push(sheetName);

    // ---------------- HEADERS ----------------
    sheet['A2'] = {t: 's', v: 'Code'};
    sheet['B2'] = {t: 's', v: '-'};
    sheet['C2'] = {t: 's', v: 'qty'};
    sheet['E2'] = {t: 's', v: 'b.'};

    // ---------------- SORTED LIST OF CODES ----------------
    const list = Object.entries(boxCounts)
      .map(([code, qty]) => ({code, qty}))
      .sort((a, b) => b.qty - a.qty);

    let row = 3;
    let totalBoxes = 0;

    list.forEach((item) => {
      sheet[`A${row}`] = {t: 's', v: item.code};
      sheet[`B${row}`] = {t: 's', v: '-'};
      sheet[`C${row}`] = {t: 'n', v: item.qty};
      sheet[`E${row}`] = {t: 's', v: 'b.'};

      totalBoxes += item.qty;
      row++;
    });

    // ---------------- SUMMARY ----------------
    const summaryRow = row + 1;
    const palletRow = summaryRow + 1;

    // find boxPerPal from transport plan
    const clientOrders = transportData.filter((e) => {
      const name = `${e.customer?.short || 'UNKNOWN'} ${e.locationCountry || ''} - ${e.location || ''}`;
      return name === clientName;
    });

    const boxPerPal = clientOrders[0]?.product?.boxPerPal || 48;

    sheet[`A${summaryRow}`] = {t: 's', v: 'Total boxes'};
    sheet[`C${summaryRow}`] = {t: 'n', v: totalBoxes};

    sheet[`A${palletRow}`] = {t: 's', v: 'Total pallets'};
    sheet[`C${palletRow}`] = {t: 'n', v: Math.ceil(totalBoxes / boxPerPal)};
  });

  // ---------------- REMOVE TEMPLATE SHEET ----------------
  delete workbook.Sheets[baseSheetName];
  workbook.SheetNames = workbook.SheetNames.filter((n) => n !== baseSheetName);

  // ---------------- SAVE RESULT ----------------
  const outFile = path.join(baseDir, `counter_${date}.xlsx`);
  XLSX.writeFile(workbook, outFile);

  console.log(`✔ Counter.xlsx створено: ${outFile}`);
}

// CLI
const date = process.argv[2];
if (!date) {
  console.error('❌ Не передано дату як аргумент (формат 2026-01-28)');
  process.exit(1);
}
generateCounterFromScan(date);
