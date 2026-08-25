if ('serviceWorker' in navigator) {
  const swCode = `
    const CACHE_NAME = 'ai-model-cache-v1';
    self.addEventListener('fetch', (event) => {
      if (event.request.url.includes('cdn.jsdelivr.net') || event.request.url.includes('tfhub.dev')) {
        event.respondWith(
          caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((response) => {
              return response || fetch(event.request).then((networkResponse) => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
              });
            });
          })
        );
      }
    });
  `;
  const blob = new Blob([swCode], { type: 'application/javascript' });
  const swUrl = URL.createObjectURL(blob);
  navigator.serviceWorker.register(swUrl).catch(err => console.log('SW error:', err));
}

const fmt = n => new Intl.NumberFormat('uz-UZ').format(Math.round(n));
const escapeHtml = str => (str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

const localStore = {
  async get(key){
    try{
      const val = localStorage.getItem(key);
      return val !== null ? { key, value: val } : null;
    }catch(e){ return null; }
  },
  async set(key, value){
    try{
      localStorage.setItem(key, value);
      return { key, value };
    }catch(e){ return null; }
  }
};

let products = [];
let sales = [];
let expenses = [];
let cart = []; 
let cameraStream = null;
let netModel = null;
let newImageBase64 = null;

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}

function setStatus(text){
  document.getElementById('statusTag').textContent = text;
}

function formatDateTime(iso){
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toggleTgSettings(){
  const popup = document.getElementById('tgSettingsPopup');
  popup.style.display = (popup.style.display === 'block') ? 'none' : 'block';
}

async function loadData(){
  setStatus('yuklanmoqda...');
  try{
    const p = await localStore.get('mahsulotlar');
    products = p ? JSON.parse(p.value) : [];
  }catch(e){ products = []; }
  try{
    const s = await localStore.get('sotuvlar');
    sales = s ? JSON.parse(s.value) : [];
  }catch(e){ sales = []; }
  try{
    const ex = await localStore.get('chiqimlar');
    expenses = ex ? JSON.parse(ex.value) : [];
  }catch(e){ expenses = []; }

  try{
    const tToken = await localStore.get('tg_token');
    const tChat = await localStore.get('tg_chat');
    if(tToken) document.getElementById('tgBotToken').value = tToken.value;
    if(tChat) document.getElementById('tgChatId').value = tChat.value;
  }catch(e){}

  setStatus('saqlangan');
  renderAll();

  loadMobilenetModel().catch(e=>console.log("AI pre-load err:", e));
}

async function saveProducts(){
  try{
    const r = await localStore.set('mahsulotlar', JSON.stringify(products));
    if(!r) showToast('Saqlashda xatolik');
  }catch(e){ showToast('Saqlashda xatolik: ' + e.message); }
}

async function saveSales(){
  try{
    const r = await localStore.set('sotuvlar', JSON.stringify(sales));
    if(!r) showToast('Saqlashda xatolik');
  }catch(e){ showToast('Saqlashda xatolik: ' + e.message); }
}

async function saveExpenses(){
  try{
    const r = await localStore.set('chiqimlar', JSON.stringify(expenses));
    if(!r) showToast('Saqlashda xatolik');
  }catch(e){ showToast('Saqlashda xatolik: ' + e.message); }
}

async function saveTgSettings(){
  const token = document.getElementById('tgBotToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();
  await localStore.set('tg_token', token);
  await localStore.set('tg_chat', chatId);
  showToast("Bot sozlamalari saqlandi");
}

function renderAll(){
  renderKassaList();
  renderReceipt();
  renderOmborTable();
  renderHisobot();
}

function switchTab(viewId){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector(`[data-view="${viewId}"]`).classList.add('active');
  document.getElementById(`view-${viewId}`).classList.add('active');
}

// TELEGRAM ALERT
async function sendTgAlert(text){
  const token = document.getElementById('tgBotToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();
  if(!token || !chatId) return;

  try{
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ chat_id: chatId, text: text })
    });
  }catch(e){}
}

