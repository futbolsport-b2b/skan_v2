const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzL04PTWLIlLfWxJx1i0Dg-nBPQ_M9S8sb0uShPjblns89ies7w_77ZS6VTSvUsUXkn/exec"; 
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/"; 

let currentUser = null, currentOrderID = null, targetItem = null;
let currentOffset = 0, currentInputValue = "0", isProcessing = false; 
let isManualUnlocked = sessionStorage.getItem('manualUnlock') === 'true'; 

let isFirstScanPerOrder = true; 

let globalOrders = []; 
let activeDashboardTab = 'todo'; 

let activeSearchQuery = "";
let tempSearchQuery = "";

// Czysta mapa kolorów
let userColorsMap = {}; 

const html5QrCode = new Html5Qrcode("reader");

let audioCtx = null;
let wakeLock = null;

let idleTimer = null;
let currentIdleContext = null; 

function getCurrentViewId() {
    const views = ['view-user-selection', 'view-orders-dashboard', 'scanner-box', 'task-panel'];
    return views.find(v => document.getElementById(v).style.display === 'flex');
}

window.addEventListener('popstate', (event) => {
    if (document.getElementById('search-modal').style.display === 'flex') {
        document.getElementById('search-modal').style.display = 'none';
        history.pushState({ view: getCurrentViewId() }, "", "#" + getCurrentViewId());
        return;
    }

    if (document.getElementById('qty-modal').style.display === 'flex') {
        document.getElementById('qty-modal').style.display = 'none';
        stopIdleTimer(); 
        const hasEan = isEanValid(targetItem ? targetItem.ean : null);
        if(document.getElementById('scanner-box').style.display !== 'none' && hasEan) {
            startScannerView(); 
        }
        history.pushState({ view: getCurrentViewId() }, "", "#" + getCurrentViewId());
        return;
    }
    
    if (document.getElementById('image-zoom-overlay').style.display === 'flex') {
        closeZoom();
        history.pushState({ view: getCurrentViewId() }, "", "#" + getCurrentViewId());
        return;
    }

    const state = event.state;
    if (!state || !state.view) return;

    const targetView = state.view;
    const currentView = getCurrentViewId();

    if (currentView === 'scanner-box' && targetView === 'task-panel') {
        document.getElementById("btn-back-scan").click();
        return;
    }

    // Usunięto denerwujące potwierdzenie przy powrocie
    if (currentView === 'task-panel' && targetView === 'view-orders-dashboard') {
        exitToDashboard();
        return;
    }

    if (currentView === 'view-orders-dashboard' && targetView === 'view-user-selection') {
        document.getElementById("btn-logout").click();
        return;
    }

    showView(targetView, false);
});

function exitToDashboard() {
    stopIdleTimer();
    document.getElementById("header-main-row").style.display = "none";
    document.getElementById("global-progress-bar").style.display = "none";
    loadOrders();
    showView('view-orders-dashboard', false); 
    history.replaceState({ view: 'view-orders-dashboard' }, "", "#view-orders-dashboard");
    setLoadingState(false);
}

function startIdleTimer(context) {
    stopIdleTimer(); 
    currentIdleContext = context;
    idleTimer = setTimeout(() => {
        if (currentIdleContext === 'scan') speakVoice("Skanuj produkt");
        else if (currentIdleContext === 'numpad') speakVoice("Wprowadź ilość");
        startIdleTimer(currentIdleContext); 
    }, 10000); 
}

function stopIdleTimer() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
        currentIdleContext = null;
    }
}

function updateNetworkStatus() {
    const isOnline = navigator.onLine;
    document.querySelectorAll('.network-status-indicator').forEach(el => {
        el.className = 'network-status-indicator status-dot ' + (isOnline ? 'net-online' : 'net-offline');
    });
    if (!isOnline) {
        showError("Brak połączenia z internetem!", true);
    }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
    } catch (err) {}
}
document.addEventListener('visibilitychange', () => {
    if (wakeLock === null && document.visibilityState === 'visible') requestWakeLock();
});

function unlockAudioAPI() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);

    if ('speechSynthesis' in window) {
        let u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }
}
document.body.addEventListener('click', unlockAudioAPI, { once: true });
document.body.addEventListener('touchstart', unlockAudioAPI, { once: true });

