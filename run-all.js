const fs = require('fs');
const path = require('path');
const {exec} = require('child_process');

// ---------------------------
// RUN HELPER
// ---------------------------
function run(cmd, label) {
  return new Promise((resolve, reject) => {
    console.log(`▶ ${label}`);
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`❌ Error during ${label}:`, stderr || err.message);
        return reject(err);
      }
      console.log(stdout);
      resolve();
    });
  });
}

// ---------------------------
// MAIN
// ---------------------------
async function main() {
  const date = process.argv[2];
  const tempDir = process.argv[3]; // tempDir передає server.js

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('❌ No valid date provided (YYYY-MM-DD)');
    process.exit(1);
  }

  if (!tempDir) {
    console.error('❌ No temp directory provided to run-all.js');
    process.exit(1);
  }

  // ---------------------------
  // Detect files in temp
  // ---------------------------

  // PLAN MODE file (optional in REPORT MODE)
  const salesPath = path.join(tempDir, 'salesPlan.xlsx');

  // REPORT MODE file (dynamic name like 29.01_transportPlan.xlsx)
  const transportFile = fs
    .readdirSync(tempDir)
    .find((f) => f.toLowerCase().endsWith('_transportplan.xlsx'));

  const transportPath = transportFile ? path.join(tempDir, transportFile) : null;

  // Determine mode
  const isReportMode = !!transportFile && !fs.existsSync(salesPath);
  const isPlanMode = fs.existsSync(salesPath);

  // ---------------------------
  // Validate
  // ---------------------------

  if (!transportPath) {
    console.error(`❌ No transport plan found in temp (expected *_transportPlan.xlsx)`);
    process.exit(1);
  }

  if (isPlanMode && !fs.existsSync(salesPath)) {
    console.error(`❌ Missing salesPlan.xlsx in temp: ${salesPath}`);
    process.exit(1);
  }

  console.log(`📁 Using temp directory: ${tempDir}`);
  console.log(`📄 Transport file detected: ${transportFile}`);
  console.log(`🔍 Mode: ${isReportMode ? 'REPORT MODE' : 'PLAN MODE'}`);

  const templatePath = path.join(__dirname, 'client-template.xlsx');

  // ---------------------------
  // REPORT MODE scripts
  // ---------------------------
  const reportScripts = [
    {file: 'generate-reports.js', label: 'generate-reports.js', args: `"${tempDir}"`},
    {file: 'fill-template-loading.js', label: 'fill-template-loading.js', args: `"${tempDir}"`},
    {file: 'fill-template-client.js', label: 'fill-template-client.js', args: `"${templatePath}"`},
    {file: 'fill-shipping-card.js', label: 'fill-shipping-card.js', args: `"${tempDir}"`},
    {file: 'fill-template-clean.js', label: 'fill-template-clean.js', args: `"${tempDir}"`},
  ];

  try {
    console.log(`🚀 Starting full report generation for ${date}\n`);

    // REPORT MODE → запускаємо тільки REPORT-скрипти
    for (const {file, label, args} of reportScripts) {
      const scriptPath = path.join(__dirname, file);
      const cmd = `node "${scriptPath}" ${date} ${args}`;
      await run(cmd, label);
    }

    console.log(`✅ @@@DONE:${date}`);
  } catch {
    process.exit(1);
  }
}

main();
