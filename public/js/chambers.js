let containersPlan = [];
let ggnData = [];
let currentChamberNum = null;
let currentSide = null;
let currentWeek = null;
let weekContainers = [];

// DOM
const containerSelect = document.getElementById('containerSelect');
const formModal = document.getElementById('form-modal');
const sideModal = document.getElementById('side-modal');
const modalTitle = document.getElementById('modal-title');

// =====================
// Завантаження даних
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

loadData();

// =====================
// Вибір камери
// =====================
document.querySelectorAll('.page__chamber').forEach((chamber) => {
  chamber.addEventListener('click', () => {
    currentChamberNum = chamber.dataset.num;
    chamber.classList.add('open');
    sideModal.classList.add('active');
  });
});

// =====================
// Вибір сторони
// =====================
document.querySelectorAll('.side-buttons button').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentSide = btn.dataset.side;
    modalTitle.textContent = `Chamber ${currentChamberNum} ${currentSide}`;
    sideModal.classList.remove('active');
    formModal.classList.add('active');
  });
});

// =====================
// Закриття модалок
// =====================
document.querySelectorAll('.chamber-modal__close').forEach((btn) => {
  btn.addEventListener('click', () => {
    formModal.classList.remove('active');
    sideModal.classList.remove('active');
    document.querySelectorAll('.page__chamber.open').forEach((c) => c.classList.remove('open'));
  });
});

// =====================
// Вибір контейнера
// =====================
containerSelect?.addEventListener('change', () => {
  const selected = containersPlan.find((c) => c.number === containerSelect.value);
  if (!selected) return;

  document.getElementById('quantity').value = selected.quantity;
  document.getElementById('brand').value = selected.brand;
  document.getElementById('plantationCode').value = selected.plantationCode || '';

  if (selected.plantationCode) {
    const info = ggnData.find((g) => g.plantationCode === selected.plantationCode);
    if (info) {
      document.getElementById('country').value = info.country;
      document.getElementById('region').value = info.region;
    }
  }
});

// =====================
// Збереження контейнера
// =====================
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
// Збереження тижня
// =====================
document.getElementById('saveWeekBtn')?.addEventListener('click', async () => {
  if (weekContainers.length === 0) return alert('Дані порожні!');

  try {
    const response = await fetch(`/api/save-week?week=${currentWeek || ''}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(weekContainers),
    });

    const result = await response.json();
    alert(result.message);
  } catch {
    alert('❌ Помилка збереження');
  }
});