function speakVoice(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); 
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pl-PL';
        utterance.rate = 1.1; 
        window.speechSynthesis.speak(utterance);
    }
}

function playSound(type) {
    if (!audioCtx) unlockAudioAPI();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'success') {
        osc.type = 'square'; 
        osc.frequency.setValueAtTime(2000, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime); 
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start(audioCtx.currentTime); 
        osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'error') {
        if ("vibrate" in navigator) navigator.vibrate([200]); 
        osc.type = 'sawtooth'; 
        osc.frequency.setValueAtTime(150, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); 
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
        osc.start(audioCtx.currentTime); 
        osc.stop(audioCtx.currentTime + 0.4);
    }
}

function isEanValid(ean) {
    if (ean === null || ean === undefined) return false;
    const str = String(ean).trim().toUpperCase();
    if (str === "" || str === "---" || str === "0" || str === "BRAK" || str === "FALSE" || str === "NULL") return false;
    return true;
}

function updateLockUI() {
    const btn = document.getElementById('btn-manual-lock');
    const iconClosed = document.getElementById('icon-lock-closed');
    const iconOpen = document.getElementById('icon-lock-open');
    
    if (isManualUnlocked) {
        btn.classList.add('unlocked');
        iconClosed.style.display = 'none'; iconOpen.style.display = 'block';
    } else {
        btn.classList.remove('unlocked');
        iconClosed.style.display = 'block'; iconOpen.style.display = 'none';
    }

    const manualAddBtn = document.getElementById('btn-manual-add');
    const scanBtn = document.getElementById('btn-scan-item');
    
    if (manualAddBtn && scanBtn) {
        if (targetItem) {
            const hasEan = isEanValid(targetItem.ean);
            if (!hasEan) {
                scanBtn.disabled = true;
                scanBtn.innerText = "BRAK KODU EAN";
                manualAddBtn.disabled = false; 
                manualAddBtn.classList.add('force-unlocked'); 
            } else {
                scanBtn.disabled = false;
                scanBtn.innerText = "SKANUJ PRODUKT";
                manualAddBtn.disabled = !isManualUnlocked; 
                manualAddBtn.classList.remove('force-unlocked');
            }
        } else {
            scanBtn.disabled = false;
            scanBtn.innerText = "SKANUJ PRODUKT";
            manualAddBtn.disabled = !isManualUnlocked;
            manualAddBtn.classList.remove('force-unlocked');
        }
    }
}

document.getElementById('btn-manual-lock').onclick = function() {
    isManualUnlocked = !isManualUnlocked;
    sessionStorage.setItem('manualUnlock', isManualUnlocked);
    updateLockUI();
    if (isManualUnlocked) speakVoice("Tryb ręcznego wprowadzania Aktywny");
};

document.getElementById('btn-refresh-orders').onclick = async function() {
    this.classList.add('spin-anim');
    await loadOrders();
    this.classList.remove('spin-anim');
};

window.onload = () => {
    updateNetworkStatus();
    updateLockUI();
    initApp();
};

// =========================================
// ZMODYFIKOWANA PALETA KOLORÓW (v5.0)
// Usunięto z palety męskiej wszelkie odcienie brązu/pomarańczy/złota, 
// aby algorytm nigdy więcej nie przydzielił ich przypadkowo.
// =========================================
const MALE_COLORS = [
    { hue: 215, saturation: 85, lightness: 25 }, // Głęboki Granat
    { hue: 350, saturation: 80, lightness: 25 }, // Ciemny Karmazyn (Bordo)
    { hue: 140, saturation: 75, lightness: 20 }, // Leśna Zieleń
    { hue: 270, saturation: 65, lightness: 28 }, // Ciemny Bakłażan
    { hue: 195, saturation: 90, lightness: 22 }, // Ciemny Błękit / Morski (ZASTĘPUJE BRĄZ!)
    { hue: 230, saturation: 70, lightness: 35 }, // Przygaszony Indygo
    { hue: 0,   saturation: 0,  lightness: 20 }, // Grafit (Ciemno-szary)
    { hue: 170, saturation: 80, lightness: 20 }  // Ciemny Szmaragd
];