// KASSA
function renderKassaList(){
  const el = document.getElementById('kassaProductList');
  el.innerHTML = '';
  if(products.length === 0){
    el.innerHTML = '<div class="empty-note">Avval "Ombor" bo\'limida mahsulot qo\'shing</div>';
    return;
  }
  products.forEach(p=>{
    const row = document.createElement('div');
    row.className = 'product-row';
    const low = p.qty <= 3;
    const thumb = p.image
      ? `<img class="pthumb" src="${p.image}">`
      : `<div class="pthumb-placeholder">—</div>`;
    row.innerHTML = `
      <div class="pleft">
        ${thumb}
        <div>
          <div class="pname">${escapeHtml(p.name)}</div>
          <div class="pmeta">${escapeHtml(p.doc || '—')}</div>
        </div>
      </div>
      <div>
        <div class="pprice">${fmt(p.price)}</div>
        <div class="pstock ${low ? 'low' : ''}">${p.qty} m qoldi</div>
      </div>
    `;
    row.onclick = () => addToCart(p);
    el.appendChild(row);
  });
}

function addToCart(product){
  if(product.qty <= 0){ showToast(`${product.name} — qoldiq yo'q`); return; }
  const existing = cart.find(c => c.productId === product.id);
  if(existing){
    if(existing.qty + 1 > product.qty){ showToast('Omborda yetarli emas'); return; }
    existing.qty += 1;
  } else {
    cart.push({productId: product.id, name: product.name, price: product.price, qty: 1});
  }
  renderReceipt();
}

function changeCartPrice(productId, newPriceStr){
  const price = parseFloat(newPriceStr);
  const item = cart.find(c => c.productId === productId);
  if(!item || isNaN(price) || price < 0){ renderReceipt(); return; }
  item.price = price;
  renderReceipt();
}

function changeCartQty(productId, delta){
  const item = cart.find(c => c.productId === productId);
  const product = products.find(p => p.id === productId);
  if(!item) return;
  const newQty = Math.round((item.qty + delta) * 100) / 100;
  if(newQty <= 0){
    cart = cart.filter(c => c.productId !== productId);
  } else {
    if(product && newQty > product.qty){ showToast('Omborda yetarli emas'); return; }
    item.qty = newQty;
  }
  renderReceipt();
}

function updateCartQtyInput(productId, valStr){
  const val = parseFloat(valStr);
  const item = cart.find(c => c.productId === productId);
  const product = products.find(p => p.id === productId);
  if(!item || isNaN(val) || val <= 0){ renderReceipt(); return; }
  if(product && val > product.qty){ showToast('Omborda yetarli emas'); renderReceipt(); return; }
  item.qty = val;
  renderReceipt();
}

function removeFromCart(productId){
  cart = cart.filter(c => c.productId !== productId);
  renderReceipt();
}

function renderReceipt(){
  const container = document.getElementById('receiptItems');
  const totalEl = document.getElementById('receiptTotal');
  const sellBtn = document.getElementById('sellBtn');
  if(cart.length === 0){
    container.innerHTML = '<div class="receipt-empty">Savat bo\'sh</div>';
    totalEl.textContent = '0';
    sellBtn.disabled = true;
    return;
  }
  let total = 0;
  container.innerHTML = '';
  cart.forEach(item => {
    const sum = item.price * item.qty;
    total += sum;
    const row = document.createElement('div');
    row.className = 'receipt-item';
    row.innerHTML = `
      <div class="rname" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
      <div class="rqty">
        <button onclick="changeCartQty('${item.productId}', -1)">-</button>
        <input type="number" class="qty-edit" value="${item.qty}" step="0.1" onchange="updateCartQtyInput('${item.productId}', this.value)">
        <span>m</span>
        <button onclick="changeCartQty('${item.productId}', 1)">+</button>
      </div>
      <div>
        <input type="number" class="price-edit" value="${item.price}" onchange="changeCartPrice('${item.productId}', this.value)">
      </div>
      <div class="rline">${fmt(sum)}</div>
      <button onclick="removeFromCart('${item.productId}')">✕</button>
    `;
    container.appendChild(row);
  });
  totalEl.textContent = fmt(total);
  sellBtn.disabled = false;
}

