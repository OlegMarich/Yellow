const fs = require('fs');
const path = require('path');

// -----------------------------
// LOAD JSON SAFE
// -----------------------------
function loadJson(filePath, label) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to load ${label}:`, err.message);
    process.exit(1);
  }
}

// -----------------------------
// BUILD STOCK ENGINE
// -----------------------------
function buildStock(weekFolder) {
  const storageDir = path.join(__dirname, 'storage', weekFolder);

  if (!fs.existsSync(storageDir)) {
    console.error(`❌ Папка ${storageDir} не існує`);
    process.exit(1);
  }

  // -----------------------------
  // 1. LOAD SALES PLAN
  // -----------------------------
  const salesPath = path.join(storageDir, `${weekFolder}_salesPlan.json`);
  const sales = loadJson(salesPath, 'salesPlan');

  const planned = {};

  for (const item of sales.items) {
    for (const d of item.dates) {
      const date = d.date;
      const qty = d.qty;

      if (!planned[date]) planned[date] = {};
      if (!planned[date][item.customer.id]) planned[date][item.customer.id] = {};
      if (!planned[date][item.customer.id][item.location]) planned[date][item.customer.id][item.location] = {};
      if (!planned[date][item.customer.id][item.location][item.product.id]) {
        planned[date][item.customer.id][item.location][item.product.id] = 0;
      }

      planned[date][item.customer.id][item.location][item.product.id] += qty;
    }
  }

  // -----------------------------
  // 2. LOAD TRANSPORT PLAN FILES
  // -----------------------------
  const delivered = {};

  const files = fs.readdirSync(storageDir).filter(f => f.includes('_transportPlanData.json'));

  for (const file of files) {
    const filePath = path.join(storageDir, file);
    const data = loadJson(filePath, file);

    for (const row of data) {
      const date = row.date || row["Data wysyłki"];
      const clientId = row.customerId;
      const location = row.location;
      const productId = row.productId;
      const qty = row.qty || row["Ilość razem"];

      if (!date || !clientId || !location || !productId) continue;

      if (!delivered[date]) delivered[date] = {};
      if (!delivered[date][clientId]) delivered[date][clientId] = {};
      if (!delivered[date][clientId][location]) delivered[date][clientId][location] = {};
      if (!delivered[date][clientId][location][productId]) {
        delivered[date][clientId][location][productId] = 0;
      }

      delivered[date][clientId][location][productId] += qty;
    }
  }

  // -----------------------------
  // 3. MERGE planned + delivered
  // -----------------------------
  const stock = {};

  const allDates = new Set([
    ...Object.keys(planned),
    ...Object.keys(delivered)
  ]);

  for (const date of allDates) {
    stock[date] = {};

    const clients = new Set([
      ...Object.keys(planned[date] || {}),
      ...Object.keys(delivered[date] || {})
    ]);

    for (const clientId of clients) {
      stock[date][clientId] = {};

      const locations = new Set([
        ...Object.keys(planned[date]?.[clientId] || {}),
        ...Object.keys(delivered[date]?.[clientId] || {})
      ]);

      for (const loc of locations) {
        stock[date][clientId][loc] = {};

        const products = new Set([
          ...Object.keys(planned[date]?.[clientId]?.[loc] || {}),
          ...Object.keys(delivered[date]?.[clientId]?.[loc] || {})
        ]);

        for (const productId of products) {
          const p = planned[date]?.[clientId]?.[loc]?.[productId] || 0;
          const d = delivered[date]?.[clientId]?.[loc]?.[productId] || 0;

          stock[date][clientId][loc][productId] = {
            planned: p,
            delivered: d,
            diff: d - p
          };
        }
      }
    }
  }

  // -----------------------------
  // 4. SAVE RESULT
  // -----------------------------
  const outPath = path.join(storageDir, `${weekFolder}_stock.json`);
  fs.writeFileSync(outPath, JSON.stringify(stock, null, 2), 'utf8');

  console.log(`\n📦 Stock file saved: ${outPath}`);
}

// -----------------------------
// MAIN
// -----------------------------
const weekArg = process.argv[2];

if (!weekArg || !/^week\d+$/i.test(weekArg)) {
  console.error('❌ Використання: node stock-engine.js weekX');
  process.exit(1);
}

buildStock(weekArg);