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
// BUSINESS DATE (09:00 → 09:00)
// ============================================================

function getBusinessDateNow() {
  const now = new Date();
  if (now.getHours() < 9) {
    now.setDate(now.getDate() - 1);
  }
  now.setHours(0, 0, 0, 0);
  return now;
}

function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getBusinessDateISO() {
  return formatDateISO(getBusinessDateNow());
}

// ============================================================
// GLOBAL STATE
// ============================================================

let currentStep = 0;

let transportData = [];
let selectedClient = null;
let currentDateISO = null;

let expectedQty = 0;
let expectedPal = 0;

let status = 'NEW';

let boxCounts = {};

let totalBoxes = 0;
let boxesPerPallet = 0;
let expectedPallets = 0;
let totalPallets = 0;

let side1Count = 0;
let side2Count = 0;

let scannedCodes = [];
let autofocusInterval = null;

const side1Input = document.getElementById('side1');
const side2Input = document.getElementById('side2');

// ============================================================
// SESSION KEY
// ============================================================

function sessionKey() {
  const date = document.getElementById('scanDate').value || currentDateISO || 'no-date';
  const client = selectedClient || 'no-client';
  return `scannerSession::${date}::${client}`;
}

// ============================================================
// UNIVERSAL QR (OPTIONAL)
// ============================================================

async function initUniversalQR() {
  const qrBox = document.getElementById('qrBox');
  const qrStatus = document.getElementById('qrStatus');
  const deviceDot = document.querySelector('.qr-device__dot');
  const deviceText = document.querySelector('.qr-device__text');

  if (!qrBox || !qrStatus || !deviceDot || !deviceText) return;

  let currentUrl = null;
  let lastDevicePing = 0;

  const setStatus = (text, loading = false) => {
    qrStatus.textContent = text;
    qrStatus.classList.toggle('qr-status--loading', loading);
  };

  const setDeviceStatus = (connected) => {
    if (connected) {
      deviceDot.classList.add('connected');
      deviceText.textContent = 'Mobile scanner connected';
    } else {
      deviceDot.classList.remove('connected');
      deviceText.textContent = 'No device connected';
    }
  };

  const renderQR = (url) => {
    currentUrl = url;
    qrBox.innerHTML = '';
    new QRCode(qrBox, {text: url, width: 180, height: 180});
  };

  const getServerUrl = async () => {
    try {
      const res = await fetch('/api/server-info');
      const data = await res.json();
      return data.lanUrl + '/components/scanner.html';
    } catch {
      return null;
    }
  };

  const placeholder = 'http://waiting-for-server.local';
  renderQR(placeholder);
  setStatus('Waiting for server…', true);

  const pollServer = async () => {
    const serverUrl = await getServerUrl();
    if (serverUrl && currentUrl !== serverUrl) {
      renderQR(serverUrl);
      setStatus(`Server active — LAN URL: ${serverUrl}`);
    }
  };

  const pollDevice = async () => {
    try {
      const res = await fetch('/api/device-ping');
      const data = await res.json();

      if (data.serverTime && data.serverTime !== lastDevicePing) {
        lastDevicePing = data.serverTime;
        setDeviceStatus(true);
      }
    } catch {
      setDeviceStatus(false);
    }
  };

  pollServer();
  pollDevice();

  setInterval(pollServer, 2000);
  setInterval(pollDevice, 1500);
}

window.initUniversalQR = initUniversalQR;

// ============================================================
// PREFETCH WEEK ORDERS
// ============================================================