const FEMALE_COLORS = [
    { hue: 340, saturation: 70, lightness: 60 }, // Pudrowy Róż
    { hue: 280, saturation: 55, lightness: 60 }, // Lawenda
    { hue: 15,  saturation: 80, lightness: 60 }, // Brzoskwinia
    { hue: 170, saturation: 60, lightness: 50 }, // Świeża Mięta
    { hue: 200, saturation: 75, lightness: 60 }, // Błękit Nieba
    { hue: 350, saturation: 75, lightness: 65 }  // Delikatny Koral
];

// Oczyszczony ze wszystkich wyjątków algorytm przydzielania kolorów
function getColorComponents(name) {
    if (!name) return MALE_COLORS[0];
    const cleanName = String(name).trim().toUpperCase();

    const firstName = cleanName.split(/\s+/)[0];
    // Sprawdzamy płeć (Wyjątek dla Kuby i Barnaby zostaje, bo to imiona męskie)
    const isFemale = firstName.endsWith('A') && firstName !== "KUBA" && firstName !== "BARNABA";

    const palette = isFemale ? FEMALE_COLORS : MALE_COLORS;

    // Matematyczny algorytm stałego hashowania
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return palette[Math.abs(hash) % palette.length];
}

async function initApp() {
    stopIdleTimer();
    document.getElementById("image-zoom-overlay").style.display = "none";
    
    showView('view-user-selection', false);
    history.replaceState({ view: 'view-user-selection' }, "", "#view-user-selection");
    
    document.getElementById("user-list").innerHTML = `<div class="loader-container"><div class="modern-spinner"></div><div class="loader-text-small">Autoryzacja...</div></div>`;
    
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_users`);
        const data = await resp.json();
        
        if(data.status === "success") {
            
            let alphaUsers = [...data.users].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pl'));
            let seenInitials = new Set();
            window.userInitialsMap = {};
            
            alphaUsers.forEach(u => {
                let name = String(u.name).trim();
                let parts = name.split(/\s+/);
                let initial = "??";
                
                if (parts.length >= 2) {
                    initial = `${parts[0][0].toUpperCase()}.${parts[1][0].toUpperCase()}.`;
                    if (seenInitials.has(initial) && parts[1].length >= 2) {
                        initial = `${parts[0][0].toUpperCase()}.${parts[1].substring(0, 2).toUpperCase()}.`;
                    }
                } else if (parts.length === 1) {
                    initial = name.substring(0, 2).toUpperCase() + ".";
                }
                
                seenInitials.add(initial);
                window.userInitialsMap[u.name] = initial;
            });

            data.users.sort((a, b) => {
                if (b.completed !== a.completed) return b.completed - a.completed;
                return String(a.name).localeCompare(String(b.name), 'pl'); 
            });
            
            renderUsers(data.users);
        }
        else showError(data.msg);
    } catch(e) { showError("Błąd połączenia z bazą"); }
}

function renderUsers(users) {
    const list = document.getElementById("user-list");
    list.innerHTML = "";
    userColorsMap = {}; 
    
    users.forEach((u) => {
        const btn = document.createElement("button");
        btn.className = "btn-user";
        
        const initials = window.userInitialsMap[u.name] || "??";
        
        // POBIERANIE KOLORU W 100% CZYSTO I RÓWNO DLA KAŻDEGO
        const colorComp = getColorComponents(u.name);
        userColorsMap[u.name] = colorComp;
        
        const baseColor = `hsl(${colorComp.hue}, ${colorComp.saturation}%, ${colorComp.lightness}%)`;
        const progressFillColor = `hsl(${colorComp.hue}, ${colorComp.saturation + 10}%, ${Math.max(20, colorComp.lightness - 15)}%)`;
        
        btn.style.backgroundColor = baseColor;

        const isLow = u.progress < 15;
        const textLeft = isLow ? `calc(${u.progress}% + 6px)` : `calc(${u.progress}% - 6px)`;
        const textTransform = isLow ? `translate(0, -50%)` : `translate(-100%, -50%)`;
        const textColor = isLow ? baseColor : "#ffffff";

        btn.innerHTML = `
            <div class="user-tile-top">
                <div class="user-tile-initials" style="color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">${initials}</div>
            </div>
            
            <div class="user-tile-bottom">
                <div class="user-completed-row">
                    <div class="user-box-icon">
                        <svg width="26" height="26" viewBox="0 0 24 24">
                          <polygon points="12,3 3,8 12,13 21,8" fill="rgba(255,255,255,0.9)"/>
                          <polygon points="3,9 3,18 12,23 12,14" fill="rgba(255,255,255,0.6)"/>
                          <polygon points="21,9 21,18 12,23 12,14" fill="rgba(255,255,255,0.3)"/>
                          <circle cx="18" cy="18" r="6" fill="#ffffff" />
                          <path d="M15.5 18l1.5 1.5 3-3" stroke="${baseColor}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </div>
                    <div class="user-completed-qty" style="color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">${u.completed}</div>
                </div>

                <div class="user-tile-progress-container">
                    <div class="user-tile-progress-track" style="background: #ffffff; border-color: #ffffff;">
                        <div class="user-tile-progress-fill" style="width:${u.progress}%; background-color: ${progressFillColor};"></div>
                        <div class="user-tile-progress-text" style="left: ${textLeft}; transform: ${textTransform}; color: ${textColor}; text-shadow: none;">${u.progress}%</div>
                    </div>
                </div>
                <div class="user-completed-label" style="color: rgba(255,255,255,0.9); text-shadow: none;">ZREALIZOWANO DZIŚ</div>
            </div>
        `;
        
        btn.onclick = () => {
            requestWakeLock(); 
            selectUser(u.name);
        };
        list.appendChild(btn);
    });
}

function selectUser(user) {
    currentUser = user; unlockAudioAPI(); 
    
    const nameDisplay = document.getElementById("display-user-name");
    nameDisplay.innerText = user;
    nameDisplay.className = ""; 
    nameDisplay.style.background = "none";
    nameDisplay.style.webkitTextFillColor = "initial";
    nameDisplay.style.textShadow = "none";
    
    const colorComp = userColorsMap[user] || getColorComponents(user);
    const baseColor = `hsl(${colorComp.hue}, ${colorComp.saturation}%, ${colorComp.lightness}%)`;
    nameDisplay.style.color = baseColor;
    
    activeDashboardTab = 'todo';
    activeSearchQuery = ""; 
    document.getElementById('btn-toggle-search').classList.remove('active-filter');
    
    switchTab('todo'); 
    showView('view-orders-dashboard'); 
    loadOrders();

    Html5Qrcode.getCameras().then(devices => {}).catch(err => {});
}

function switchTab(tab) {
    activeDashboardTab = tab;
    document.getElementById('tab-todo').classList.toggle('active', tab === 'todo');
    document.getElementById('tab-done').classList.toggle('active', tab === 'done');
    renderOrdersFromGlobal();
}

function updateSearchDisplay() {
    const disp = document.getElementById('search-input-display');
    if(tempSearchQuery === "") {
        disp.innerText = "Wpisz kod...";
        disp.style.color = "rgba(255,255,255,0.4)";
    } else {
        disp.innerText = tempSearchQuery;
        disp.style.color = "#fff";
    }
}

document.getElementById('btn-toggle-search').onclick = (e) => {
    e.stopPropagation();
    if (activeSearchQuery !== "") {
        activeSearchQuery = "";
        document.getElementById('btn-toggle-search').classList.remove('active-filter');
        renderOrdersFromGlobal();
    } else {
        tempSearchQuery = "";
        updateSearchDisplay();
        document.getElementById('search-modal').style.display = 'flex';
    }
};

document.querySelectorAll('.np-btn-search[data-val]').forEach(btn => {
    btn.onclick = (e) => {
        e.stopPropagation();
        tempSearchQuery += btn.getAttribute('data-val');
        updateSearchDisplay();
    };
});

document.getElementById('np-search-del').onclick = (e) => {
    e.stopPropagation();
    tempSearchQuery = tempSearchQuery.slice(0, -1);
    updateSearchDisplay();
};

document.getElementById('btn-search-cancel').onclick = () => {
    document.getElementById('search-modal').style.display = 'none';
};

document.getElementById('btn-search-ok').onclick = () => {
    if(tempSearchQuery.trim() !== "") {
        activeSearchQuery = tempSearchQuery.trim();
        document.getElementById('btn-toggle-search').classList.add('active-filter'); 
    }
    document.getElementById('search-modal').style.display = 'none';
    renderOrdersFromGlobal();
};

async function loadOrders() {
    const container = document.getElementById("orders-list-container");
    container.innerHTML = `<div class="loader-container"><div class="modern-spinner"></div><div class="loader-text-small">Pobieranie zadań...</div></div>`;
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_orders_list&userName=${encodeURIComponent(currentUser)}`);
        const data = await resp.json();
        
        if (data.orders.length === 0) {
            globalOrders = [];
            container.innerHTML = "<div class='view-label' style='text-transform:none; margin-top: 50px;'>Brak przypisanych zamówień.</div>";
            return;
        }

        globalOrders = data.orders; 
        renderOrdersFromGlobal();

    } catch(e) { showError("Błąd wczytywania zamówień"); }
}

