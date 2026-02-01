// ============================================================
// HELPERS
// ============================================================

function getISOWeek(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return `week${Math.floor((date - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1}`;
}

function parseQty(v) {
  if (typeof v === 'string') v = v.replace(',', '.').trim();
  return Number(v) || 0;
}

// ============================================================
// GLOBAL STATE
// ============================================================

let transportData = [];
let selectedClient = null;
let expectedQty = 0;
let expectedPal = 0;

let scanned = {}; // scanned[containerId] = count
let status = 'NEW'; // NEW / IN_PROGRESS / COMPLETED / CANCELED

let lastPlusTap = 0;
let plusHoldTimeout = null;

// ============================================================
// SESSION KEY
// ============================================================

function sessionKey() {
  const date = document.getElementById('scanDate').value || 'no-date';
  const client = selectedClient || 'no-client';
  return `scannerSession::${date}::${client}`;
}

// ============================================================
// UNIVERSAL QR CODE (LOCAL + NGROK AUTO-DETECT)
// ============================================================

async function initUniversalQR() {
  const qrBox = document.getElementById('qrBox');
  const qrStatus = document.getElementById('qrStatus');

  if (!qrBox || !window.QRCode) {
    console.warn('QR: qrBox або QRCode не знайдено');
    return;
  }

  let currentUrl = null;

  const setStatus = (text) => {
    if (qrStatus) qrStatus.textContent = text;
  };

  const renderQR = (url) => {
    if (!url || url === currentUrl) return;
    currentUrl = url;

    qrBox.innerHTML = '';
    new QRCode(qrBox, {
      text: url,
      width: 180,
      height: 180,
    });

    console.log('QR updated:', url);
  };

  const getLocalUrl = async () => {
    const res = await fetch('/api/server-ip');
    const {ip, port} = await res.json();
    return `http://${ip}:${port}/components/scanner.html`;
  };

  const getNgrokUrl = async () => {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels');
    const data = await res.json();
    const httpsTunnel = data.tunnels.find((t) => t.public_url.startsWith('https://'));
    return httpsTunnel ? `${httpsTunnel.public_url}/components/scanner.html` : null;
  };

  // 1) Спочатку показуємо локальний URL
  try {
    const localUrl = await getLocalUrl();
    renderQR(localUrl);
    setStatus('Режим: локальна мережа (HTTP)');
  } catch (e) {
    console.error('QR: не вдалося отримати локальний IP', e);
    setStatus('Помилка: немає доступу до локального IP');
  }

  // 2) Перевіряємо ngrok кожні 5 секунд
  const pollNgrok = async () => {
    try {
      const ngrokUrl = await getNgrokUrl();

      if (ngrokUrl) {
        renderQR(ngrokUrl);
        setStatus('Режим: віддалений доступ через ngrok (HTTPS)');
      } else {
        const localUrl = await getLocalUrl();
        if (currentUrl !== localUrl) {
          renderQR(localUrl);
          setStatus('Режим: локальна мережа (HTTP)');
        }
      }
    } catch (e) {
      console.warn('QR: ngrok недоступний, залишаємо локальний режим');
    }
  };

  setTimeout(pollNgrok, 2000);
  setInterval(pollNgrok, 5000);
}

window.addEventListener('DOMContentLoaded', () => {
  initUniversalQR();
});
// ============================================================
// LOAD ORDERS
// ============================================================