async function listWeekFiles(weekArg) {
  try {
    const res = await fetch(`/api/list-week?week=${encodeURIComponent(weekArg)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('listWeekFiles error', e);
    return [];
  }
}

function extractDateFromFilename(fileName, yearFallback) {
  const m = /^(\d{2})\.(\d{2})_transportPlanData\.json$/i.exec(fileName);
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  const y = yearFallback || new Date().getFullYear();
  return `${y}-${mm}-${dd}`;
}

async function downloadAndCacheFile(weekArg, fileName, dateISO) {
  const cacheKey = `orders::${dateISO}`;
  if (localStorage.getItem(cacheKey)) return;

  try {
    const res = await fetch(`/storage/${weekArg}/${fileName}`);
    if (!res.ok) return;
    const json = await res.json();
    localStorage.setItem(cacheKey, JSON.stringify(json));
    console.log('[PREFETCH] cached', dateISO, fileName);
  } catch (e) {
    console.warn('downloadAndCacheFile error', fileName, e);
  }
}

async function prefetchWeekOrders() {
  const bizDate = getBusinessDateNow();
  const dateISO = formatDateISO(bizDate);
  const weekArg = getISOWeek(dateISO);
  const year = bizDate.getFullYear();

  console.log('[PREFETCH] business date:', dateISO, 'week:', weekArg);

  const files = await listWeekFiles(weekArg);
  if (!Array.isArray(files) || !files.length) {
    console.log('[PREFETCH] no files for week', weekArg);
    return;
  }

  const transportFiles = files.filter((f) => /_transportPlanData\.json$/i.test(f));

  for (const file of transportFiles) {
    const dateFromFile = extractDateFromFilename(file, year);
    if (!dateFromFile) continue;
    await downloadAndCacheFile(weekArg, file, dateFromFile);
  }
}

// ============================================================
// LOAD ORDERS (FROM CACHE ONLY)
// ============================================================

document.getElementById('loadOrders').addEventListener('click', async () => {
  const date = document.getElementById('scanDate').value;
  if (!date) {
    alert('Select a date');
    return;
  }

  currentDateISO = date;

  const cacheKey = `orders::${date}`;
  const raw = localStorage.getItem(cacheKey);

  if (!raw) {
    alert('No cached orders for this date. Ensure server was available when opening scanner.');
    return;
  }

  try {
    transportData = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse cached orders JSON', e);
    alert('Corrupted cached data for this date');
    return;
  }

  fillClientList();
  log('✅ Orders loaded from cache');
});

function initOrderCounters(order) {
  totalBoxes = Number(order.qty) || 0;
  boxesPerPallet = Number(order.product?.boxPerPal) || 0;
  expectedPallets = Number(order.pal) || 0;
  totalPallets = expectedPallets;

  side1Count = 0;
  side2Count = 0;

  boxCounts = {};

  updateProgress();
}

// ============================================================
// FILTER COMPLETED CLIENTS
// ============================================================

function isClientCompletedForDate(dateISO, clientName) {
  const key = `scannerSession::${dateISO}::${clientName}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data.status === 'COMPLETED';
  } catch {
    return false;
  }
}

function fillClientList() {
  const select = document.getElementById('clientSelect');
  select.innerHTML = `<option value="">— select a client —</option>`;

  const unique = new Set();

  transportData.forEach((e) => {
    const name = `${e.customer?.short || 'UNKNOWN'} ${e.locationCountry || ''} - ${e.location || ''}`;
    if (!currentDateISO) {
      unique.add(name);
    } else {
      if (!isClientCompletedForDate(currentDateISO, name)) {
        unique.add(name);
      }
    }
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

  const first = filtered[0];
  if (first) {
    initOrderCounters({
      qty: expectedQty,
      pal: expectedPal,
      product: first.product,
    });
  }

  loadSession();
  updateStatusUI();
  updateLog();
  updateProgress();
});

// ============================================================
// INITIALIZATION
// ============================================================

window.addEventListener('DOMContentLoaded', async () => {
  const scanDateInput = document.getElementById('scanDate');
  if (scanDateInput) {
    const bizISO = getBusinessDateISO();
    scanDateInput.value = bizISO;
    currentDateISO = bizISO;
  }

  await prefetchWeekOrders();
  initUniversalQR();
});

//ч2
// ============================================================
// PALLET CALCULATION (UI PREVIEW ONLY)
// ============================================================

document.getElementById('rowsCount').addEventListener('input', updatePalletCalc);
document.getElementById('palletHeight').addEventListener('input', updatePalletCalc);

function updatePalletCalc() {
  const rows = Number(document.getElementById('rowsCount').value) || 0;
  const height = Number(document.getElementById('palletHeight').value) || 0;

  document.getElementById('palletCheck').innerHTML =
    `<b>Rows:</b> ${rows}<br><b>Boxes per pallet (from plan):</b> ${boxesPerPallet || '?'}<br><b>Total pallets (from plan):</b> ${totalPallets || '?'}`;
}

// ============================================================
// STATUS UI
// ============================================================

function updateStatusUI() {
  const el = document.getElementById('orderStatus');
  if (!el) return;

  el.className = 'order-status';

  if (status === 'NEW') {
    el.classList.add('order-status--new');
    el.textContent = '🟢 Unprocessed order';
  }

  if (status === 'IN_PROGRESS') {
    el.classList.add('order-status--progress');
    el.textContent = '🟡 Processed - needs confirmation';
  }

  if (status === 'COMPLETED') {
    el.classList.add('order-status--completed');
    el.textContent = '🔵 Completed order';
  }

  if (status === 'CANCELED') {
    el.classList.add('order-status--canceled');
    el.textContent = '🔴 Скасоване замовлення';
  }
}

// ============================================================
// LIVE COUNTERS
// ============================================================

side1Input.addEventListener('input', () => {
  side1Count = Number(side1Input.value) || 0;
  updateLiveCounters();
});

side2Input.addEventListener('input', () => {
  side2Count = Number(side2Input.value) || 0;
  updateLiveCounters();
});

function updateLiveCounters() {
  const totalScanned = Object.values(boxCounts).reduce((sum, n) => sum + n, 0);
  const uniqueCodes = Object.keys(boxCounts).length;
  const palletsCount = boxesPerPallet > 0 ? Math.ceil(totalScanned / boxesPerPallet) : 0;

  let side1Filled = 0;
  let side2Filled = 0;

  if (totalScanned <= side1Count) {
    side1Filled = totalScanned;
    side2Filled = 0;
  } else {
    side1Filled = side1Count;
    side2Filled = totalScanned - side1Count;
  }

  side2Filled = Math.min(side2Filled, side2Count);

  const side1Percent = side1Count > 0 ? (side1Filled / side1Count) * 100 : 0;
  const side2Percent = side2Count > 0 ? (side2Filled / side2Count) * 100 : 0;

  document.getElementById('side1Bar').style.width = side1Percent + '%';
  document.getElementById('side2Bar').style.width = side2Percent + '%';

  document.getElementById('side1Info').textContent = `${side1Filled} / ${side1Count} boxes`;
  document.getElementById('side2Info').textContent = `${side2Filled} / ${side2Count} boxes`;

  const percent = totalBoxes > 0 ? Math.min(100, (totalScanned / totalBoxes) * 100) : 0;

  document.getElementById('containerInfo').innerHTML = `
    <b>Codes scanned:</b> ${uniqueCodes}<br>
    <b>Boxes:</b> ${totalScanned} / ${totalBoxes}<br>
    <b>Pallets:</b> ${palletsCount} / ${totalPallets || '—'}<br>
    <b>Side1 / Side2:</b> ${side1Count} / ${side2Count}
  `;

  document.getElementById('overlayContainerInfo').innerHTML = `
    Codes: ${uniqueCodes}<br>
    Boxes: ${totalScanned} / ${totalBoxes}<br>
    Pallets: ${palletsCount} / ${totalPallets || '—'}<br>
    S1/S2: ${side1Count}/${side2Count}
  `;

  const bar = document.getElementById('progressBar');
  const overlayBar = document.getElementById('overlayProgressBar');

  bar.style.transition = 'width 0.3s ease-out';
  overlayBar.style.transition = 'width 0.3s ease-out';

  bar.style.width = percent + '%';
  overlayBar.style.width = percent + '%';
}

// ============================================================
// COMPLETE / CANCEL ORDER
// ============================================================

window.completeOrder = function () {
  if (status !== 'IN_PROGRESS') {
    alert('First process the order.');
    return;
  }

  status = 'COMPLETED';
  saveSession();
  updateStatusUI();
};

window.cancelOrder = function () {
  if (!confirm('Cancel order?')) return;

  status = 'CANCELED';
  saveSession();
  updateStatusUI();
};

// ============================================================
// LOCAL STORAGE SESSION
// ============================================================

function saveSession() {
  try {
    const key = sessionKey();
    localStorage.setItem(
      key,
      JSON.stringify({
        boxCounts,
        status,
        totalBoxes,
        boxesPerPallet,
        totalPallets,
        side1Count,
        side2Count,
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
      boxCounts = {};
      status = 'NEW';
      return;
    }

    const data = JSON.parse(raw);

    boxCounts = data.boxCounts || {};
    status = data.status || 'NEW';
    totalBoxes = data.totalBoxes || totalBoxes;
    boxesPerPallet = data.boxesPerPallet || boxesPerPallet;
    totalPallets = data.totalPallets || totalPallets;
    side1Count = data.side1Count || 0;
    side2Count = data.side2Count || 0;

    side1Input.value = side1Count || '';
    side2Input.value = side2Count || '';

    updateLog();
    updateStatusUI();
    updateLiveCounters();
  } catch (e) {
    console.warn('localStorage load error', e);
  }
}

// ============================================================
// LOG
// ============================================================

function updateLog() {
  const logBox = document.getElementById('log');
  logBox.innerHTML = '';

  Object.entries(boxCounts).forEach(([code, count]) => {
    const div = document.createElement('div');
    div.className = 'scanner__log-item';
    div.innerHTML = `<span>${code}: ${count} pcs.</span>`;
    logBox.appendChild(div);
  });
}

function log(msg) {
  const logBox = document.getElementById('log');
  const div = document.createElement('div');
  div.textContent = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

//ч3
// ============================================================
// SCAN LOGIC (NEW MODEL)
// ============================================================

function playContainerBeep() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'square';
  osc.frequency.value = 440;
  gain.gain.value = 0.25;

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.25);
}

function registerBoxScan(code, qty = 1) {
  if (!code) return;

  if (!boxCounts[code]) {
    boxCounts[code] = 0;
  }

  boxCounts[code] += qty;
  status = 'IN_PROGRESS';

  setTimeout(() => {
    saveSession();
    updateLog();
    updateProgress();
  }, 0);

  const totalScanned = Object.values(boxCounts).reduce((s, n) => s + n, 0);
  if (boxesPerPallet > 0 && totalScanned % boxesPerPallet === 0) {
    playContainerBeep();
  }
}

// ============================================================
// MANUAL POPUP (ENABLED)
// ============================================================

const manualPopup = document.getElementById('manualConfirm');
const popupCode = document.getElementById('popupCode');
const popupQty = document.getElementById('popupQty');

let lastScannedCode = '';
let lastQty = 1;

function showManualPopup(code, qty = 1) {
  lastScannedCode = code;
  lastQty = qty;

  popupCode.textContent = code;
  popupQty.textContent = qty;

  manualPopup.classList.add('active');
}

function closeManualPopup() {
  manualPopup.classList.remove('active');
}

document.getElementById('popupOk').addEventListener('click', () => {
  registerBoxScan(lastScannedCode, lastQty);
  closeManualPopup();
});

document.getElementById('popupEdit').addEventListener('click', () => {
  closeManualPopup();
  openManualKeyboard(lastQty);
});

// ============================================================
// NON-BLOCKING MANUAL TOAST
// ============================================================

function showNonBlockingManualToast(code, qty = 1) {
  lastScannedCode = code;
  lastQty = qty;

  let toast = document.getElementById('manualToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'manualToast';
    toast.className = 'manual-toast';
    toast.innerHTML = `
      <div class="manual-toast__content">
        <div class="manual-toast__title">Manual quantity</div>
        <div class="manual-toast__code" id="manualToastCode"></div>
        <div class="manual-toast__qty">Qty: <span id="manualToastQty"></span></div>
        <div class="manual-toast__actions">
          <button id="manualToastOk" class="button button--primary">OK</button>
          <button id="manualToastEdit" class="button button--secondary">Edit</button>
        </div>
      </div>
    `;
    document.body.appendChild(toast);

    document.getElementById('manualToastOk').onclick = () => {
      registerBoxScan(lastScannedCode, lastQty);
      hideManualToast();
    };

    document.getElementById('manualToastEdit').onclick = () => {
      hideManualToast();
      openManualKeyboard(lastQty);
    };
  }

  document.getElementById('manualToastCode').textContent = code;
  document.getElementById('manualToastQty').textContent = qty;

  toast.classList.add('manual-toast--visible');
}

function hideManualToast() {
  const toast = document.getElementById('manualToast');
  if (toast) toast.classList.remove('manual-toast--visible');
}

// ============================================================
// MANUAL KEYPAD
// ============================================================

window.openManualKeyboard = function (startValue = 1) {
  document.getElementById('manualQty').value = startValue;
  document.getElementById('manualKeyboard').classList.add('active');
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
  if (qty > 0) registerBoxScan(lastScannedCode, qty);
  window.closeManualKeyboard();
};

// ============================================================
// PROGRESS
// ============================================================

function getTotalScanned() {
  return Object.values(boxCounts).reduce((sum, n) => sum + n, 0);
}

function updateProgress() {
  const scannedBoxes = getTotalScanned();
  const remaining = Math.max(0, totalBoxes - scannedBoxes);
  const currentPallet = boxesPerPallet ? Math.ceil(scannedBoxes / boxesPerPallet) : 0;

  document.getElementById('palletCheck').innerHTML = `
    <b>Total scanned:</b> ${scannedBoxes}<br>
    <b>Remaining:</b> ${remaining}<br>
    <b>Pallet:</b> ${currentPallet} / ${totalPallets || '?'}
  `;

  updateProgressBar();
  checkPalletCompletion(scannedBoxes);
  checkOrderCompletion(scannedBoxes);
}

function updateProgressBar() {
  const scannedBoxes = getTotalScanned();
  const percent = totalBoxes > 0 ? Math.min(100, (scannedBoxes / totalBoxes) * 100) : 0;
  document.getElementById('progressBar').style.width = percent + '%';
}

function checkPalletCompletion(scannedBoxes) {
  if (!boxesPerPallet || scannedBoxes === 0 || scannedBoxes >= totalBoxes) return;

  if (scannedBoxes % boxesPerPallet === 0) {
    flashPalletComplete();
  }
}

function flashPalletComplete() {
  const el = document.getElementById('palletCheck');
  el.classList.add('pallet-complete');
  setTimeout(() => el.classList.remove('pallet-complete'), 1200);
}

function checkOrderCompletion(scannedBoxes) {
  if (scannedBoxes >= totalBoxes && totalBoxes > 0) {
    flashOrderComplete();
    showStep(5);
    fillSummary();
    generateContainerReport();
    saveScanResult();
  }
}

function flashOrderComplete() {
  const el = document.getElementById('palletCheck');
  el.classList.add('order-complete');
  setTimeout(() => el.classList.remove('order-complete'), 2000);
}

// ============================================================
// SUMMARY
// ============================================================

function fillSummary() {
  const summaryEl = document.getElementById('summary');
  if (!summaryEl) return;

  const scannedBoxes = getTotalScanned();

  summaryEl.innerHTML = `
    <b>Total boxes ordered:</b> ${totalBoxes}<br>
    <b>Total boxes scanned:</b> ${scannedBoxes}<br>
    <b>Total pallets:</b> ${totalPallets}<br>
    <b>Unique codes scanned:</b> ${Object.keys(boxCounts).length}<br><br>

    <b>Details by code:</b><br>
    ${Object.entries(boxCounts)
      .map(([code, count]) => `${code}: ${count} boxes`)
      .join('<br>')}
  `;
}

// ============================================================
// SAVE SCAN RESULT (SERVER OPTIONAL)
// ============================================================

async function saveScanResult() {
  const date = document.getElementById('scanDate').value;

  // Якщо сервер недоступний — просто пропускаємо
  try {
    await fetch('/api/save-scan-result', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        client: selectedClient,
        date,
        boxCounts,
        totalBoxes,
        boxesPerPallet,
        totalPallets,
      }),
    });
  } catch (e) {
    console.warn('saveScanResult: server unreachable');
  }
}

