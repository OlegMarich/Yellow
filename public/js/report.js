let selectedFiles = [];
window.generatedPath = null;

const fileInput = document.getElementById('fileInput');
const selectBtn = document.getElementById('selectBtn');
const generateBtn = document.getElementById('generateBtn');
const dateInput = document.getElementById('reportDate');
const modal = document.getElementById('modalMessage');
const modalText = document.getElementById('modalMessageText');
const modalOkBtn = document.getElementById('modalOkBtn');

selectBtn?.addEventListener('click', () => fileInput?.click());

// ---------------------------
// SAFE FILE READING (fixes ERR_UPLOAD_FILE_CHANGED)
// ---------------------------
fileInput?.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files);

  selectedFiles = await Promise.all(
    files.map(async (file) => {
      const arrayBuffer = await file.arrayBuffer();
      return new File([arrayBuffer], file.name, {type: file.type});
    }),
  );
});

generateBtn?.addEventListener('click', handleDailyReport);

modalOkBtn?.addEventListener('click', () => {
  modal.style.display = 'none';
});

// ---------------------------
// Helpers
// ---------------------------
function getISOWeek(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return `week${Math.floor((date - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1}`;
}

function showModalMessage(message) {
  modalText.innerHTML = message;
  modal.style.display = 'block';
}

// ---------------------------
// MAIN REPORT GENERATION
// ---------------------------
async function handleDailyReport() {
  const date = dateInput?.value;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return showModalMessage('⚠️ Please select a valid date.');
  }

  // ТЕПЕР ПОТРІБЕН ЛИШЕ 1 ФАЙЛ
  if (selectedFiles.length < 1) {
    return showModalMessage('⚠️ Please select the transport plan file.');
  }

  const file = selectedFiles[0];
  if (!file || file.size === 0) {
    return showModalMessage(`⚠️ File "${file?.name}" is unavailable or empty.`);
  }

  // Формально FormData більше не потрібен, але залишимо для сумісності
  const formData = new FormData();
  formData.append('file', file);

  try {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';

    const response = await fetch(`/api/run-all?date=${encodeURIComponent(date)}`, {
      method: 'POST',
      body: formData, // сервер просто ігнорує файли — це ок
    });

    const result = await response.json();

    if (result.success) {
      window.generatedPath = result.date;
      showModalMessage(`✅ Report for <strong>${result.date}</strong> generated.`);
    } else {
      showModalMessage(`❌ Failed to generate report: ${result.message || 'Unknown error'}`);
    }
  } catch (err) {
    showModalMessage('❌ Something went wrong while generating the report.');
    console.error('❌ Fetch error:', err);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Report';
    selectedFiles = [];
    fileInput.value = '';
  }
}

// ---------------------------
// PARSE SALES PLAN
// ---------------------------
const parseSalesBtn = document.getElementById('parseSalesBtn');
const salesFileInput = document.getElementById('salesFileInput');

parseSalesBtn?.addEventListener('click', () => {
  salesFileInput?.click();
});

salesFileInput?.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  const date = dateInput?.value;

  if (!file) return showModalMessage('⚠️ Please select a sales.xlsx file.');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return showModalMessage('⚠️ Please select a valid date.');
  }

  const week = getISOWeek(date);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('week', week);

  try {
    parseSalesBtn.disabled = true;
    parseSalesBtn.textContent = 'Parsing...';

    const response = await fetch('/api/parse-sales', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (result.success) {
      showModalMessage(`✅ Sales plan for <strong>${week}</strong> parsed successfully.`);
    } else {
      showModalMessage('❌ Failed to parse sales plan.');
    }
  } catch {
    showModalMessage('❌ Something went wrong while parsing sales plan.');
  } finally {
    parseSalesBtn.disabled = false;
    parseSalesBtn.textContent = 'Parse Sales Plan';
    salesFileInput.value = '';
  }
});
