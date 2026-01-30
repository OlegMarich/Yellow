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
  const tempDir = process.argv[3]; // 🔥 тепер tempDir передає server.js

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('❌ No valid date provided (YYYY-MM-DD)');
    process.exit(1);
  }

  if (!tempDir) {
    console.error('❌ No temp directory provided to run-all.js');
    process.exit(1);
  }

  // Перевіряємо, чи є файли
  const salesPath = path.join(tempDir, 'salesPlan.xlsx');
  const transportPath = path.join(tempDir, 'transportPlan.xlsx');

  if (!fs.existsSync(salesPath)) {
    console.error(`❌ Missing salesPlan.xlsx in temp: ${salesPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(transportPath)) {
    console.error(`❌ Missing transportPlan.xlsx in temp: ${transportPath}`);
    process.exit(1);
  }

  console.log(`📁 Using temp directory: ${tempDir}`);

  const templatePath = path.join(__dirname, 'client-template.xlsx');

  const scripts = [
    {file: 'generate-reports.js', label: 'generate-reports.js', args: `"${tempDir}"`},
    {file: 'fill-template-loading.js', label: 'fill-template-loading.js', args: `"${tempDir}"`},
    {file: 'fill-template-client.js', label: 'fill-template-client.js', args: `"${templatePath}"`},
    {file: 'fill-shipping-card.js', label: 'fill-shipping-card.js', args: `"${tempDir}"`},
    {file: 'fill-template-clean.js', label: 'fill-template-clean.js', args: `"${tempDir}"`},
  ];

  try {
    console.log(`🚀 Starting full report generation for ${date}\n`);

    for (const {file, label, args} of scripts) {
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