// ============================================================
// SCAN HANDLER
// ============================================================

function onScanDetected(code) {
  console.log('[SCAN] detected raw:', code);

  const mode = document.getElementById('scanMode').value;

  if (mode === 'auto') {
    registerBoxScan(code, 1);
  } else {
    showNonBlockingManualToast(code, 1);
  }
}

//ч4
// ============================================================
// UNIVERSAL VIDEO SCANNER — Android + iOS
// ============================================================

let videoStream = null;
let codeReader = null;
let lastScanned = null;
let lastScanTime = 0;
const SCAN_COOLDOWN = 10;
const MIN_CODE_LENGTH = 4;

let stopScanner = null;

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

async function getCameraStream(facingMode = 'environment') {
  const ios = isIOS();

  return await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: facingMode,
      width: {ideal: ios ? 640 : 1280},
      height: {ideal: ios ? 480 : 720},
    },
  });
}

async function applyCameraFeatures(track) {
  const caps = track.getCapabilities?.() || {};

  const supportsTorch = !!caps.torch;
  const supportsFocus = !!caps.focusMode;

  return {
    supportsTorch,
    supportsFocus,
    enableTorch: async (state) => {
      if (supportsTorch) {
        await track.applyConstraints({advanced: [{torch: state}]});
      }
    },
    enableAutofocus: async () => {
      if (supportsFocus) {
        await track.applyConstraints({advanced: [{focusMode: 'continuous'}]});
      }
    },
  };
}

