const params = new URLSearchParams(location.search);
const date = params.get('date');

document.getElementById('title').textContent = `Transport Report for ${date}`;

fetch(`/api/transport-data?date=${date}`)
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
  const fCar = document.getElementById('filterCar');
  const fTime = document.getElementById('filterTime');

  const clients = new Set();
  const countries = new Set();
  const products = new Set();
  const cars = new Set();
  const times = new Set();

  rawData.forEach((item) => {
    clients.add(item.customer.short);
    countries.add(item.customer.country);
    products.add(item.product.id);
    if (item.carNumber) cars.add(item.carNumber);
    if (item.time) times.add(item.time);
  });

  for (const c of clients) fClient.innerHTML += `<option>${c}</option>`;
  for (const c of countries) fCountry.innerHTML += `<option>${c}</option>`;
  for (const p of products) fProduct.innerHTML += `<option>${p}</option>`;
  for (const c of cars) fCar.innerHTML += `<option>${c}</option>`;
  for (const t of times) fTime.innerHTML += `<option>${t}</option>`;

  fClient.onchange = () => render(rawData);
  fCountry.onchange = () => render(rawData);
  fProduct.onchange = () => render(rawData);
  fCar.onchange = () => render(rawData);
  fTime.onchange = () => render(rawData);
}

// ---------------------------
// RENDER
// ---------------------------

function render(rawData) {
  const container = document.getElementById('reportContainer');

  const fc = document.getElementById('filterClient').value;
  const fco = document.getElementById('filterCountry').value;
  const fp = document.getElementById('filterProduct').value;
  const fcar = document.getElementById('filterCar').value;
  const ft = document.getElementById('filterTime').value;

  let html = '';
  const grouped = {};

  rawData.forEach((item) => {
    if (fc && item.customer.short !== fc) return;
    if (fco && item.customer.country !== fco) return;
    if (fp && item.product.id !== fp) return;
    if (fcar && item.carNumber !== fcar) return;
    if (ft && item.time !== ft) return;

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

      html += `<table><tr>
        <th>Product</th>
        <th>Qty</th>
        <th>Pal</th>
        <th>Truck</th>
        <th>Driver</th>
        <th>Time</th>
      </tr>`;

      grouped[client][loc].forEach((item) => {
        html += `<tr>
          <td>${item.product.id}</td>
          <td>${item.qty}</td>
          <td>${item.pal}</td>
          <td>${item.carNumber}</td>
          <td>${item.driver}</td>
          <td>${item.time}</td>
        </tr>`;
      });

      html += `</table></div>`;
    }

    html += `</div>`;
  }

  container.innerHTML = html || '<p>No data for selected filters.</p>';
}
