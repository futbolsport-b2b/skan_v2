const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyp_iGG_iqwjcE5KTtUZYSm15be7B0l41Noi7tk2byvC9Ps5u2GQVzcdSnVsMnENa1g/exec";
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/";

let currentUser = null, currentOrderID = null, targetItem = null;
let currentOffset = 0, currentInputValue = "0";
const html5QrCode = new Html5Qrcode("reader");

// START APLIKACJI
window.onload = () => initApp();

async function initApp() {
    // Resetowanie widoków i ukrywanie overlayów
    document.getElementById("image-zoom-overlay").style.display = "none";
    document.getElementById("error-overlay").style.display = "none";
    document.getElementById("header-main-row").style.display = "none";
    document.getElementById("global-progress-bar").style.display = "none";
    
    showView('view-user-selection');
    
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_users`);
        const data = await resp.json();
        if(data.status === "success") {
            renderUsers(data.users);
        } else {
            showError("Błąd serwera: Brak operatorów");
        }
    } catch(e) {
        showError("Błąd połączenia z bazą ZKI_v2");
    }
}

function renderUsers(users) {
    const list = document.getElementById("user-list");
    list.innerHTML = "";
    users.forEach(user => {
        const btn = document.createElement("button");
        btn.className = "btn-user";
        btn.innerText = user;
        btn.onclick = () => selectUser(user);
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
    container.innerHTML = "<div style='text-align:center; padding:20px; color:#8e8e93;'>Pobieranie listy zadań...</div>";
    
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_orders_list&userName=${encodeURIComponent(currentUser)}`);
        const data = await resp.json();
        
        container.innerHTML = "";
        if (data.orders.length === 0) {
            container.innerHTML = "<div style='text-align:center; padding:40px;'>Brak przypisanych zamówień.</div>";
            return;
        }

        data.orders.forEach(order => {
            const baton = document.createElement("div");
            baton.className = "order-baton";
            baton.innerHTML = `
                <div class="order-progress-fill" style="width:${order.progress}%"></div>
                <div class="order-content">
                    <div class="order-id">${order.id}</div>
                    <div class="status-badge status-${order.status}">${order.status}</div>
                </div>`;
            baton.onclick = () => startOrder(order.id);
            container.appendChild(baton);
        });
    } catch(e) {
        showError("Błąd pobierania zadań");
    }
}

function startOrder(id) {
    currentOrderID = id;
    document.getElementById("header-main-row").style.display = "flex";
    document.getElementById("order-val").innerText = id;
    document.getElementById("global-progress-bar").style.display = "block";
    fetchNext(0);
}

async function fetchNext(offset) {
    showView('task-panel');
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
            document.getElementById("task-qty").innerText = targetItem.pozostalo;
            
            const img = document.getElementById("task-img");
            const formatted = String(targetItem.nr_kat).trim().replace(/\s+/g, '_');
            img.src = IMAGE_BASE_URL + "1_" + formatted + ".jpg";
            img.onerror = () => img.src = ""; // Ukryj jeśli brak zdjęcia
        } else {
            alert("ZAMÓWIENIE GOTOWE!");
            loadOrders();
            showView('view-orders-dashboard');
        }
    } catch(e) {
        showError("Błąd danych towaru");
    }
}

// SKANOWANIE
document.getElementById("btn-scan-item").onclick = async () => {
    showView('scanner-box');
    document.getElementById("target-kat-val").innerText = targetItem.nr_kat;
    document.getElementById("target-size-val").innerText = targetItem.rozmiar || "---";
    
    try {
        await html5QrCode.start(
            { facingMode: "environment" }, 
            { fps: 25, qrbox: { width: 250, height: 150 } }, 
            (text) => {
                if(text.trim() === String(targetItem.ean)) {
                    html5QrCode.stop().then(() => {
                        if(targetItem.pozostalo > 1) { 
                            openQtyModal();
                        } else { 
                            sendValidation(1); 
                        }
                    });
                } else {
                    showError("BŁĘDNY PRODUKT!");
                }
            }
        );
    } catch(e) {
        showError("Błąd kamery");
    }
};

function openQtyModal() {
    currentInputValue = "0";
    document.getElementById("qty-input-display").innerText = "0";
    document.getElementById("qty-name").innerText = targetItem.nazwa;
    document.getElementById("qty-remain").innerText = targetItem.pozostalo;
    document.getElementById("qty-modal").style.display = "flex";
}

function sendValidation(q) {
    fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&ean=${encodeURIComponent(targetItem.ean)}&qty=${q}&action=validate`)
    .then(() => fetchNext(currentOffset))
    .catch(() => showError("Błąd zapisu!"));
}

// NAWIGACJA I UI
function showView(id) {
    ['view-user-selection', 'view-orders-dashboard', 'scanner-box', 'task-panel'].forEach(v => {
        document.getElementById(v).style.display = (v === id) ? 'block' : 'none';
    });
}

function showError(msg) {
    const o = document.getElementById("error-overlay");
    document.getElementById("error-text").innerText = msg;
    o.style.display = "flex";
    setTimeout(() => o.style.display = "none", 2000);
}

// PRZYCISKI
document.getElementById("btn-logout").onclick = () => initApp();
document.getElementById("btn-back-scan").onclick = () => { html5QrCode.stop(); showView('task-panel'); };
document.getElementById("btn-prev").onclick = () => fetchNext(currentOffset - 1);
document.getElementById("btn-next").onclick = () => fetchNext(currentOffset + 1);
document.getElementById("btn-qty-cancel").onclick = () => document.getElementById("qty-modal").style.display = "none";
document.getElementById("btn-qty-ok").onclick = () => {
    const val = parseInt(currentInputValue);
    if(val > 0 && val <= targetItem.pozostalo) {
        document.getElementById("qty-modal").style.display = "none";
        sendValidation(val);
    } else {
        showError("BŁĘDNA ILOŚĆ");
    }
};

document.querySelectorAll('.np-btn[data-val]').forEach(btn => {
    btn.onclick = () => {
        const val = btn.dataset.val;
        currentInputValue = currentInputValue === "0" ? val : currentInputValue + val;
        document.getElementById("qty-input-display").innerText = currentInputValue;
    };
});

document.getElementById("np-clear").onclick = () => {
    currentInputValue = "0";
    document.getElementById("qty-input-display").innerText = "0";
};
document.getElementById("np-del").onclick = () => {
    currentInputValue = currentInputValue.length > 1 ? currentInputValue.slice(0, -1) : "0";
    document.getElementById("qty-input-display").innerText = currentInputValue;
};