async function startVideoScanner(facingMode = 'environment') {
  lastScanned = null;
  lastScanTime = 0;
  scannedCodes = [];

  const video = document.getElementById('video');
  const flashBtn = document.getElementById('flashToggle');

  try {
    const stream = await getCameraStream(facingMode);
    video.srcObject = stream;
    videoStream = stream;

    await video.play();

    const track = stream.getVideoTracks()[0];
    const features = await applyCameraFeatures(track);

    // AUTOFOCUS
    if (features.supportsFocus && isAndroid()) {
      clearInterval(autofocusInterval);
      autofocusInterval = setInterval(() => features.enableAutofocus(), 5000);
    }

    // FLASH BUTTON
    if (features.supportsTorch) {
      flashBtn.style.display = 'block';
      flashBtn.onclick = () => {
        const active = flashBtn.classList.toggle('active');
        features.enableTorch(active);
      };
    } else {
      flashBtn.style.display = 'none';
    }

    // STOP BUTTONS
    document.getElementById('stopVideoScanner')?.addEventListener('click', () => {
      stopVideoScanner();
    });

    document.getElementById('closeScanner')?.addEventListener('click', () => {
      stopVideoScanner();
    });

    // ZXING INIT
    codeReader = new ZXing.BrowserMultiFormatReader();

    const handleScan = (result, err) => {
      if (!result) return;

      const code = result.text.trim();
      if (code.length < MIN_CODE_LENGTH) return;

      lastScanned = code;
      lastScanTime = Date.now();
      scannedCodes.push(code);

      const counterEl = document.getElementById('scanCounter');
      if (counterEl) counterEl.textContent = scannedCodes.length;

      document.body.classList.add('scan-flash');
      setTimeout(() => document.body.classList.remove('scan-flash'), 80);

      onScanDetected(code);
    };

    if (isIOS()) {
      codeReader.decodeFromVideoElement(video, handleScan);
    } else {
      codeReader.decodeContinuously(video, handleScan);
    }

    stopScanner = () => {
      codeReader?.reset();
      stream.getTracks().forEach((t) => t.stop());
      videoStream = null;
    };
  } catch (err) {
    console.error('Scanner error:', err);
    stopVideoScanner();
  }
}