async function checkout(){
  if(cart.length === 0) return;
  
  for(const item of cart){
    const product = products.find(p => p.id === item.productId);
    if(!product || product.qty < item.qty){
      showToast(`Xatolik: ${item.name} Yetarli emas!`);
      return;
    }
  }

  const sale = {
    id: 's_' + Date.now(),
    date: new Date().toISOString(),
    items: cart.map(c => ({...c})),
    total: cart.reduce((sum, item) => sum + (item.price * item.qty), 0)
  };

  sales.unshift(sale);

  // Zaxiralarni kamaytirish va 3m qoldiqni Telegramga tekshirish
  cart.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    if(product){
      product.qty = Math.round((product.qty - item.qty) * 100) / 100;
      
      if(product.qty <= 3){
        sendTgAlert(`⚠️ OGBORDA OZ QOLDI!\n\nMahsulot: ${product.name}\nQoldiq: ${product.qty} metr`);
      }
    }
  });

  cart = [];
  await saveProducts();
  await saveSales();
  renderAll();
  showToast('Sotuv amalga oshirildi!');
}

// OMBOR
let editingProductId = null;

function renderOmborTable(){
  const tbody = document.getElementById('omborTableBody');
  const emptyNote = document.getElementById('omborEmpty');
  const search = (document.getElementById('omborSearchInput')?.value || '').toLowerCase().trim();
  tbody.innerHTML = '';
  
  let filtered = products;
  if(search){
    filtered = products.filter(p => 
      (p.name && p.name.toLowerCase().includes(search)) || 
      (p.doc && p.doc.toLowerCase().includes(search))
    );
  }

  if(filtered.length === 0){
    emptyNote.style.display = 'block';
    return;
  }
  emptyNote.style.display = 'none';

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    if(editingProductId === p.id){
      tr.className = 'editing';
      tr.innerHTML = `
        <td class="edit-cell">
          <div class="img-preview-placeholder" id="editPreviewWrap_${p.id}">
            ${p.image ? `<img class="table-thumb" src="${p.image}">` : '—'}
          </div>
          <input type="file" accept="image/*" onchange="handleEditImageFile(this, '${p.id}')">
        </td>
        <td class="edit-cell"><input type="text" id="editName_${p.id}" value="${escapeHtml(p.name)}"></td>
        <td class="edit-cell"><input type="text" id="editDoc_${p.id}" value="${escapeHtml(p.doc || '')}"></td>
        <td class="edit-cell num"><input type="number" id="editPrice_${p.id}" value="${p.price}"></td>
        <td class="edit-cell num"><input type="number" id="editQty_${p.id}" value="${p.qty}"></td>
        <td>
          <div class="edit-actions">
            <button class="icon-btn add" onclick="saveProductEdit('${p.id}')">💾</button>
            <button class="icon-btn" onclick="cancelProductEdit()">✕</button>
          </div>
        </td>
      `;
    } else {
      const thumb = p.image 
        ? `<img class="table-thumb" src="${p.image}">`
        : `<div class="table-thumb-placeholder">—</div>`;
      tr.innerHTML = `
        <td>${thumb}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.doc || '—')}</td>
        <td class="num">${fmt(p.price)}</td>
        <td class="num ${p.qty <= 3 ? 'low' : ''}">${p.qty} m</td>
        <td>
          <button class="icon-btn" onclick="startProductEdit('${p.id}')">✏️</button>
          <button class="icon-btn del" onclick="deleteProduct('${p.id}')">🗑️</button>
        </td>
      `;
    }
    tbody.appendChild(tr);
  });
}

function handleNewImageFile(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    newImageBase64 = e.target.result;
    document.getElementById('newImagePreviewWrap').innerHTML = `<img class="img-preview" src="${newImageBase64}">`;
  };
  reader.readAsDataURL(file);
}

let editImageBase64Temp = null;
function handleEditImageFile(input, id){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    editImageBase64Temp = e.target.result;
    document.getElementById(`editPreviewWrap_${id}`).innerHTML = `<img class="table-thumb" src="${editImageBase64Temp}">`;
  };
  reader.readAsDataURL(file);
}

async function addNewProduct(){
  const name = document.getElementById('newName').value.trim();
  const doc = document.getElementById('newDoc').value.trim();
  const price = parseFloat(document.getElementById('newPrice').value);
  const qty = parseFloat(document.getElementById('newQty').value);

  if(!name || isNaN(price) || isNaN(qty)){
    showToast('Nomi, narxi va qoldiqni kiriting!');
    return;
  }

  const p = {
    id: 'p_' + Date.now(),
    name, doc, price, qty,
    image: newImageBase64 || null
  };

  products.push(p);
  await saveProducts();
  
  document.getElementById('newName').value = '';
  document.getElementById('newDoc').value = '';
  document.getElementById('newPrice').value = '';
  document.getElementById('newQty').value = '';
  document.getElementById('newImageInput').value = '';
  document.getElementById('newImagePreviewWrap').innerHTML = `<div class="img-preview-placeholder">Rasm yo'q</div>`;
  newImageBase64 = null;

  renderAll();
  showToast('Mahsulot qo\'shildi!');
}