function renderOrdersFromGlobal() {
    const container = document.getElementById("orders-list-container");
    container.innerHTML = "";

    const searchQuery = activeSearchQuery.toLowerCase();

    let filtered = globalOrders.filter(o => {
        if (activeDashboardTab === 'todo') return o.status !== 'U';
        return o.status === 'U';
    });

    if (searchQuery) {
        filtered = filtered.filter(o => 
            String(o.id).toLowerCase().includes(searchQuery) || 
            String(o.kontrahent).toLowerCase().includes(searchQuery)
        );
    }

    if (activeDashboardTab === 'todo') {
        filtered.sort((a, b) => {
            if (a.status === 'W' && b.status !== 'W') return -1;
            if (a.status !== 'W' && b.status === 'W') return 1;
            return 0;
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = "<div class='view-label' style='text-transform:none; margin-top: 50px; text-align:center;'>Brak wyników.</div>";
        return;
    }

    filtered.forEach(o => {
        let fillBg = o.progress === 0 ? 'background: rgba(10, 132, 255, 0.4);' : (o.progress === 100 ? 'background: rgba(50, 215, 75, 0.6);' : `background: linear-gradient(90deg, hsla(${40 + Math.floor((o.progress / 100) * 70)}, 100%, 40%, 0.6), hsla(${40 + Math.floor((o.progress / 100) * 70)}, 100%, 45%, 0.9));`);
        
        const isCompleted = o.status === 'U';
        const isFastTrack = (o.remPositions === 1); 
        
        const baton = document.createElement("div");
        baton.className = `order-baton ${isCompleted ? 'order-completed' : ''}`;
        
        baton.innerHTML = `
            <div class="order-content">
                <div class="order-header">
                    <div class="order-id-group">
                        <div class="order-id-wrapper">
                            <span class="baton-kontrahent">${o.kontrahent}</span>
                            <span class="kontrahent-sep">|</span>
                            <span class="order-id">${o.id}</span>
                        </div>
                        ${isFastTrack && !isCompleted ? '<span class="fast-track-icon">⚡</span>' : ''}
                    </div>
                    <div class="status-badge status-${o.status}">${o.status}</div>
                </div>

                <div class="order-details">
                    <div class="order-details-progress-fill" style="width:${o.progress}%; ${fillBg}"></div>
                    
                    <div class="order-workload">
                        <div class="order-box-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24">
                              <polygon points="12,3 3,8 12,13 21,8" fill="rgba(255,255,255,0.9)"/>
                              <polygon points="3,9 3,18 12,23 12,14" fill="rgba(255,255,255,0.6)"/>
                              <polygon points="21,9 21,18 12,23 12,14" fill="rgba(255,255,255,0.3)"/>
                              <path d="M12 13 L12 23" stroke="#fff" stroke-width="1.5"/>
                            </svg>
                        </div>
                        <span>${isCompleted ? 'Gotowe' : `${o.remPositions} poz. (${o.remPieces} szt.)`}</span>
                    </div>
                    <div class="order-percent">${o.progress}%</div>
                </div>
            </div>
        `;
        
        baton.onclick = () => {
            if (isCompleted) {
                showError("ZAMÓWIENIE ZAKOŃCZONE", true);
                return;
            }
            startOrder(o.id, o.remPositions);
        };
        
        container.appendChild(baton);
    });
}

function startOrder(id, itemsCount) {
    currentOrderID = id;
    isFirstScanPerOrder = true; 

    document.getElementById("header-main-row").style.display = "flex";
    document.getElementById("order-val").innerText = "Ładowanie..."; 
    document.getElementById("global-progress-bar").style.display = "block";
    speakVoice("Pozycji do uszykowania " + itemsCount); 
    fetchNext(0);
}

function setLoadingState(active) { 
    const card = document.querySelector('.task-card'); 
    if (active) { card.classList.add('loading-mode'); isProcessing = true; } 
    else { card.classList.remove('loading-mode'); isProcessing = false; } 
}

async function fetchNext(offset) {
    stopIdleTimer(); showView('task-panel'); setLoadingState(true); 
    try {
        const res = await fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&action=get_next&offset=${offset}`);
        const data = await res.json();
        
        if(data.status === "error") { showError("SERWER: " + data.msg); setLoadingState(false); return; }

        if(data.status === "next_item") {
            targetItem = data.item; currentOffset = data.current_offset;
            document.getElementById("global-progress-fill").style.width = data.progress + "%";
            
            document.getElementById("order-val").innerText = currentOrderID;

            document.getElementById("task-lp").innerText = targetItem.lp; 
            document.getElementById("task-name").innerText = targetItem.nazwa;
            document.getElementById("task-kat").innerText = targetItem.nr_kat; 
            document.getElementById("task-size").innerText = targetItem.rozmiar || "---";
            
            const qtyElem = document.getElementById("task-qty"), notesRow = document.getElementById("task-notes-row");
            qtyElem.innerText = targetItem.pozostalo;
            
            if (targetItem.uwagi && targetItem.uwagi.trim() !== "") { 
                document.getElementById("task-notes").innerText = targetItem.uwagi; notesRow.style.display = "block"; qtyElem.style.color = "var(--error)"; 
            } else { notesRow.style.display = "none"; qtyElem.style.color = "var(--accent-green)"; }
            
            const imgBox = document.getElementById("product-image-box"), imgElem = document.getElementById("task-img");
            imgElem.src = "";
            if(targetItem.nr_kat && targetItem.nr_kat !== "---") {
                let formattedKat = String(targetItem.nr_kat).trim().replace(/\s+/g, '_').replace(/\./g, '_');
                imgElem.onload = () => { imgBox.style.display = "flex"; }; imgElem.onerror = () => { imgBox.style.display = "none"; }; 
                imgElem.src = IMAGE_BASE_URL + "1_" + formattedKat + ".jpg";
            } else {
                imgBox.style.display = "none";
            }
            updateLockUI();
            setLoadingState(false);
        } else {
            playSound('success'); 
            speakVoice("Zamówienie kompletne!"); 
            alert("ZAMÓWIENIE ZREALIZOWANE");
            exitToDashboard();
        }
    } catch(e) { setLoadingState(false); showError("Błąd wyświetlania danych"); }
}

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

function triggerScanVisual(type) {
    const sv = document.getElementById("scanner-box");
    if(sv) {
        sv.classList.remove('scan-success', 'scan-error'); void sv.offsetWidth; 
        sv.classList.add(type === 'success' ? 'scan-success' : 'scan-error');
        setTimeout(() => { sv.classList.remove('scan-success', 'scan-error'); }, 800); 
    }
}

let torchOn = false;
document.getElementById('btn-torch').onclick = async () => {
    torchOn = !torchOn;
    try { await html5QrCode.applyVideoConstraints({ advanced: [{ torch: torchOn }] }); document.getElementById('btn-torch').classList.toggle('active', torchOn); } 
    catch(e) { torchOn = false; alert("Latarka niedostępna"); }
};

function startScannerView() {
    showView('scanner-box');
    document.getElementById("target-kat-val").innerText = targetItem.nr_kat;
    document.getElementById("target-size-val").innerText = targetItem.rozmiar || "---";
    document.getElementById("btn-torch").classList.remove('active');
    torchOn = false; 

    const windowWidth = window.innerWidth;
    const boxWidth = Math.min(windowWidth * 0.85, 380); 
    const boxHeight = 150; 
    
    const sv = document.getElementById("scanner-visual");
    if(sv) {
        sv.style.width = boxWidth + "px";
        sv.style.height = boxHeight + "px";
        sv.classList.remove('scanner-ready'); 
    }

    const config = {
        fps: 15, 
        qrbox: { width: boxWidth, height: boxHeight },
        formatsToSupport: [ Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.EAN_8 ],
        disableFlip: false
    };

    document.getElementById('scanner-loader').style.display = 'flex';
    
    let scanMatched = false; 
    let errorCooldown = false; 

    html5QrCode.start({ facingMode: "environment" }, config, (text) => {
        if (scanMatched || errorCooldown) return; 

        if(text.trim() === String(targetItem.ean)) {
            scanMatched = true;
            stopIdleTimer(); 
            
            triggerScanVisual('success'); 
            playSound('success');
            
            setTimeout(() => {
                if (html5QrCode.isScanning) {
                    html5QrCode.stop().then(() => {
                        if(targetItem.pozostalo > 1) { 
                            openNumpadModal();
                        } else { sendVal(1, "scan"); } 
                    }).catch(e => console.error("Kamera stop error", e));
                }
            }, 600); 
            
        } else { 
            errorCooldown = true; 
            stopIdleTimer(); 
            
            playSound('error');
            triggerScanVisual('error');
            showError("BŁĘDNY PRODUKT!", true); 
            
            setTimeout(() => {
                errorCooldown = false;
                if (document.getElementById('scanner-box').style.display !== 'none') {
                    startIdleTimer('scan');
                }
            }, 2000); 
        }
    }).then(() => {
        document.getElementById('scanner-loader').style.display = 'none';
        if(sv) sv.classList.add('scanner-ready');
        startIdleTimer('scan');
    }).catch(err => {
        document.getElementById('scanner-loader').style.display = 'none';
        showError("Błąd kamery. Odśwież stronę.", true); 
    });

    isFirstScanPerOrder = false;
}

document.getElementById("btn-scan-item").onclick = () => {
    if (!isEanValid(targetItem ? targetItem.ean : null)) return; 
    startScannerView();
};

document.getElementById('btn-manual-add').onclick = () => {
    const hasEan = isEanValid(targetItem ? targetItem.ean : null);
    if (!isManualUnlocked && hasEan) return; 
    speakVoice("Wprowadzanie ręczne");
    openNumpadModal();
};

function openNumpadModal() {
    currentInputValue = "0";
    document.getElementById("qty-input-display").innerText = "0";
    document.getElementById("qty-name").innerText = targetItem.nazwa;
    document.getElementById("qty-kat-val").innerHTML = "Nr Kat: " + targetItem.nr_kat;
    document.getElementById("qty-remain").innerText = targetItem.pozostalo;
    document.getElementById("qty-modal").style.display = "flex";
    
    if (document.getElementById('view-orders-dashboard').style.display === 'none' && html5QrCode.isScanning) {
        speakVoice(`Pobierz ${targetItem.pozostalo} sztuk`);
    }
    
    startIdleTimer('numpad');
}

document.getElementById("btn-qty-cancel").onclick = () => {
    document.getElementById("qty-modal").style.display = "none";
    stopIdleTimer(); 
    const hasEan = isEanValid(targetItem ? targetItem.ean : null);
    if(document.getElementById('scanner-box').style.display !== 'none' && hasEan) {
        startScannerView(); 
    }
};

function sendVal(q, mode) {
    stopIdleTimer(); 
    const btnOk = document.getElementById("btn-qty-ok");
    btnOk.classList.add("is-loading"); btnOk.disabled = true;

    let qInt = parseInt(q);
    fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&ean=${encodeURIComponent(targetItem.ean)}&qty=${qInt}&mode=${mode}&action=validate`)
    .then(res => res.json())
    .then(data => {
        btnOk.classList.remove("is-loading"); btnOk.disabled = false;
        
        if(data.status === "success") {
            document.getElementById("qty-modal").style.display = "none";
            if (qInt >= targetItem.pozostalo) speakVoice("Zatwierdzono pełne pobranie");
            else speakVoice(`Zatwierdzono ${qInt} sztuk`);
            fetchNext(currentOffset);
        } else {
            showError(data.msg);
        }
    })
    .catch(() => {
        btnOk.classList.remove("is-loading"); btnOk.disabled = false;
        showError("Błąd zapisu danych!");
    });
}

function flashDisplayError() {
    playSound('error'); speakVoice("Niewłaściwa ilość"); 
    const disp = document.getElementById("qty-input-display");
    disp.classList.add("flash-error"); setTimeout(() => disp.classList.remove("flash-error"), 300);
}

document.getElementById("btn-qty-ok").onclick = () => {
    let val = parseInt(currentInputValue);
    if(val <= 0 || isNaN(val) || val > targetItem.pozostalo) { 
        flashDisplayError(); 
        if (document.getElementById("qty-modal").style.display === "flex") startIdleTimer('numpad'); 
        return; 
    }
    const mode = document.getElementById('scanner-box').style.display === 'block' || html5QrCode.isScanning ? "scan" : "manual";
    sendVal(val, mode); 
};

function updateDisplay(val) { 
    currentInputValue = String(val); 
    document.getElementById("qty-input-display").innerText = currentInputValue; 
    if (document.getElementById("qty-modal").style.display === "flex") {
        startIdleTimer('numpad'); 
    }
}

document.querySelectorAll('.np-btn[data-val]').forEach(b => { b.onclick = () => { let newVal = currentInputValue === "0" ? b.dataset.val : currentInputValue + b.dataset.val; if(parseInt(newVal) > targetItem.pozostalo) flashDisplayError(); else updateDisplay(newVal); }; });
document.getElementById("np-clear").onclick = () => updateDisplay("0");
document.getElementById("np-del").onclick = () => { let newVal = currentInputValue.slice(0, -1); updateDisplay(newVal === "" ? "0" : newVal); };
document.querySelectorAll('.btn-quick[data-add]').forEach(btn => { btn.onclick = () => { let newVal = parseInt(currentInputValue) + parseInt(btn.getAttribute('data-add')); if (newVal > targetItem.pozostalo) { flashDisplayError(); btn.classList.add('flash-error'); setTimeout(() => { btn.classList.remove('flash-error'); }, 300); } else { updateDisplay(newVal); } }; });
document.getElementById('btn-quick-max').onclick = () => updateDisplay(targetItem.pozostalo);

function showView(id, pushToHistory = true) {
    stopIdleTimer(); 
    const currentView = getCurrentViewId();
    
    ['view-user-selection', 'view-orders-dashboard', 'scanner-box', 'task-panel'].forEach(v => { 
        document.getElementById(v).style.display = (v === id) ? 'flex' : 'none'; 
    });
    
    const titleBar = document.getElementById('header-title-bar');
    if (id === 'task-panel' || id === 'scanner-box') {
        titleBar.style.display = 'none'; 
    } else {
        titleBar.style.display = 'flex'; 
    }

    if (pushToHistory && currentView !== id) {
        history.pushState({ view: id }, "", "#" + id);
    }
}

function showError(m, muteVoice = false) {
    if (!muteVoice) {
        playSound('error');
        const msgUpper = m.toUpperCase();
        if(msgUpper.includes("ILOŚĆ") || msgUpper.includes("PRZEKROCZONO")) {
            speakVoice("Niewłaściwa ilość");
        } else if (msgUpper.includes("PRODUKT")) {
            speakVoice("Niewłaściwy produkt");
        } else {
            speakVoice("Błąd, sprawdź ekran");
        }
    }
    
    const o = document.getElementById("error-overlay");
    o.style.display = "flex";
    document.getElementById("error-text").innerText = m;
    setTimeout(() => { o.style.display = "none"; }, 2000);
}

document.getElementById("btn-logout").onclick = () => {
    sessionStorage.removeItem('manualUnlock'); isManualUnlocked = false; updateLockUI();
    stopIdleTimer(); 
    document.getElementById("header-main-row").style.display = "none"; 
    document.getElementById("global-progress-bar").style.display = "none"; 
    initApp(); 
};

document.getElementById("btn-back-scan").onclick = () => { 
    stopIdleTimer();
    if (html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            showView('task-panel', false);
            history.replaceState({ view: 'task-panel' }, "", "#task-panel");
        }).catch(() => {
            showView('task-panel', false);
            history.replaceState({ view: 'task-panel' }, "", "#task-panel");
        });
    } else {
        showView('task-panel', false);
        history.replaceState({ view: 'task-panel' }, "", "#task-panel");
    }
};

// Usunięto potwierdzenie "Opuścić zamówienie?" (Zgodnie z prośbą)
document.getElementById("btn-finish-icon").onclick = () => { 
    exitToDashboard();
};

document.getElementById("btn-prev").onclick = () => { if(!isProcessing) fetchNext(currentOffset - 1); };
document.getElementById("btn-next").onclick = () => { if(!isProcessing) fetchNext(currentOffset + 1); };