document.getElementById('loadOrders').addEventListener('click', async () => {
  const date = document.getElementById('scanDate').value;
  if (!date) {
    alert('Виберіть дату');
    return;
  }

  const [y, m, d] = date.split('-');
  const fileName = `${d}.${m}_transportPlanData.json`;
  const weekArg = getISOWeek(date);

  try {
    const res = await fetch(`/storage/${weekArg}/${fileName}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);

    transportData = await res.json();
    fillClientList();
    log('✅ Замовлення завантажено');
  } catch (e) {
    console.error(e);
    log('❌ Не вдалося завантажити JSON замовлень');
  }
});

// ============================================================
// FILL CLIENT LIST
// ============================================================

function fillClientList() {
  const select = document.getElementById('clientSelect');
  select.innerHTML = `<option value="">— виберіть клієнта —</option>`;

  const unique = new Set();

  transportData.forEach((e) => {
    const name = `${e.customer?.short || 'UNKNOWN'} ${e.locationCountry || ''} - ${e.location || ''}`;
    unique.add(name);
  });

  [...unique].sort().forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

// ============================================================
// CLIENT SELECTED
// ============================================================

document.getElementById('clientSelect').addEventListener('change', () => {
  selectedClient = document.getElementById('clientSelect').value;
  if (!selectedClient) return;

  const filtered = transportData.filter((e) => {
    const name = `${e.customer?.short || 'UNKNOWN'} ${e.locationCountry || ''} - ${e.location || ''}`;
    return name === selectedClient;
  });

  expectedQty = filtered.reduce((s, e) => s + parseQty(e.qty), 0);
  expectedPal = filtered.reduce((s, e) => s + parseQty(e.pal), 0);

  loadSession();
  updateProgress();
  updateStatusUI();

  document.getElementById('scanInput').focus();
});

// ============================================================
// PALLET CALCULATION
// ============================================================

document.getElementById('rowsCount').addEventListener('input', updatePalletCalc);
document.getElementById('palletHeight').addEventListener('input', updatePalletCalc);

function updatePalletCalc() {
  const rows = Number(document.getElementById('rowsCount').value) || 0;
  const height = Number(document.getElementById('palletHeight').value) || 0;
  const total = rows * height;

  document.getElementById('palletCheck').textContent =
    `Розрахунок: ${rows} рядів × ${height} ящиків = ${total} ящиків`;
}

// ============================================================
// SCAN MODE UI
// ============================================================

document.getElementById('scanMode').addEventListener('change', applyScanModeUI);

function applyScanModeUI() {
  const mode = document.getElementById('scanMode').value;
  const qtyInput = document.getElementById('qtyInput');
  const plusBtn = document.getElementById('manualPlusBtn');

  if (mode === 'auto') {
    qtyInput.disabled = true;
    plusBtn.style.display = 'none';
  } else {
    qtyInput.disabled = false;
    plusBtn.style.display = 'inline-flex';
  }
}

// ============================================================
// SCAN INPUT
// ============================================================

document.getElementById('scanInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (status === 'COMPLETED') {
      alert('Замовлення завершене. Редагування недоступне.');
      return;
    }

    const code = e.target.value.trim();
    if (!code) return;

    const mode = document.getElementById('scanMode').value;

    if (mode === 'auto') {
      addScan(code, 1);
    } else {
      const qty = Number(document.getElementById('qtyInput').value) || 1;
      addScan(code, qty);
    }

    status = 'IN_PROGRESS';
    saveSession();
    updateStatusUI();

    e.target.value = '';
  }
});

// ============================================================
// MANUAL "+" BUTTON
// ============================================================

const manualPlusBtn = document.getElementById('manualPlusBtn');

manualPlusBtn.addEventListener('click', () => {
  if (status === 'COMPLETED') {
    alert('Замовлення завершене. Редагування недоступне.');
    return;
  }

  const now = Date.now();
  const mode = document.getElementById('scanMode').value;
  if (mode !== 'manual') return;

  if (now - lastPlusTap < 400) {
    openManualKeyboard();
  } else {
    incrementManual(1);
  }

  lastPlusTap = now;
});

manualPlusBtn.addEventListener('mousedown', () => {
  const mode = document.getElementById('scanMode').value;
  if (mode !== 'manual') return;

  plusHoldTimeout = setTimeout(() => {
    openManualKeyboard();
  }, 500);
});

manualPlusBtn.addEventListener('mouseup', () => clearTimeout(plusHoldTimeout));
manualPlusBtn.addEventListener('mouseleave', () => clearTimeout(plusHoldTimeout));

function incrementManual(n) {
  const code = document.getElementById('scanInput').value.trim();
  if (!code) return;

  addScan(code, n);
  status = 'IN_PROGRESS';
  saveSession();
  updateStatusUI();
}

// ============================================================
// ADD SCAN
// ============================================================

function addScan(containerId, qty) {
  if (!scanned[containerId]) scanned[containerId] = 0;
  scanned[containerId] += qty;

  if (scanned[containerId] <= 0) delete scanned[containerId];

  saveSession();
  updateLog();
  updateProgress();
}

// ============================================================
// CAMERA + OCR
// ============================================================

const cameraBtn = document.getElementById('cameraScanBtn');
const cameraInput = document.getElementById('cameraInput');
const previewImg = document.getElementById('preview');

cameraBtn.addEventListener('click', () => cameraInput.click());

cameraInput.addEventListener('change', async (e) => {
  if (status === 'COMPLETED') {
    alert('Замовлення завершене. Редагування недоступне.');
    return;
  }

  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewImg.style.display = 'block';

  log('📷 Обробка фото...');

  try {
    const result = await Tesseract.recognize(url, 'eng', {logger: () => {}});
    const text = result.data.text || '';
    const match = text.match(/[A-Z]{4}\d{7}/i);

    if (match) {
      const code = match[0].toUpperCase();
      const mode = document.getElementById('scanMode').value;
      const qty = mode === 'manual' ? Number(document.getElementById('qtyInput').value) || 1 : 1;

      addScan(code, qty);
      status = 'IN_PROGRESS';
      saveSession();
      updateStatusUI();

      log(`✅ Знайдено контейнер: ${code}`);
    } else {
      log('❌ Не вдалося розпізнати номер контейнера');
    }
  } catch (err) {
    console.error(err);
    log('❌ Помилка OCR');
  }
});

// ============================================================
// UNDO
// ============================================================

document.getElementById('undoBtn').addEventListener('click', () => {
  if (status === 'COMPLETED') {
    alert('Замовлення завершене. Редагування недоступне.');
    return;
  }

  const keys = Object.keys(scanned);
  if (keys.length === 0) return;

  const last = keys[keys.length - 1];
  scanned[last]--;

  if (scanned[last] <= 0) delete scanned[last];

  status = 'IN_PROGRESS';
  saveSession();
  updateLog();
  updateProgress();
  updateStatusUI();
});

// ============================================================
// FINISH CLIENT (MOVE TO IN_PROGRESS)
// ============================================================

document.getElementById('finishBtn').addEventListener('click', async () => {
  if (!selectedClient) {
    alert('Виберіть клієнта');
    return;
  }

  if (status === 'COMPLETED') {
    alert('Замовлення вже завершене.');
    return;
  }

  status = 'IN_PROGRESS';
  stopVideoScanner();
  saveSession();
  updateStatusUI();

  alert('Замовлення позначене як опрацьоване. Перевірте та підтвердіть.');
});

// ============================================================
// STATUS UI
// ============================================================

function updateStatusUI() {
  const el = document.getElementById('orderStatus');
  if (!el) return;

  el.className = 'order-status';

  if (status === 'NEW') {
    el.classList.add('order-status--new');
    el.textContent = '🟢 Неопрацьоване замовлення';
  }

  if (status === 'IN_PROGRESS') {
    el.classList.add('order-status--progress');
    el.textContent = '🟡 Опрацьоване — потребує підтвердження';
  }

  if (status === 'COMPLETED') {
    el.classList.add('order-status--completed');
    el.textContent = '🔵 Завершене замовлення';
  }

  if (status === 'CANCELED') {
    el.classList.add('order-status--canceled');
    el.textContent = '🔴 Скасоване замовлення';
  }
}

// ============================================================
// COMPLETE ORDER (MOVE TO COMPLETED)
// ============================================================

window.completeOrder = function () {
  if (status !== 'IN_PROGRESS') {
    alert('Спочатку опрацюйте замовлення.');
    return;
  }

  status = 'COMPLETED';
  saveSession();
  updateStatusUI();

  sendToStock();
};

// ============================================================
// CANCEL ORDER
// ============================================================

window.cancelOrder = function () {
  if (!confirm('Скасувати замовлення?')) return;

  status = 'CANCELED';
  saveSession();
  updateStatusUI();
};

// ============================================================
// SEND TO STOCK (placeholder)
// ============================================================

function sendToStock() {
  console.log('📦 Передача в сток (поки заглушка)');
}

// ============================================================
// LOCAL STORAGE
// ============================================================

function saveSession() {
  try {
    const key = sessionKey();
    localStorage.setItem(
      key,
      JSON.stringify({
        scanned,
        expectedQty,
        expectedPal,
        status,
      }),
    );
  } catch (e) {
    console.warn('localStorage error', e);
  }
}

function loadSession() {
  try {
    const key = sessionKey();
    const raw = localStorage.getItem(key);
    if (!raw) {
      scanned = {};
      status = 'NEW';
      updateLog();
      return;
    }
    const data = JSON.parse(raw);
    scanned = data.scanned || {};
    status = data.status || 'NEW';
    updateLog();
  } catch (e) {
    console.warn('localStorage load error', e);
  }
}

// ============================================================
// UI HELPERS
// ============================================================

function updateLog() {
  const logBox = document.getElementById('log');
  logBox.innerHTML = '';

  Object.entries(scanned).forEach(([container, count]) => {
    const div = document.createElement('div');
    div.className = 'scanner__log-item';

    const disabled = status === 'COMPLETED' ? 'disabled' : '';

    div.innerHTML = `
      <span>${container}: ${count} шт.</span>
      <span>
        <button ${disabled} onclick="window.editScan('${container}')">✏️</button>
        <button ${disabled} onclick="window.deleteScan('${container}')">❌</button>
      </span>
    `;

    logBox.appendChild(div);
  });
}

function updateProgress() {
  const totalScanned = Object.values(scanned).reduce((s, v) => s + v, 0);

  document.getElementById('rowCheck').textContent =
    `Очікується: ${expectedQty} ящиків, ${expectedPal} палет — ` +
    `Відскановано: ${totalScanned} ящиків`;
}

function log(msg) {
  const logBox = document.getElementById('log');
  const div = document.createElement('div');
  div.textContent = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

// ============================================================
// EDIT / DELETE
// ============================================================

window.editScan = function (containerId) {
  if (status === 'COMPLETED') {
    alert('Замовлення завершене. Редагування недоступне.');
    return;
  }

  const current = scanned[containerId] || 0;
  const newQtyStr = prompt('Нова кількість:', current);
  if (newQtyStr === null) return;

  const newQty = Number(newQtyStr) || 0;
  if (newQty <= 0) delete scanned[containerId];
  else scanned[containerId] = newQty;

  status = 'IN_PROGRESS';
  saveSession();
  updateLog();
  updateProgress();
  updateStatusUI();
};

window.deleteScan = function (containerId) {
  if (status === 'COMPLETED') {
    alert('Замовлення завершене. Редагування недоступне.');
    return;
  }

  if (!confirm(`Видалити контейнер ${containerId}?`)) return;

  delete scanned[containerId];

  status = 'IN_PROGRESS';
  saveSession();
  updateLog();
  updateProgress();
  updateStatusUI();
};

// ============================================================
// MODAL KEYPAD
// ============================================================

window.openManualKeyboard = function () {
  const modal = document.getElementById('manualKeyboard');
  const input = document.getElementById('manualQty');
  input.value = '';
  modal.classList.add('active');
};

window.closeManualKeyboard = function () {
  document.getElementById('manualKeyboard').classList.remove('active');
};

window.numPress = function (n) {
  const input = document.getElementById('manualQty');
  input.value += String(n);
};

window.backspaceQty = function () {
  const input = document.getElementById('manualQty');
  input.value = input.value.slice(0, -1);
};

window.clearQty = function () {
  document.getElementById('manualQty').value = '';
};

window.confirmManualQty = function () {
  const qty = Number(document.getElementById('manualQty').value);
  if (qty > 0) incrementManual(qty);
  window.closeManualKeyboard();
};

// ============================================================
// VIDEO SCANNER (ZXing)
// ============================================================

let videoStream = null;
let codeReader = null;
let lastScanned = null;

async function stopVideoScanner() {
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
  }
  const video = document.getElementById('videoScanner');
  video.style.display = 'none';
  log('⏹ Відео‑сканер вимкнено');
}

document.getElementById('startVideoScanner').addEventListener('click', async () => {
  if (!selectedClient) {
    alert('Спочатку виберіть клієнта');
    return;
  }

  const video = document.getElementById('videoScanner');
  video.style.display = 'block';

  try {
    codeReader = new ZXing.BrowserMultiFormatReader();

    // 1) Спочатку пробуємо задню камеру (без exact — Samsung це блокує)
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'environment'},
      });
    } catch (e) {
      // 2) Якщо не вдалося — пробуємо будь-яку доступну камеру
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
    }

    video.srcObject = videoStream;

    codeReader.decodeFromVideoDevice(null, video, (result, err) => {
      if (result) {
        const code = result.text.trim();

        if (code !== lastScanned) {
          lastScanned = code;
          navigator.vibrate?.(100);
          addScan(code, 1);
          saveSession();
          updateStatusUI();
          updateProgress();
          updateLog();
        }
      }
    });

    log('🎥 Відео‑сканер увімкнено');
  } catch (err) {
    console.error(err);
    log('❌ Не вдалося увімкнути відео‑сканер');
  }
});
