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
// Вибір файлів
// =====================
selectBtn?.addEventListener('click', () => fileInput?.click());

fileInput?.addEventListener('change', (event) => {
  selectedFiles = Array.from(event.target.files);

  if (selectedFiles.length > 0) {
    dropZone.innerHTML = `Selected: <strong>${selectedFiles.map((f) => f.name).join(', ')}</strong>`;
  }
});

// =====================
// Кнопка Generate
// =====================
generateBtn?.addEventListener('click', () => {
  weekInput.value = '';
  modalWeekPrompt.style.display = 'flex';
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

  if (selectedFiles.length === 0) {
    return showModalMessage('⚠️ Please select sales.xlsx file.');
  }

  modalWeekPrompt.style.display = 'none';
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';

  try {
    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append('files', file));

    const response = await fetch(`/upload-plan?week=${week}`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (result.success) {
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
