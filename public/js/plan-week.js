// =====================
// Глобальні змінні
// =====================
let selectedFiles = [];
let generatedPath = null;

// =====================
// DOM
// =====================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const selectBtn = document.getElementById('selectBtn');
const generateBtn = document.getElementById('generateBtn');
const weekInput = document.getElementById('weekInput');
const modalWeekPrompt = document.getElementById('modalWeekPrompt');

// =====================
// Показати кнопку одразу у PLAN MODE
// =====================
if (document.body.dataset.mode === 'plan') {
  generateBtn.style.display = 'inline-block';
}

// =====================
// Вибір файлів (для REPORT MODE)
// =====================
selectBtn?.addEventListener('click', () => fileInput?.click());

fileInput?.addEventListener('change', (event) => {
  selectedFiles = Array.from(event.target.files);

  if (document.body.dataset.mode !== 'plan' && selectedFiles.length > 0) {
    generateBtn.style.display = 'inline-block';
    dropZone.innerHTML = `Selected: <strong>${selectedFiles.map((f) => f.name).join(', ')}</strong>`;
  }
});

// =====================
// Кнопка Generate
// =====================
generateBtn?.addEventListener('click', () => {
  const mode = document.body.dataset.mode;

  if (mode === 'plan') {
    weekInput.value = '';
    modalWeekPrompt.style.display = 'flex';
  } else if (mode === 'report') {
    handleDailyReport();
  } else {
    alert('❌ Unknown mode. Set <body data-mode="plan"> або "report".');
  }
});

// =====================
// Модалка тижня
// =====================
document.getElementById('cancelWeekBtn')?.addEventListener('click', () => {
  modalWeekPrompt.style.display = 'none';
});

document.getElementById('confirmWeekBtn')?.addEventListener('click', async () => {
  const week = weekInput.value.trim();

  if (!week || isNaN(week) || week < 1 || week > 53) {
    return alert('⚠️ Please enter a valid week number (1–53).');
  }

  modalWeekPrompt.style.display = 'none';
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';

  try {
    const response = await fetch(`/api/generate-plan?week=${week}`);

    if (!response.ok) {
      return showModalMessage(`❌ Server error: ${response.status}`);
    }

    const result = await response.json();

    if (result.message?.includes('✅')) {
      generatedPath = `week${week}`;
      showModalMessage(`✅ Plan for <strong>week ${week}</strong> generated.`);
    } else {
      showModalMessage(result.message || '❌ Failed to generate plan.');
    }
  } catch (err) {
    showModalMessage('❌ Network error or server unreachable.');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate';
  }
});

// =====================
// Модалка повідомлень
// =====================
function showModalMessage(message) {
  const modal = document.getElementById('modalMessage');
  const modalText = document.getElementById('modalMessageText');
  modalText.innerHTML = message;
  modal.style.display = 'flex';
}

document.getElementById('modalOkBtn')?.addEventListener('click', () => {
  const modal = document.getElementById('modalMessage');
  modal.style.display = 'none';

  if (generatedPath) {
    window.open(`/output/${generatedPath}`, '_blank');
  }
});

// =====================
// REPORT MODE (старий режим)
// =====================
async function handleDailyReport() {
  const dateInput = document.getElementById('reportDate');
  const date = dateInput?.value;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return showModalMessage('⚠️ Please select a valid date (YYYY-MM-DD).');
  }

  if (selectedFiles.length === 0) {
    return showModalMessage('⚠️ Please select both Excel files.');
  }

  const formData = new FormData();
  selectedFiles.forEach((file) => formData.append('files', file));

  try {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';

    const response = await fetch(`/upload?date=${date}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const result = await response.json();

    if (result.success) {
      generatedPath = result.date;
      showModalMessage(
        `✅ Report for <strong>${result.date}</strong> generated.<br>See <code>/output/${result.date}</code>`,
      );
    } else {
      showModalMessage('❌ Failed to generate report.');
    }
  } catch (err) {
    showModalMessage('❌ Something went wrong.');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate';
  }
}
