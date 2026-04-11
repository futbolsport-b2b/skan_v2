const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyp_iGG_iqwjcE5KTtUZYSm15be7B0l41Noi7tk2byvC9Ps5u2GQVzcdSnVsMnENa1g/exec";
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/";

let currentUser = null, currentOrderID = null, targetItem = null;
let currentOffset = 0, currentInputValue = "0", isProcessing = false;
const html5QrCode = new Html5Qrcode("reader");

// INICJALIZACJA
window.onload = () => initApp();

async function initApp() {
    showView('view-user-selection');
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_users`);
        const data = await resp.json();
        if(data.status === "success") renderUsers(data.users);
    } catch(e) { showError("Błąd połączenia z serwerem"); }
}

function renderUsers(users) {
    const list = document.getElementById("user-list");
    list.innerHTML = "";
    users.forEach(u => {
        const btn = document.createElement("button");
        btn.className = "btn-user";
        btn.innerText = u;
        btn.onclick = () => selectUser(u);
        list.appendChild(btn);
    });
}

async function selectUser(user) {
    currentUser = user;
    document.getElementById("display-user-name").innerText = user;
    showView('view-orders-dashboard');
    loadOrders();
}

async function loadOrders() {
    const container = document.getElementById("orders-list-container");
    container.innerHTML = "<div class='view-label'>Ładowanie...</div>";
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_orders_list&userName=${encodeURIComponent(currentUser)}`);
        const data = await resp.json();
        container.innerHTML = "";
        data.orders.forEach(o => {
            const baton = document.createElement("div");
            baton.className = "order-baton";
            baton.innerHTML = `
                <div class="order-progress-fill" style="width:${o.progress}%"></div>
                <div class="order-content">
                    <div class="order-id">${o.id}</div>
                    <div class="status-badge status-${o.status}">${o.status}</div>
                </div>`;
            baton.onclick = () => startOrder(o.id);
            container.appendChild(baton);
        });
    } catch(e) { showError("Błąd listy zamówień"); }
}

function startOrder(id) {
    currentOrderID = id;
    document.getElementById("header-main-row").style.display = "flex";
    document.getElementById("order-val").innerText = id;
    document.getElementById("global-progress-bar").style.display = "block";
    fetchNext(0);
}

async function fetchNext(offset) {
    isProcessing = true;
    showView('task-panel');
    try {
        const res = await fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&action=get_next&offset=${offset}`);
        const data = await res.json();
        if(data.status === "next_item") {
            targetItem = data.item;
            currentOffset = data.current_offset;
            document.getElementById("global-progress-fill").style.width = data.progress + "%";
            updateUIWithItem();
        } else {
            alert("ZAMÓWIENIE GOTOWE!");
            loadOrders();
            showView('view-orders-dashboard');
        }
    } catch(e) { showError("Błąd danych"); }
    isProcessing = false;
}

function updateUIWithItem() {
    document.getElementById("task-lp").innerText = targetItem.lp;
    document.getElementById("task-name").innerText = targetItem.nazwa;
    document.getElementById("task-kat").innerText = targetItem.nr_kat;
    document.getElementById("task-size").innerText = targetItem.rozmiar || "---";
    document.getElementById("task-qty").innerText = targetItem.pozostalo;
    
    const img = document.getElementById("task-img");
    const formatted = String(targetItem.nr_kat).trim().replace(/\s+/g, '_');
    img.src = IMAGE_BASE_URL + "1_" + formatted + ".jpg";
}

// SKANOWANIE
async function startScanning() {
    showView('scanner-box');
    document.getElementById("target-kat-val").innerText = targetItem.nr_kat;
    document.getElementById("target-size-val").innerText = targetItem.rozmiar;
    try {
        await html5QrCode.start({ facingMode: "environment" }, { fps: 20 }, onScanSuccess);
    } catch(e) { showError("Błąd kamery"); }
}

function onScanSuccess(text) {
    if(text.trim() === targetItem.ean) {
        html5QrCode.stop().then(() => {
            if(targetItem.pozostalo > 1) { showQtyModal(); } 
            else { sendQty(1); }
        });
    } else { showError("ZŁY PRODUKT!"); }
}

function sendQty(q) {
    fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&ean=${encodeURIComponent(targetItem.ean)}&qty=${q}&action=validate`)
    .then(() => fetchNext(currentOffset));
}

// POMOCNICZE
function showView(id) {
    ['view-user-selection', 'view-orders-dashboard', 'scanner-box', 'task-panel'].forEach(v => {
        document.getElementById(v).style.display = (v === id) ? 'block' : 'none';
    });
}

function showError(m) {
    const o = document.getElementById("error-overlay");
    document.getElementById("error-text").innerText = m;
    o.style.display = "flex";
    setTimeout(() => o.style.display = "none", 2000);
}

// OBSŁUGA PRZYCISKÓW
document.getElementById("btn-logout").onclick = () => initApp();
document.getElementById("btn-scan-item").onclick = () => startScanning();
document.getElementById("btn-back-scan").onclick = () => { html5QrCode.stop(); showView('task-panel'); };
document.getElementById("btn-finish-icon").onclick = () => { if(confirm("Przerwać?")) loadOrders(), showView('view-orders-dashboard'); };

// Logika Numpada i Modala (uproszczona jak w v2.3)
function showQtyModal() {
    currentInputValue = "0";
    document.getElementById("qty-input-display").innerText = "0";
    document.getElementById("qty-remain").innerText = targetItem.pozostalo;
    document.getElementById("qty-modal").style.display = "flex";
}
document.getElementById("btn-qty-ok").onclick = () => {
    document.getElementById("qty-modal").style.display = "none";
    sendQty(parseInt(currentInputValue));
};
document.querySelectorAll('.np-btn[data-val]').forEach(b => {
    b.onclick = () => {
        currentInputValue = currentInputValue === "0" ? b.dataset.val : currentInputValue + b.dataset.val;
        document.getElementById("qty-input-display").innerText = currentInputValue;
    };
});
document.getElementById("np-clear").onclick = () => { currentInputValue = "0"; document.getElementById("qty-input-display").innerText = "0"; };
document.getElementById("btn-qty-cancel").onclick = () => document.getElementById("qty-modal").style.display = "none";