function stopVideoScanner() {
  stopScanner?.();
  stopScanner = null;

  clearInterval(autofocusInterval);
  autofocusInterval = null;

  if (codeReader) {
    codeReader.reset();
    codeReader = null;
  }

  const overlay = document.getElementById('scannerOverlay');
  overlay?.classList.remove('active');

  document.body.classList.remove('scan-flash');

  if (currentStep === 5) {
    showScanResultsPopup();
  }
}

// ============================================================
// CAMERA CONTROL BUTTONS
// ============================================================

let isPaused = false;

function pauseVideoScanner() {
  if (!videoStream) return;
  isPaused = true;
  videoStream.getVideoTracks()[0].enabled = false;
}

function resumeVideoScanner() {
  if (!videoStream) return;
  isPaused = false;
  videoStream.getVideoTracks()[0].enabled = true;
}

async function switchCamera() {
  if (!videoStream) return;

  const currentFacing = videoStream.getVideoTracks()[0].getSettings().facingMode;
  const newFacing = currentFacing === 'environment' ? 'user' : 'environment';

  stopVideoScanner();
  await startVideoScanner(newFacing);
}

// ============================================================
// POPUP WITH FORMATTED RESULTS
// ============================================================

function showScanResultsPopup() {
  if (currentStep !== 5) {
    saveLastScanResult();
    return;
  }

  if (!boxCounts || Object.keys(boxCounts).length === 0) return;

  const lines = Object.entries(boxCounts).map(([code, count]) => {
    return `${code}\t-\t${count}\tb.`;
  });

  const text = lines.join('\n');
  const jsonData = JSON.stringify(boxCounts, null, 2);

  localStorage.setItem('lastScanResultText', text);
  localStorage.setItem('lastScanResultJSON', jsonData);

  const popup = document.createElement('div');
  popup.className = 'scan-results-popup';

  popup.innerHTML = `
    <div class="popup__content">
      <div class="popup__title">Scanned codes (${lines.length})</div>

      <textarea class="popup__textarea" id="scanResultsArea" readonly>${text}</textarea>

      <div class="popup__actions">
        <button id="copyResultsBtn" class="button button--primary">Copy</button>
        <button id="closeResultsBtn" class="button button--secondary">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  document.getElementById('copyResultsBtn').onclick = () => {
    navigator.clipboard.writeText(text);
  };

  document.getElementById('closeResultsBtn').onclick = () => {
    popup.remove();
  };
}

window.showScanResultsPopup = showScanResultsPopup;

// ============================================================
// VIEW LAST RESULTS
// ============================================================

window.reopenLastScanResults = function () {
  const text = localStorage.getItem('lastScanResultText');
  if (!text) {
    alert('No saved scan results');
    return;
  }

  const popup = document.createElement('div');
  popup.className = 'scan-results-popup';
  popup.innerHTML = `
    <div class="popup__content">
      <div class="popup__title">Last scan results</div>

      <textarea class="popup__textarea" readonly>${text}</textarea>

      <div class="popup__actions">
        <button id="copyResultsBtn2" class="button button--primary">Copy</button>
        <button id="closeResultsBtn2" class="button button--secondary">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  document.getElementById('copyResultsBtn2').onclick = () => {
    navigator.clipboard.writeText(text);
  };

  document.getElementById('closeResultsBtn2').onclick = () => {
    popup.remove();
  };
};