function startProductEdit(id){
  editingProductId = id;
  editImageBase64Temp = null;
  renderOmborTable();
}

function cancelProductEdit(){
  editingProductId = null;
  editImageBase64Temp = null;
  renderOmborTable();
}

async function saveProductEdit(id){
  const p = products.find(item => item.id === id);
  if(!p) return;
  const name = document.getElementById(`editName_${id}`).value.trim();
  const doc = document.getElementById(`editDoc_${id}`).value.trim();
  const price = parseFloat(document.getElementById(`editPrice_${id}`).value);
  const qty = parseFloat(document.getElementById(`editQty_${id}`).value);

  if(!name || isNaN(price) || isNaN(qty)){
    showToast('Barcha maydonlarni to\'g'ri to'ldiring');
    return;
  }

  p.name = name;
  p.doc = doc;
  p.price = price;
  p.qty = qty;
  if(editImageBase64Temp !== null){
    p.image = editImageBase64Temp;
  }

  editingProductId = null;
  editImageBase64Temp = null;
  await saveProducts();
  renderAll();
  showToast('Mahsulot tahrirlandi');
}

async function deleteProduct(id){
  if(!confirm('Haqiqatdan ham o\'chirmoqchimisiz?')) return;
  products = products.filter(p => p.id !== id);
  await saveProducts();
  renderAll();
  showToast('Mahsulot o\'chirildi');
}

// AI MODEL & CAMERA
async function loadMobilenetModel(){
  if(netModel) return netModel;
  netModel = await mobilenet.load();
  return netModel;
}

function setCameraMode(mode, viewPrefix){
  const fileContainer = document.getElementById(`${viewPrefix}FileScanContainer`);
  const cameraWrap = document.getElementById(`${viewPrefix}CameraWrap`);
  const snapBtn = document.getElementById(`${viewPrefix}SnapAndScanBtn`);
  const btnFile = document.getElementById(`${viewPrefix === 'kassa' ? 'kassaBtnModeFile' : 'btnModeFile'}`);
  const btnLive = document.getElementById(`${viewPrefix === 'kassa' ? 'kassaBtnModeLive' : 'btnModeLive'}`);

  if(mode === 'live'){
    btnFile.classList.remove('active');
    btnLive.classList.add('active');
    fileContainer.style.display = 'none';
    cameraWrap.style.display = 'block';
    snapBtn.style.display = 'inline-block';
    startCamera(viewPrefix);
  } else {
    btnLive.classList.remove('active');
    btnFile.classList.add('active');
    cameraWrap.style.display = 'none';
    snapBtn.style.display = 'none';
    fileContainer.style.display = 'block';
    stopCamera();
  }
}

async function startCamera(viewPrefix){
  stopCamera();
  const video = document.getElementById(`${viewPrefix}WebcamVideo`);
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }, audio: false
    });
    video.srcObject = cameraStream;
  } catch(e){
    showToast("Kameraga ulanishda xatolik");
  }
}

