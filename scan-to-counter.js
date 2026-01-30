const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

module.exports = function scanBox({date, client, containerNumber, quantity}) {
  const counterPath = path.join(__dirname, 'output', date, `counter_${date}.xlsx`);
  const dataPath = path.join(__dirname, 'output', date, 'data.json');

  const workbook = XLSX.readFile(counterPath);
  const sheet = workbook.Sheets[client];

  if (!sheet) {
    throw new Error(`Sheet for client "${client}" not found`);
  }

  // ---------------- FIND ROW ----------------
  function findRow(sheet, container) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cellA = sheet[XLSX.utils.encode_cell({r, c: 0})];
      if (cellA && cellA.v === container) return r;
    }
    return null;
  }

  // ---------------- CREATE ROW ----------------
  function createRow(sheet, container) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const newRow = range.e.r + 1;

    sheet[XLSX.utils.encode_cell({r: newRow, c: 0})] = {v: container}; // A
    sheet[XLSX.utils.encode_cell({r: newRow, c: 2})] = {v: 0}; // C qty

    return newRow;
  }

  // ---------------- ADD QTY ----------------
  function addQty(sheet, row, qty) {
    const cell = XLSX.utils.encode_cell({r: row, c: 2});
    const current = sheet[cell] ? Number(sheet[cell].v) : 0;
    const updated = current + qty;
    sheet[cell] = {v: updated};
    return updated;
  }

  // ---------------- GET TOTAL FOR CLIENT ----------------
  const rows = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const order = rows.find((r) => r['Odbiorca'] === client);
  const total = order ? Number(order['Ilość']) : null;

  // ---------------- SUM ALL SCANNED QTY ----------------
  function sumAllQty(sheet) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    let sum = 0;

    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = sheet[XLSX.utils.encode_cell({r, c: 2})];
      if (cell && !isNaN(cell.v)) sum += Number(cell.v);
    }

    return sum;
  }

  // ---------------- PROCESS ----------------
  let row = findRow(sheet, containerNumber);
  if (row === null) row = createRow(sheet, containerNumber);

  addQty(sheet, row, quantity);

  const scanned = sumAllQty(sheet);
  const remaining = total !== null ? total - scanned : null;

  XLSX.writeFile(workbook, counterPath);

  return {total, scanned, remaining};
};