// ============================================================
// SAVE LAST SCAN RESULT
// ============================================================

function saveLastScanResult() {
  if (!boxCounts || Object.keys(boxCounts).length === 0) return;

  const lines = Object.entries(boxCounts).map(([code, count]) => {
    return `${code}\t-\t${count}\tb.`;
  });

  const text = lines.join('\n');
  const jsonData = JSON.stringify(boxCounts, null, 2);

  localStorage.setItem('lastScanResultText', text);
  localStorage.setItem('lastScanResultJSON', jsonData);
}

// ============================================================
// EXIT TASK SAFELY
// ============================================================

function exitTaskSafely() {
  saveSession();
  location.href = '/index.html';
}
window.exitTaskSafely = exitTaskSafely;

// ============================================================
// START SCANNER BUTTON
// ============================================================

document.getElementById('startVideoScanner').onclick = () => {
  if (!selectedClient) {
    alert('First, select a customer');
    return;
  }

  const overlay = document.getElementById('scannerOverlay');
  overlay?.classList.add('active');

  startVideoScanner();
};

document.getElementById('pauseScan')?.addEventListener('click', () => {
  if (isPaused) {
    resumeVideoScanner();
  } else {
    pauseVideoScanner();
  }
});

document.getElementById('stopScan')?.addEventListener('click', () => {
  stopVideoScanner();
});

