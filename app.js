const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzL04PTWLIlLfWxJx1i0Dg-nBPQ_M9S8sb0uShPjblns89ies7w_77ZS6VTSvUsUXkn/exec";
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/"; 

let currentUser = null, currentOrderID = null, targetItem = null;
let currentOffset = 0, currentInputValue = "0", isProcessing = false; 

let globalOrders = []; 
let activeDashboardTab = 'todo'; 

// Monitoring Statusu
function updateNetworkStatus() {
    const wifi = document.getElementById('wifi-indicator');
    if (navigator.onLine) {
        wifi.className = 'status-icon net-online';
    } else {
        wifi.className = 'status-icon net-offline';
    }
}

function updateBatteryStatus(battery) {
    const level = Math.round(battery.level * 100);
    document.getElementById('battery-level').innerText = level + '%';
    const battIcon = document.getElementById('battery-indicator');
    battIcon.style.color = level > 20 ? 'var(--accent-green)' : 'var(--error)';
}

// Inicjalizacja API Baterii
if ('getBattery' in navigator) {
    navigator.getBattery().then(battery => {
        updateBatteryStatus(battery);
        battery.addEventListener('levelchange', () => updateBatteryStatus(battery));
    });
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// Utrzymywanie focusu skanera
function maintainScannerFocus() {
    const hiddenInput = document.getElementById('hidden-scanner-input');
    if (!hiddenInput) return;
    hiddenInput.focus();
}

document.addEventListener('click', () => {
    if (currentUser) maintainScannerFocus();
});

// Obsługa skanowania
let scanBuffer = "";
document.getElementById('hidden-scanner-input').addEventListener('input', (e) => {
    const val = e.target.value;
    if (val.endsWith('\n') || val.length > 1) { 
        const ean = val.trim();
        e.target.value = "";
        handleGlobalScan(ean);
    }
});

async function handleGlobalScan(ean) {
    if (isProcessing) return;
    
    const view = getCurrentViewId();
    if (view === 'view-dashboard') {
        const order = globalOrders.find(o => o.id === ean);
        if (order) openOrder(order.id);
        else showError("NIE ZNALEZIONO ZAMÓWIENIA");
    } else if (view === 'view-product') {
        if (ean === targetItem.ean) {
            submitScan(targetItem.ean, 1, "auto");
        } else {
            showError("BŁĘDNY PRODUKT");
        }
    }
}

// Nawigacja
function showView(id) {
    document.querySelectorAll('.view-section').forEach(v => v.style.display = 'none');
    document.getElementById(id).style.display = 'flex';
    maintainScannerFocus();
}

function getCurrentViewId() {
    if (document.getElementById('view-login').style.display !== 'none') return 'view-login';
    if (document.getElementById('view-dashboard').style.display !== 'none') return 'view-dashboard';
    if (document.getElementById('view-product').style.display !== 'none') return 'view-product';
    return '';
}

// Logowanie i Dane
async function initApp() {
    updateNetworkStatus();
    showView('view-login');
    const res = await fetch(`${SCRIPT_URL}?action=get_users`);
    const data = await res.json();
    renderUsers(data.users);
}

function renderUsers(users) {
    const container = document.getElementById('login-list');
    container.innerHTML = '';
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'user-card';
        div.innerText = u.name;
        div.onclick = () => login(u.name);
        container.appendChild(div);
    });
}

function login(name) {
    currentUser = name;
    document.getElementById('user-info').innerText = `Użytkownik: ${name}`;
    document.getElementById('header-main-row').style.display = 'flex';
    loadDashboard();
}

async function loadDashboard() {
    showView('view-dashboard');
    const res = await fetch(`${SCRIPT_URL}?action=get_orders&user=${currentUser}`);
    const data = await res.json();
    globalOrders = data.orders;
    renderOrders();
}

function renderOrders() {
    const container = document.getElementById('order-list');
    container.innerHTML = '';
    const filtered = globalOrders.filter(o => activeDashboardTab === 'todo' ? o.status !== 'U' : o.status === 'U');
    filtered.forEach(o => {
        const div = document.createElement('div');
        div.className = 'user-card'; // Reuse style
        div.style.marginBottom = '10px';
        div.innerText = `ZAM: ${o.id}`;
        div.onclick = () => openOrder(o.id);
        container.appendChild(div);
    });
}

async function openOrder(id) {
    currentOrderID = id;
    const res = await fetch(`${SCRIPT_URL}?action=get_order_details&orderID=${id}`);
    const data = await res.json();
    const next = data.items.find(i => i.status !== 'U');
    if (next) {
        targetItem = next;
        showProduct(next);
    } else {
        showError("ZAMÓWIENIE KOMPLETNE");
        loadDashboard();
    }
}

function showProduct(item) {
    document.getElementById('product-name').innerText = item.name;
    document.getElementById('product-ean').innerText = item.ean;
    document.getElementById('product-loc').innerText = item.loc;
    document.getElementById('product-qty-needed').innerText = item.qty_needed - item.qty_done;
    document.getElementById('product-img').src = IMAGE_BASE_URL + item.img;
    showView('view-product');
}

async function submitScan(ean, qty, mode) {
    isProcessing = true;
    try {
        const res = await fetch(`${SCRIPT_URL}?action=scan&orderID=${currentOrderID}&ean=${ean}&qty=${qty}&mode=${mode}`);
        const result = await res.json();
        if (result.status === 'success') {
            openOrder(currentOrderID);
        } else {
            showError(result.msg);
        }
    } catch (e) {
        showError("BŁĄD POŁĄCZENIA");
    } finally {
        isProcessing = false;
    }
}

function showError(m) {
    const o = document.getElementById("error-overlay");
    o.style.display = "flex";
    document.getElementById("error-text").innerText = m;
    setTimeout(() => { o.style.display = "none"; }, 2000);
}

// Inicjalizacja
window.onload = initApp;

// Tabsy
document.getElementById('tab-todo').onclick = () => {
    activeDashboardTab = 'todo';
    document.getElementById('tab-todo').classList.add('active');
    document.getElementById('tab-done').classList.remove('active');
    renderOrders();
};
document.getElementById('tab-done').onclick = () => {
    activeDashboardTab = 'done';
    document.getElementById('tab-done').classList.add('active');
    document.getElementById('tab-todo').classList.remove('active');
    renderOrders();
};

document.getElementById('btn-product-back').onclick = loadDashboard;