function stopCamera(){
  if(cameraStream){
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

async function handleScanFile(input, viewPrefix){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const imgUrl = e.target.result;
    document.getElementById(`${viewPrefix}ScanPreviewWrap`).innerHTML = `<img src="${imgUrl}">`;
    await processAIImage(imgUrl, viewPrefix);
  };
  reader.readAsDataURL(file);
}

async function snapAndScan(viewPrefix){
  const video = document.getElementById(`${viewPrefix}WebcamVideo`);
  if(!video || !video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imgUrl = canvas.toDataURL('image/jpeg');
  document.getElementById(`${viewPrefix}ScanPreviewWrap`).innerHTML = `<img src="${imgUrl}">`;
  await processAIImage(imgUrl, viewPrefix);
}

async function processAIImage(imgDataUrl, viewPrefix){
  const statusEl = document.getElementById(`${viewPrefix}ScanStatus`);
  statusEl.textContent = 'Model yuklanmoqda va solishtirilmoqda...';

  try {
    const model = await loadMobilenetModel();
    const imgEl = new Image();
    imgEl.src = imgDataUrl;
    await new Promise(r => imgEl.onload = r);

    const targetActivation = model.infer(imgEl, true);
    const targetVector = await targetActivation.data();

    const targets = products.filter(p => p.image);
    if(targets.length === 0){
      statusEl.textContent = 'Omborda rasmli mahsulot topilmadi!';
      return;
    }

    let results = [];
    for(const p of targets){
      const pImg = new Image();
      pImg.src = p.image;
      await new Promise(r => pImg.onload = r);
      const act = model.infer(pImg, true);
      const vec = await act.data();
      const sim = cosineSimilarity(targetVector, vec);
      results.push({ product: p, score: sim });
    }

    results.sort((a,b) => b.score - a.score);
    statusEl.textContent = 'Taqqoslash yakunlandi!';
    renderScanResults(results, viewPrefix);

  } catch(e){
    statusEl.textContent = 'Xatolik yuz berdi: ' + e.message;
  }
}

function cosineSimilarity(a, b){
  let dot = 0, mA = 0, mB = 0;
  for(let i=0; i<a.length; i++){
    dot += a[i]*b[i];
    mA += a[i]*a[i];
    mB += b[i]*b[i];
  }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

function renderScanResults(results, viewPrefix){
  const panel = document.getElementById(viewPrefix === 'kassa' ? 'kassaScanResultsPanel' : 'scanResultsPanel');
  const container = document.getElementById(viewPrefix === 'kassa' ? 'kassaScanResults' : 'scanResults');
  panel.style.display = 'block';
  container.innerHTML = '';

  results.forEach(res => {
    const pct = Math.round(res.score * 100);
    const div = document.createElement('div');
    div.className = 'scan-result-row';
    div.innerHTML = `
      <img class="scan-result-thumb" src="${res.product.image}">
      <div class="scan-result-info">
        <div class="scan-result-name">${escapeHtml(res.product.name)}</div>
        <div class="scan-score-track"><div class="scan-score-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="scan-score-pct">${pct}%</div>
      <button class="scan-select-btn" onclick="addToCartFromScan('${res.product.id}')">+ Savatga</button>
    `;
    container.appendChild(div);
  });
}

function addToCartFromScan(productId){
  const p = products.find(item => item.id === productId);
  if(p){
    addToCart(p);
    showToast(`${p.name} savatga qo'shildi!`);
  }
}

// HISOBOT & TELEGRAM
function renderHisobot(){
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStr = new Date().toISOString().slice(0, 7);

  let todaySales = 0, monthSales = 0, stockValue = 0;
  let todayExp = 0, monthExp = 0;

  sales.forEach(s => {
    if(s.date.startsWith(todayStr)) todaySales += s.total;
    if(s.date.startsWith(monthStr)) monthSales += s.total;
  });

  expenses.forEach(e => {
    if(e.date.startsWith(todayStr)) todayExp += e.amount;
    if(e.date.startsWith(monthStr)) monthExp += e.amount;
  });

  products.forEach(p => {
    stockValue += (p.price * p.qty);
  });

  document.getElementById('statToday').textContent = fmt(todaySales);
  document.getElementById('statMonth').textContent = fmt(monthSales);
  document.getElementById('statStockValue').textContent = fmt(stockValue);
  document.getElementById('statExpenseToday').textContent = fmt(todayExp);
  document.getElementById('statExpenseMonth').textContent = fmt(monthExp);
  document.getElementById('statProfitToday').textContent = fmt(todaySales - todayExp);

  // Top Mahsulotlar
  const monthSalesList = sales.filter(s => s.date.startsWith(monthStr));
  const productTotals = {};
  monthSalesList.forEach(s => {
    s.items.forEach(i => {
      productTotals[i.name] = (productTotals[i.name] || 0) + i.qty;
    });
  });

  const topEl = document.getElementById('topProducts');
  const topEmpty = document.getElementById('topEmpty');
  topEl.innerHTML = '';
  const sorted = Object.entries(productTotals).sort((a,b) => b[1] - a[1]);

  if(sorted.length === 0){
    topEmpty.style.display = 'block';
  } else {
    topEmpty.style.display = 'none';
    const maxQty = sorted[0][1];
    sorted.slice(0,5).forEach(([name, qty]) => {
      const pct = (qty / maxQty) * 100;
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `
        <div class="bar-name">${escapeHtml(name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-val">${qty} m</div>
      `;
      topEl.appendChild(row);
    });
  }

  // Sotuvlar tarixi
  const salesHistEl = document.getElementById('salesHistoryList');
  const salesHistEmpty = document.getElementById('salesHistoryEmpty');
  salesHistEl.innerHTML = '';
  if(sales.length === 0){
    salesHistEmpty.style.display = 'block';
  } else {
    salesHistEmpty.style.display = 'none';
    sales.slice(0,10).forEach(s => {
      const row = document.createElement('div');
      row.className = 'sale-row';
      const itemsStr = s.items.map(i => `${i.name} (${i.qty}m)`).join(', ');
      row.innerHTML = `
        <div class="sale-row-top">
          <span class="sale-date">${formatDateTime(s.date)}</span>
          <span class="sale-total">${fmt(s.total)} so'm</span>
        </div>
        <div class="sale-items">${escapeHtml(itemsStr)}</div>
      `;
      salesHistEl.appendChild(row);
    });
  }

  // Chiqimlar
  const expEl = document.getElementById('expenseList');
  const expEmpty = document.getElementById('expenseEmpty');
  expEl.innerHTML = '';
  if(expenses.length === 0){
    expEmpty.style.display = 'block';
  } else {
    expEmpty.style.display = 'none';
    expenses.slice(0, 10).forEach(ex => {
      const row = document.createElement('div');
      row.className = 'expense-row';
      row.innerHTML = `
        <span class="expense-date">${formatDateTime(ex.date)}</span>
        <span class="expense-note">${escapeHtml(ex.note || '—')}</span>
        <span class="expense-amount">-${fmt(ex.amount)}</span>
      `;
      expEl.appendChild(row);
    });
  }
}

async function addExpense(){
  const amt = parseFloat(document.getElementById('newExpenseAmount').value);
  const note = document.getElementById('newExpenseNote').value.trim();
  if(isNaN(amt) || amt <= 0){ showToast('Summani kiriting!'); return; }
  
  expenses.unshift({
    id: 'e_' + Date.now(),
    date: new Date().toISOString(),
    amount: amt, note
  });

  await saveExpenses();
  document.getElementById('newExpenseAmount').value = '';
  document.getElementById('newExpenseNote').value = '';
  renderHisobot();
  showToast('Chiqim saqlandi!');
}

async function sendTelegramReport(){
  const token = document.getElementById('tgBotToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();

  if(!token || !chatId){
    showToast("Bot Token va Chat ID kiritilmagan!");
    toggleTgSettings();
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let todaySales = 0, todayExp = 0;

  sales.forEach(s => { if(s.date.startsWith(todayStr)) todaySales += s.total; });
  expenses.forEach(e => { if(e.date.startsWith(todayStr)) todayExp += e.amount; });

  const msg = `📊 **BUGUNGI HISOBOT** (${todayStr})\n\n` +
              `💵 Bugungi savdo: ${fmt(todaySales)} so'm\n` +
              `🔻 Bugungi chiqim: ${fmt(todayExp)} so'm\n` +
              `📈 Sof foyda: ${fmt(todaySales - todayExp)} so'm`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
    });
    const data = await res.json();
    if(data.ok){
      showToast("Hisobot Telegramga yuborildi!");
    } else {
      showToast("Xatolik: " + data.description);
    }
  } catch(e){
    showToast("Internet yoki Bot sozlamalarida xatolik!");
  }
}

// ZAXIRA NUSXA
function exportData(){
  const data = { products, sales, expenses };
  const str = JSON.stringify(data, null, 2);
  const blob = new Blob([str], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `linoleum_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function handleRestoreFile(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if(data.products) products = data.products;
      if(data.sales) sales = data.sales;
      if(data.expenses) expenses = data.expenses;
      await saveProducts();
      await saveSales();
      await saveExpenses();
      renderAll();
      showToast("Ma'lumotlar qayta tiklandi!");
    } catch(err){
      showToast("Fayl formati noto'g'ri!");
    }
  };
  reader.readAsText(file);
}

window.onload = loadData;