document.getElementById('switchCamera')?.addEventListener('click', () => {
  switchCamera();
});

// ============================================================
// GLOBAL MENU LOGIC
// ============================================================

const globalMenu = document.getElementById('globalMenu');
const globalMenuBtn = document.getElementById('globalMenuBtn');
const closeGlobalMenu = document.getElementById('closeGlobalMenu');
const cancelTaskBtn = document.getElementById('cancelTaskBtn');

globalMenuBtn.addEventListener('click', () => {
  globalMenu.classList.add('active');
});

closeGlobalMenu.addEventListener('click', () => {
  globalMenu.classList.remove('active');
});

cancelTaskBtn.addEventListener('click', () => {
  if (confirm('Cancel current task? All progress will be lost.')) {
    localStorage.clear();
    location.href = '/index.html';
  }
});

// ============================================================
// FINAL REPORT (SORTED + COPY BUTTON)
// ============================================================

function generateContainerReport() {
  const reportEl = document.getElementById('finalReport');
  if (!reportEl) return;

  const list = Object.entries(boxCounts)
    .map(([code, count]) => ({code, count}))
    .sort((a, b) => b.count - a.count);

  const scannedTotal = list.reduce((s, e) => s + e.count, 0);
  const withoutSticker = Math.max(0, totalBoxes - scannedTotal);

  let textReport = `${selectedClient}\n\n`;

  list.forEach((item) => {
    textReport += `${item.code} ${item.count}B\n`;
  });

  if (withoutSticker > 0) {
    textReport += `\n${withoutSticker} without sticker`;
  }

  reportEl.innerHTML = `
    <div class="report-header"><b>${selectedClient}</b></div>
    <pre class="report-text">${textReport}</pre>
    <button class="button button--primary button--full" id="copyReportBtn">
      Copy report
    </button>
  `;

  document.getElementById('copyReportBtn').onclick = () => {
    navigator.clipboard
      .writeText(textReport)
      .then(() => alert('Report copied to clipboard'))
      .catch(() => alert('Copy failed'));
  };
}

