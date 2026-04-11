const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxtq2daW4ZODYhaEY-umzWz2YzEIR7JUDbW-H_tb8UVQP3ojxUNJYdrEpQnAP1OtA5y/exec"; 
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/"; 

let currentUser = null, currentOrderID = null, targetItem = null;
let currentOffset = 0, currentInputValue = "0", isProcessing = false; 
const html5QrCode = new Html5Qrcode("reader");

window.onload = () => initApp();

async function initApp() {
    document.getElementById("image-zoom-overlay").style.display = "none";
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

function selectUser(user) {
    currentUser = user;
    document.getElementById("display-user-name").innerText = user;
    showView('view-orders-dashboard');
    loadOrders();
}

async function loadOrders() {
    const container = document.getElementById("orders-list-container");
    container.innerHTML = "<div style='text-align:center; padding:20px; color:#8e8e93;'>Ładowanie zadań...</div>";
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
    } catch(e) { showError("Błąd bazy danych"); }
}

function startOrder(id) {
    currentOrderID = id;
    document.getElementById("header-main-row").style.display = "flex";
    document.getElementById("order-val").innerText = id;
    document.getElementById("global-progress-bar").style.display = "block";
    fetchNext(0);
}

// LOKIGA STANU ŁADOWANIA Z V2.3
function setLoadingState(active) { 
    const card = document.querySelector('.task-card'); 
    if (active) { 
        card.classList.add('loading-mode'); 
        isProcessing = true; 
    } else { 
        card.classList.remove('loading-mode'); 
        isProcessing = false; 
    } 
}

async function fetchNext(offset) {
    showView('task-panel');
    setLoadingState(true);
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
            document.getElementById("task-size").innerText = targetItem.rozmiar || "---";
            
            const qtyElem = document.getElementById("task-qty");
            qtyElem.innerText = targetItem.pozostalo;
            
            const notesRow = document.getElementById("task-notes-row");
            if (targetItem.uwagi && targetItem.uwagi.trim() !== "") { 
                document.getElementById("task-notes").innerText = targetItem.uwagi; 
                notesRow.style.display = "block"; 
                qtyElem.style.color = "var(--error)"; 
            } else { 
                notesRow.style.display = "none"; 
                qtyElem.style.color = "var(--success)";
            }
            
            // BEZPIECZNE ŁADOWANIE ZDJĘĆ Z V2.3
            const imgBox = document.getElementById("product-image-box");
            const imgElem = document.getElementById("task-img");
            imgElem.src = "";
            
            if(targetItem.nr_kat && targetItem.nr_kat !== "---") {
                let formattedKat = String(targetItem.nr_kat).trim().replace(/\s+/g, '_');
                imgElem.onload = () => { imgBox.style.display = "flex"; };
                imgElem.onerror = () => { imgBox.style.display = "none"; }; 
                imgElem.src = IMAGE_BASE_URL + "1_" + formattedKat + ".jpg";
            } else {
                imgBox.style.display = "none";
            }
            setLoadingState(false);
        } else {
            alert("ZAMÓWIENIE ZREALIZOWANE");
            loadOrders();
            showView('view-orders-dashboard');
        }
    } catch(e) {
        setLoadingState(false);
        showError("Błąd pobierania danych produktu");
    }
}

// PRZYWRÓCONY ZOOM ZDJĘCIA Z V2.3
let zoomTimeout = null;
document.getElementById('task-img').onclick = function() {
    const overlay = document.getElementById('image-zoom-overlay');
    document.getElementById('zoomed-img').src = this.src;
    overlay.style.display = 'flex';
    void overlay.offsetWidth; 
    overlay.style.opacity = '1';
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(closeZoom, 3000);
};
function closeZoom() {
    const overlay = document.getElementById('image-zoom-overlay');
    overlay.style.opacity = '0';
    setTimeout(() => overlay.style.display = 'none', 300);
}
document.getElementById('image-zoom-overlay').onclick = closeZoom;

