// =====================
// Глобальні змінні
// =====================
let selectedFiles = [];
let generatedPath = null;

let containersPlan = [];
let ggnData = [];
let currentChamberNum = null;
let currentSide = null;
let currentWeek = null;
let weekContainers = [];

// =====================
// DOM-елементи
// =====================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const selectBtn = document.getElementById('selectBtn');
const generateBtn = document.getElementById('generateBtn');
const dateInput = document.getElementById('reportDate');   // для звіту
const weekInput = document.getElementById('weekInput');     // для плану

// Модалки повідомлень
const modal = document.getElementById('modalMessage');
const modalText = document.getElementById('modalMessageText');
const modalOkBtn = document.getElementById('modalOkBtn');

// Модалка для тижня (plan)
const modalWeekPrompt = document.getElementById('modalWeekPrompt');

// Модалки камер
const containerSelect = document.getElementById('containerSelect');
const formModal = document.getElementById('form-modal');
const sideModal = document.getElementById('side-modal');
const modalTitle = document.getElementById('modal-title');

// =====================
// Допоміжні функції
// =====================
function getMode() {
  return document.body.dataset.mode?.toLowerCase();
}

function showModalMessage(message) {
  modalText.innerHTML = message;
  modal.style.display = 'flex';
}

function setWeek(week) {
  currentWeek = week;
  weekContainers = [];
  console.log(`Тиждень встановлено: ${currentWeek}`);
}

// =====================
// Вибір файлів
// =====================
selectBtn?.addEventListener('click', () => {
  fileInput?.click();
});

fileInput?.addEventListener('change', (event) => {
  selectedFiles = Array.from(event.target.files);
  if (selectedFiles.length > 0) {
    generateBtn.style.display = 'inline-block';
    dropZone.innerHTML = `Selected: <strong>${selectedFiles.map((f) => f.name).join(', ')}</strong>`;
  }
});

// =====================
// Генерація
// =====================
generateBtn?.addEventListener('click', () => {
  const mode = getMode();

  if (mode === 'plan') {
    weekInput.value = '';
    modalWeekPrompt.style.display = 'flex';
  } else if (mode === 'report') {
    handleDailyReport();
  } else if (mode === 'rippening') {
    handleRippening();
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
  if (!week || isNaN(week) || Number(week) < 1 || Number(week) >= 52) {
    return alert('⚠️ Please enter a valid week number (1–52).');
  }

  modalWeekPrompt.style.display = 'none';
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';

  try {
    const response = await fetch(`/api/generate-plan?week=${week}`);
    const text = await response.text();

    let result;
    try {
      result = JSON.parse(text);
    } catch (err) {
      console.error('❌ Not a JSON:', text);
      showModalMessage('❌ Server did not return valid JSON. Check logs.');
      return;
    }

    if (result.message?.includes('✅')) {
      generatedPath = `${week}_Week`;
      showModalMessage(
        `✅ Plan for <strong>week ${week}</strong> generated.<br>Check <code>/output/${generatedPath}</code>`
      );
    } else {
      showModalMessage(result.message || '❌ Failed to generate plan.');
    }
  } catch (err) {
    console.error(err);
    showModalMessage('❌ Something went wrong.');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Report';
  }
});

// =====================
// Щоденний звіт
// =====================
async function handleDailyReport() {
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
        `✅ Report for <strong>${result.date}</strong> generated.<br>See <code>/output/${result.date}</code>`
      );
    } else {
      showModalMessage('❌ Failed to generate report.');
    }
  } catch (err) {
    console.error(err);
    showModalMessage('❌ Something went wrong.');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Report';
  }
}

// =====================
// Модалка повідомлень
// =====================
modalOkBtn?.addEventListener('click', () => {
  modal.style.display = 'none';
  if (generatedPath) {
    window.open(`/output/${generatedPath}`, '_blank');
  }
});

// =====================
// Камери
// =====================
async function loadData() {
  containersPlan = await fetch('/data/containersPlan.json').then((r) => r.json());
  ggnData = await fetch('/data/ggnData.json').then((r) => r.json());

  containersPlan.forEach((c) => {
    const option = document.createElement('option');
    option.value = c.number;
    option.textContent = c.number;
    containerSelect.appendChild(option);
  });
}

document.querySelectorAll('.page__chamber').forEach((chamber) => {
  chamber.addEventListener('click', () => {
    currentChamberNum = chamber.dataset.num;
    chamber.classList.add('open');
    sideModal.classList.add('active');
  });
});

document.querySelectorAll('.side-buttons button').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentSide = btn.dataset.side;
    modalTitle.textContent = `Chamber ${currentChamberNum} ${currentSide}`;
    sideModal.classList.remove('active');
    formModal.classList.add('active');
  });
});

document.querySelectorAll('.chamber-modal__close').forEach((btn) => {
  btn.addEventListener('click', () => {
    formModal.classList.remove('active');
    sideModal.classList.remove('active');
    document.querySelectorAll('.page__chamber.open').forEach((c) => c.classList.remove('open'));
  });
});

containerSelect.addEventListener('change', () => {
  const selected = containersPlan.find((c) => c.number === containerSelect.value);
  if (!selected) return;

  document.getElementById('quantity').value = selected.quantity;
  document.getElementById('brand').value = selected.brand;
  document.getElementById('plantationCode').value = selected.plantationCode || '';

  if (selected.plantationCode) {
    const plantationInfo = ggnData.find((g) => g.plantationCode === selected.plantationCode);
    if (plantationInfo) {
      document.getElementById('country').value = plantationInfo.country;
      document.getElementById('region').value = plantationInfo.region;
    }
  }
});

formModal.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.chamber = currentChamberNum;
  data.side = currentSide;

  weekContainers.push(data);

  e.target.reset();
  formModal.classList.remove('active');
  document.querySelectorAll('.page__chamber.open').forEach((c) => c.classList.remove('open'));
});

// =====================
// Збереження даних
// =====================
document.getElementById('saveWeekBtn').addEventListener('click', async () => {
  if (weekContainers.length === 0) return alert('Дані порожні!');

  try {
    const response = await fetch(`/api/save-week?week=${currentWeek || ''}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(weekContainers),
    });
    const result = await response.json();
    alert(result.message);
  } catch (err) {
    console.error(err);
    alert('❌ Помилка збереження');
  }
});

// =====================
// Ініціалізація
// =====================
loadData();