// ============================================================
// FIXED FINISH SCANNING BUTTON
// ============================================================

document.getElementById('finishBtn')?.addEventListener('click', () => {
  stopVideoScanner();
  fillSummary();
  generateContainerReport();
  saveScanResult();
  showStep(5);
});

// ============================================================
// REPORT BUTTONS (EXCEL COUNTER)
// ============================================================

document.getElementById('generateReportBtn')?.addEventListener('click', async () => {
  const date = document.getElementById('scanDate').value;
  const statusEl = document.getElementById('reportStatus');

  statusEl.textContent = 'Generating report...';

  try {
    const res = await fetch('/api/generate-counter', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({date}),
    });

    const data = await res.json();

    if (data.ok) {
      statusEl.textContent = '✔ Report generated successfully';
    } else {
      statusEl.textContent = '❌ Error generating report';
    }
  } catch (err) {
    statusEl.textContent = '❌ Server error';
  }
});

document.getElementById('downloadReportBtn')?.addEventListener('click', () => {
  const date = document.getElementById('scanDate').value;
  window.location.href = `/api/download-counter?date=${encodeURIComponent(date)}`;
});

document.getElementById('openFolderBtn')?.addEventListener('click', () => {
  const date = document.getElementById('scanDate').value;
  window.open(`/api/open-folder?date=${encodeURIComponent(date)}`, '_blank');
});

// ============================================================
// WIZARD NAVIGATION
// ============================================================

function showStep(n) {
  const wasScanningStep = currentStep === 3;

  if (n < 0) n = 0;
  if (n > 5) n = 5;

  document.querySelectorAll('.wizard__step').forEach((step) => {
    step.classList.remove('active');
  });

  const target = document.getElementById(`step${n}`);
  if (target) target.classList.add('active');

  currentStep = n;

  const isScanningStep = currentStep === 3;

  if (wasScanningStep && !isScanningStep) {
    stopVideoScanner();
  }
}

window.showStep = showStep;

document.querySelectorAll('.wizard__next').forEach((btn) => {
  btn.addEventListener('click', () => {
    showStep(currentStep + 1);
  });
});

document.querySelectorAll('.wizard__back').forEach((btn) => {
  btn.addEventListener('click', () => {
    showStep(currentStep - 1);
  });
});

// Initial step
showStep(0);
