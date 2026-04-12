const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxVrTNOgir39kUu-Zf12MsY66w1urfN3BPxTMYlaQQnVEfkWhz2gD1p82rwvdWjy5Yv/exec";
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/";

let currentUser = null, currentOrderID = null, targetItem = null;
let currentOffset = 0, currentInputValue = "0", isProcessing = false;
let isManualUnlocked = sessionStorage.getItem('manualUnlock') === 'true';
const html5QrCode = new Html5Qrcode("reader");

let wakeLock = null;

// --- ZAPOBIEGANIE WYGASZANIU EKRANU ---
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {}
}
document.addEventListener('visibilitychange', () => {
    if (wakeLock !== null && document.visibilityState === 'visible') requestWakeLock();
});

function speakVoice(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'pl-PL';
        window.speechSynthesis.speak(u);
    }
}

window.onload = () => {
    updateLockUI();
    initApp();
};

async function initApp() {
    showView('view-user-selection');
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_users`);
        const data = await resp.json();
        if(data.status === "success") renderUsers(data.users);
    } catch(e) { alert("Błąd połączenia"); }
}

function renderUsers(users) {
    const list = document.getElementById("user-list");
    list.innerHTML = "";
    users.forEach(u => {
        const btn = document.createElement("button");
        btn.className = "btn-user";
        btn.innerHTML = `<div class="user-avatar-icon">👤</div><span>${u}</span>`;
        btn.onclick = () => { currentUser = u; showView('view-orders-dashboard'); loadOrders(); requestWakeLock(); };
        list.appendChild(btn);
    });
}

// --- OBSŁUGA KŁÓDKI ---
document.getElementById('btn-manual-lock').onclick = function() {
    isManualUnlocked = !isManualUnlocked;
    sessionStorage.setItem('manualUnlock', isManualUnlocked);
    updateLockUI();
    if(isManualUnlocked) speakVoice("Tryb ręczny odblokowany");
};

function updateLockUI() {
    const btn = document.getElementById('btn-manual-lock');
    const icon = document.getElementById('lock-icon');
    const manualBtn = document.getElementById('btn-manual-add');
    
    if(isManualUnlocked) {
        btn.classList.add('unlocked');
        icon.innerText = "🔓";
        if(manualBtn) manualBtn.disabled = false;
    } else {
        btn.classList.remove('unlocked');
        icon.innerText = "🔒";
        if(manualBtn) manualBtn.disabled = true;
    }
}

async function loadOrders() {
    const container = document.getElementById("orders-list-container");
    container.innerHTML = "Wczytywanie...";
    const resp = await fetch(`${SCRIPT_URL}?action=get_orders_list&userName=${encodeURIComponent(currentUser)}`);
    const data = await resp.json();
    container.innerHTML = "";
    data.orders.forEach(o => {
        const baton = document.createElement("div");
        baton.className = "order-baton";
        baton.innerHTML = `
            <div class="order-progress-fill" style="width:${o.progress}%"></div>
            <div class="order-content">
                <span>${o.id}</span>
                <div class="status-badge status-${o.status}">${o.status}</div>
            </div>`;
        baton.onclick = () => startOrder(o.id, o.itemsCount);
        container.appendChild(baton);
    });
}

function startOrder(id, count) {
    currentOrderID = id;
    document.getElementById("header-main-row").style.display = "flex";
    document.getElementById("order-val").innerText = id;
    document.getElementById("global-progress-bar").style.display = "block";
    speakVoice("Pozycji do uszykowania: " + count);
    fetchNext(0);
}

async function fetchNext(offset) {
    showView('task-panel');
    updateLockUI();
    try {
        const res = await fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&action=get_next&offset=${offset}`);
        const data = await res.json();
        if(data.status === "next_item") {
            targetItem = data.item;
            currentOffset = data.current_offset;
            document.getElementById("global-progress-fill").style.width = data.progress + "%";
            document.getElementById("task-lp").innerText = targetItem.lp;
            document.getElementById("task-name").innerText = targetItem.nazwa;
            document.getElementById("task-kat").innerText = targetItem.nr_kat;
            document.getElementById("task-size").innerText = targetItem.rozmiar;
            document.getElementById("task-qty").innerText = targetItem.pozostalo;
            
            const img = document.getElementById("task-img");
            img.src = IMAGE_BASE_URL + "1_" + String(targetItem.nr_kat).trim().replace(/\s+/g, '_') + ".jpg";
            document.getElementById("product-image-box").style.display = "flex";
        } else {
            alert("Zamówienie gotowe!");
            showView('view-orders-dashboard');
            loadOrders();
        }
    } catch(e) { alert("Błąd danych"); }
}

// --- TRYB RĘCZNY ---
document.getElementById('btn-manual-add').onclick = () => {
    speakVoice("Wprowadzanie ręczne");
    openNumpad();
};

document.getElementById('btn-scan-item').onclick = async () => {
    showView('scanner-box');
    await html5QrCode.start({ facingMode: "environment" }, { fps: 20 }, (text) => {
        if(text.trim() === String(targetItem.ean)) {
            html5QrCode.stop().then(() => openNumpad());
        }
    });
};

function openNumpad() {
    currentInputValue = "0";
    document.getElementById("qty-input-display").innerText = "0";
    document.getElementById("qty-name").innerText = targetItem.nazwa;
    document.getElementById("qty-remain").innerText = targetItem.pozostalo;
    document.getElementById("qty-modal").style.display = "flex";
}

function sendVal(q, mode) {
    const btn = document.getElementById("btn-qty-ok");
    btn.innerText = "ZAPIS...";
    fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&ean=${encodeURIComponent(targetItem.ean)}&qty=${q}&mode=${mode}&action=validate`)
    .then(r => r.json())
    .then(d => {
        btn.innerText = "ZATWIERDŹ";
        document.getElementById("qty-modal").style.display = "none";
        fetchNext(currentOffset);
    });
}

document.getElementById("btn-qty-ok").onclick = () => {
    const q = parseInt(currentInputValue);
    if(q > 0 && q <= targetItem.pozostalo) {
        // Jeśli kłódka jest otwarta I użyliśmy przycisku manual, mode to manual
        // W innym przypadku (nawet przy otwartej kłódce, ale po skanie) mode to scan
        const mode = document.getElementById('view-orders-dashboard').style.display === 'none' && !html5QrCode.isScanning ? "manual" : "scan";
        sendVal(q, mode);
    }
};

document.querySelectorAll('.np-btn[data-val]').forEach(b => {
    b.onclick = () => {
        currentInputValue = currentInputValue === "0" ? b.dataset.val : currentInputValue + b.dataset.val;
        document.getElementById("qty-input-display").innerText = currentInputValue;
    };
});

document.getElementById("btn-logout").onclick = () => {
    sessionStorage.removeItem('manualUnlock');
    isManualUnlocked = false;
    updateLockUI();
    initApp();
};

function showView(id) {
    ['view-user-selection', 'view-orders-dashboard', 'scanner-box', 'task-panel'].forEach(v => {
        document.getElementById(v).style.display = (v === id) ? 'block' : 'none';
    });
}
document.getElementById("btn-qty-cancel").onclick = () => document.getElementById("qty-modal").style.display = "none";
