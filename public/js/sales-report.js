const params = new URLSearchParams(location.search);
const week = params.get('week');

document.getElementById('title').textContent = `Sales Report for ${week}`;

fetch(`/api/sales-data?week=${week}`)
  .then((r) => r.json())
  .then((rawData) => {
    window.rawData = rawData;
    initFilters(rawData);
    render(rawData);
  });

// ---------------------------
// FILTERS
// ---------------------------

function initFilters(rawData) {
  const fClient = document.getElementById('filterClient');
  const fCountry = document.getElementById('filterCountry');
  const fProduct = document.getElementById('filterProduct');
  const fDate = document.getElementById('filterDate');

  const clients = new Set();
  const countries = new Set();
  const products = new Set();
  const dates = new Set(rawData.dates);

  rawData.items.forEach((item) => {
    clients.add(item.customer.short);
    countries.add(item.customer.country);
    products.add(item.product.id);
  });

  for (const c of clients) fClient.innerHTML += `<option>${c}</option>`;
  for (const c of countries) fCountry.innerHTML += `<option>${c}</option>`;
  for (const p of products) fProduct.innerHTML += `<option>${p}</option>`;
  for (const d of dates) fDate.innerHTML += `<option>${d}</option>`;

  fClient.onchange = () => render(rawData);
  fCountry.onchange = () => render(rawData);
  fProduct.onchange = () => render(rawData);
  fDate.onchange = () => render(rawData);
}

// ---------------------------
// RENDER
// ---------------------------

function render(rawData) {
  const container = document.getElementById('reportContainer');

  const fc = document.getElementById('filterClient').value;
  const fco = document.getElementById('filterCountry').value;
  const fp = document.getElementById('filterProduct').value;
  const fd = document.getElementById('filterDate').value;

  let html = '';
  const grouped = {};

  rawData.items.forEach((item) => {
    if (fc && item.customer.short !== fc) return;
    if (fco && item.customer.country !== fco) return;
    if (fp && item.product.id !== fp) return;
    if (fd && !item.dates.some((d) => d.date === fd && d.qty > 0)) return;

    const client = item.customer.short;
    const location = item.location;

    if (!grouped[client]) grouped[client] = {};
    if (!grouped[client][location]) grouped[client][location] = [];

    grouped[client][location].push(item);
  });

  for (const client of Object.keys(grouped)) {
    html += `<div class="client-block"><h2>Client: ${client}</h2>`;

    for (const loc of Object.keys(grouped[client])) {
      html += `<div class="location-block"><h3>Location: ${loc}</h3>`;

      html += `<table><tr><th>Product</th>`;
      rawData.dates.forEach((d) => (html += `<th>${d}</th>`));
      html += `</tr>`;

      grouped[client][loc].forEach((item) => {
        html += `<tr><td>${item.product.id}</td>`;
        item.dates.forEach((d) => (html += `<td>${d.qty}</td>`));
        html += `</tr>`;
      });

      html += `</table></div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html || '<p>No data for selected filters.</p>';
}