// SKANOWANIE
document.getElementById("btn-scan-item").onclick = async () => {
    showView('scanner-box');
    document.getElementById("target-kat-val").innerText = targetItem.nr_kat;
    document.getElementById("target-size-val").innerText = targetItem.rozmiar || "---";
    try {
        await html5QrCode.start({ facingMode: "environment" }, { fps: 25 }, (text) => {
            if(text.trim() === String(targetItem.ean)) {
                html5QrCode.stop().then(() => {
                    if(targetItem.pozostalo > 1) { 
                        currentInputValue = "0";
                        document.getElementById("qty-input-display").innerText = "0";
                        document.getElementById("qty-name").innerText = targetItem.nazwa;
                        document.getElementById("qty-kat-val").innerHTML = "Nr Kat: " + targetItem.nr_kat;
                        document.getElementById("qty-remain").innerText = targetItem.pozostalo;
                        document.getElementById("qty-modal").style.display = "flex";
                    } else { sendVal(1); }
                });
            } else { showError("BŁĘDNY PRODUKT!"); }
        });
    } catch(e) { showError("Błąd kamery"); }
};

function sendVal(q) {
    fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&ean=${encodeURIComponent(targetItem.ean)}&qty=${q}&action=validate`)
    .then(() => fetchNext(currentOffset));
}

// INTERFEJS POMOCNICZY
function showView(id) {
    ['view-user-selection', 'view-orders-dashboard', 'scanner-box', 'task-panel'].forEach(v => {
        document.getElementById(v).style.display = (v === id) ? 'block' : 'none';
    });
}
function showError(m) {
    const o = document.getElementById("error-overlay");
    o.style.display = "flex";
    document.getElementById("error-text").innerText = m;
    setTimeout(() => { o.style.display = "none"; }, 2500);
}

// OBSŁUGA PRZYCISKÓW NUMPADA Z V2.3
document.getElementById("btn-qty-ok").onclick = () => { document.getElementById("qty-modal").style.display = "none"; sendVal(parseInt(currentInputValue)); };
document.querySelectorAll('.np-btn[data-val]').forEach(b => {
    b.onclick = () => {
        currentInputValue = currentInputValue === "0" ? b.dataset.val : currentInputValue + b.dataset.val;
        document.getElementById("qty-input-display").innerText = currentInputValue;
    };
});
document.getElementById("np-clear").onclick = () => { currentInputValue = "0"; document.getElementById("qty-input-display").innerText = "0"; };
document.getElementById("np-del").onclick = () => { currentInputValue = currentInputValue.length > 1 ? currentInputValue.slice(0, -1) : "0"; document.getElementById("qty-input-display").innerText = currentInputValue; };
document.querySelectorAll('.btn-quick[data-add]').forEach(btn => {
    btn.onclick = () => {
        let newVal = parseInt(currentInputValue) + parseInt(btn.getAttribute('data-add'));
        if (newVal <= targetItem.pozostalo) { currentInputValue = String(newVal); document.getElementById("qty-input-display").innerText = currentInputValue; }
    };
});
document.getElementById('btn-quick-max').onclick = () => { currentInputValue = String(targetItem.pozostalo); document.getElementById("qty-input-display").innerText = currentInputValue; };
document.getElementById("btn-qty-cancel").onclick = () => document.getElementById("qty-modal").style.display = "none";

// NAWIGACJA GŁÓWNA
document.getElementById("btn-logout").onclick = () => initApp();
document.getElementById("btn-back-scan").onclick = () => { html5QrCode.stop(); showView('task-panel'); };
document.getElementById("btn-prev").onclick = () => { if(!isProcessing) fetchNext(currentOffset - 1); };
document.getElementById("btn-next").onclick = () => { if(!isProcessing) fetchNext(currentOffset + 1); };
document.getElementById("btn-finish-icon").onclick = () => { if(confirm("Opuścić zamówienie?")) loadOrders(), showView('view-orders-dashboard'); };
