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
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}

function setStatus(text){
  const el = document.getElementById('statusTag');
  if(el) el.textContent = text;
}

function formatDateTime(iso){
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toggleTgSettings(){
  const popup = document.getElementById('tgSettingsPopup');
  if(popup) popup.style.display = (popup.style.display === 'block') ? 'none' : 'block';
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
    if(tToken && document.getElementById('tgBotToken')) document.getElementById('tgBotToken').value = tToken.value;
    if(tChat && document.getElementById('tgChatId')) document.getElementById('tgChatId').value = tChat.value;
  }catch(e){}

  setStatus('saqlangan');
  renderAll();
}

async function saveProducts(){
  try{ await localStore.set('mahsulotlar', JSON.stringify(products)); }
  catch(e){ showToast('Saqlashda xatolik'); }
}

async function saveSales(){
  try{ await localStore.set('sotuvlar', JSON.stringify(sales)); }
  catch(e){ showToast('Saqlashda xatolik'); }
}

async function saveExpenses(){
  try{ await localStore.set('chiqimlar', JSON.stringify(expenses)); }
  catch(e){ showToast('Saqlashda xatolik'); }
}

async function saveTgSettings(){
  const token = document.getElementById('tgBotToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();
  await localStore.set('tg_token', token);
  await localStore.set('tg_chat', chatId);
  showToast("Bot sozlamalari saqlandi");
  toggleTgSettings();
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
  const btn = document.querySelector(`[data-view="${viewId}"]`);
  const view = document.getElementById(`view-${viewId}`);
  if(btn) btn.classList.add('active');
  if(view) view.classList.add('active');
}

function renderKassaList(){
  const el = document.getElementById('kassaProductList');
  if(!el) return;
  el.innerHTML = '';
  if(products.length === 0){
    el.innerHTML = '<div class="empty-note">Avval Omborda mahsulot qo\'shing</div>';
    return;
  }
  products.forEach(p=>{
    const row = document.createElement('div');
    row.className = 'product-row';
    const thumb = p.image ? `<img class="pthumb" src="${p.image}">` : `<div class="pthumb-placeholder">—</div>`;
    row.innerHTML = `
      <div class="pleft">
        ${thumb}
        <div>
          <div><strong>${escapeHtml(p.name)}</strong></div>
          <div style="font-size:12px; color:#64748b;">${escapeHtml(p.doc || '—')}</div>
        </div>
      </div>
      <div>
        <div class="pprice">${fmt(p.price)} so'm</div>
        <div class="pstock ${p.qty <= 3 ? 'low' : ''}">${p.qty} m qoldi</div>
      </div>
    `;
    row.onclick = () => addToCart(p);
    el.appendChild(row);
  });
}

function addToCart(product){
  if(product.qty <= 0){ showToast('Omborda qoldiq yo\'q'); return; }
  const existing = cart.find(c => c.productId === product.id);
  if(existing){
    if(existing.qty + 1 > product.qty){ showToast('Omborda yetarli emas'); return; }
    existing.qty += 1;
  } else {
    cart.push({productId: product.id, name: product.name, price: product.price, qty: 1});
  }
  renderReceipt();
}

function renderReceipt(){
  const container = document.getElementById('receiptItems');
  const totalEl = document.getElementById('receiptTotal');
  const sellBtn = document.getElementById('sellBtn');
  if(!container || !totalEl || !sellBtn) return;

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
      <div class="rname">${escapeHtml(item.name)}</div>
      <div class="rqty">${item.qty} m</div>
      <div class="rline">${fmt(sum)} so'm</div>
    `;
    container.appendChild(row);
  });
  totalEl.textContent = fmt(total);
  sellBtn.disabled = false;
}

async function checkout(){
  if(cart.length === 0) return;
  const sale = {
    id: 's_' + Date.now(),
    date: new Date().toISOString(),
    items: [...cart],
    total: cart.reduce((sum, item) => sum + (item.price * item.qty), 0)
  };

  sales.unshift(sale);
  cart.forEach(item => {
    const p = products.find(prod => prod.id === item.productId);
    if(p) p.qty = Math.round((p.qty - item.qty) * 100) / 100;
  });

  cart = [];
  await saveProducts();
  await saveSales();
  renderAll();
  showToast('Sotuv muvaffaqiyatli amalga oshirildi!');
}

function renderOmborTable(){
  const tbody = document.getElementById('omborTableBody');
  if(!tbody) return;
  tbody.innerHTML = '';
  products.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.image ? `<img class="table-thumb" src="${p.image}">` : '—'}</td>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.doc || '—')}</td>
      <td>${fmt(p.price)} so'm</td>
      <td class="${p.qty <= 3 ? 'low' : ''}">${p.qty} m</td>
      <td><button class="btn-secondary" onclick="deleteProduct('${p.id}')">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function handleNewImageFile(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    newImageBase64 = e.target.result;
    document.getElementById('newImagePreviewWrap').innerHTML = `<img class="pthumb" src="${newImageBase64}">`;
  };
  reader.readAsDataURL(file);
}

async function addNewProduct(){
  const name = document.getElementById('newName').value.trim();
  const doc = document.getElementById('newDoc').value.trim();
  const price = parseFloat(document.getElementById('newPrice').value);
  const qty = parseFloat(document.getElementById('newQty').value);

  if(!name || isNaN(price) || isNaN(qty)){
    showToast('Barcha maydonlarni to\'ldiring!');
    return;
  }

  products.push({ id: 'p_' + Date.now(), name, doc, price, qty, image: newImageBase64 });
  await saveProducts();
  
  document.getElementById('newName').value = '';
  document.getElementById('newDoc').value = '';
  document.getElementById('newPrice').value = '';
  document.getElementById('newQty').value = '';
  newImageBase64 = null;

  renderAll();
  showToast('Mahsulot qo\'shildi!');
}

async function deleteProduct(id){
  if(!confirm('O\'chirmoqchimisiz?')) return;
  products = products.filter(p => p.id !== id);
  await saveProducts();
  renderAll();
}

function renderHisobot(){
  const todayStr = new Date().toISOString().slice(0, 10);
  let todaySales = 0, monthSales = 0, stockValue = 0;

  sales.forEach(s => {
    if(s.date.startsWith(todayStr)) todaySales += s.total;
  });

  products.forEach(p => { stockValue += (p.price * p.qty); });

  if(document.getElementById('statToday')) document.getElementById('statToday').textContent = fmt(todaySales);
  if(document.getElementById('statStockValue')) document.getElementById('statStockValue').textContent = fmt(stockValue);
}

window.addEventListener('DOMContentLoaded', loadData);
