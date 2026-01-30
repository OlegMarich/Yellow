// =====================
// Головний маршрутизатор
// =====================

function showModalMessage(message) {
  const modal = document.getElementById('modalMessage');
  const modalText = document.getElementById('modalMessageText');
  modalText.innerHTML = message;
  modal.style.display = 'flex';
}

window.showModalMessage = showModalMessage;

// Закриття модалки
const modalOkBtn = document.getElementById('modalOkBtn');
if (modalOkBtn) {
  modalOkBtn.addEventListener('click', () => {
    const modal = document.getElementById('modalMessage');
    modal.style.display = 'none';

    if (window.generatedPath) {
      window.open(`/output/${window.generatedPath}`, '_blank');
    }
  });
}

// =====================
// Підключення модулів
// =====================
(async () => {
  const mode = document.body.dataset.mode?.toLowerCase();

  switch (mode) {
    case 'plan':
      await import('./plan-week.js');
      break;

    case 'report':
      await import('./report.js');
      break;

    case 'rippening':
    case 'chambers':
      await import('./chambers.js');
      break;

    case 'scanner':
      await import('./scanner.js');
      break;

    default:
      console.warn('⚠️ Unknown mode:', mode);
  }
})();
