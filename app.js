const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw54rF2uN7rdP0eRfJz2VwD4pgt2alzof7CdUsPJkQlb4rHCmjQ7_jDYl941rO9a6yS/exec"; 
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/"; 

let currentUser = null, currentOrderID = null, targetItem = null;
let currentOffset = 0, currentInputValue = "0", isProcessing = false; 
const html5QrCode = new Html5Qrcode("reader");

let audioCtx = null;
let wakeLock = null;
let scanIdleTimer = null; // Zmienna dla timera bezczynności skanera

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
requestWakeLock();

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
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.15);
    } else if (type === 'error') {
        if ("vibrate" in navigator) navigator.vibrate(300); 
        osc.type = 'square'; 
        osc.frequency.setValueAtTime(150, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.3);
    }
}

function triggerScanVisual(type) {
    const sv = document.getElementById("scanner-visual");
    if(sv) {
        sv.classList.remove('scan-success', 'scan-error');
        void sv.offsetWidth; 
        sv.classList.add(type === 'success' ? 'scan-success' : 'scan-error');
        setTimeout(() => { sv.classList.remove('scan-success', 'scan-error'); }, 800); 
    }
}

function flashDisplayError() {
    playSound('error');
    speakVoice("Niewłaściwa ilość"); 
    const disp = document.getElementById("qty-input-display");
    disp.classList.add("flash-error");
    setTimeout(() => disp.classList.remove("flash-error"), 300);
}

// LOGIKA TIMERA BEZCZYNNOŚCI (5 SEKUND)
function startIdleTimer() {
    stopIdleTimer(); // Czyścimy poprzedni, by się nie nakładały
    scanIdleTimer = setTimeout(() => {
        speakVoice("Skanuj produkt");
        startIdleTimer(); // Zapętlamy, by przypominał co 5 sekund, aż pracownik coś zrobi
    }, 5000);
}

function stopIdleTimer() {
    if (scanIdleTimer) {
        clearTimeout(scanIdleTimer);
        scanIdleTimer = null;
    }
}

window.onload = () => initApp();

async function initApp() {
    stopIdleTimer();
    document.getElementById("image-zoom-overlay").style.display = "none";
    showView('view-user-selection');
    document.getElementById("user-list").innerHTML = "<div class='loader-text'>Wczytywanie operatorów...</div>";
    
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_users`);
        const data = await resp.json();
        if(data.status === "success") renderUsers(data.users);
        else showError(data.msg);
    } catch(e) { showError("Błąd połączenia z bazą"); }
}

function renderUsers(users) {
    const list = document.getElementById("user-list");
    list.innerHTML = "";
    users.forEach(u => {
        const btn = document.createElement("button");
        btn.className = "btn-user";
        btn.innerHTML = `<div class="user-avatar-icon">👤</div><span>${u}</span>`;
        btn.onclick = () => selectUser(u);
        list.appendChild(btn);
    });
}

function selectUser(user) {
    currentUser = user;
    unlockAudioAPI(); 
    document.getElementById("display-user-name").innerText = user;
    showView('view-orders-dashboard');
    loadOrders();
}

async function loadOrders() {
    const container = document.getElementById("orders-list-container");
    container.innerHTML = "<div class='loader-text'>Ładowanie przypisanych zadań...</div>";
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_orders_list&userName=${encodeURIComponent(currentUser)}`);
        const data = await resp.json();
        container.innerHTML = "";
        
        if (data.orders.length === 0) {
            container.innerHTML = "<div class='view-label' style='text-transform:none;'>Brak przypisanych zamówień.</div>";
            return;
        }

        data.orders.forEach(o => {
            let fillBg;
            if (o.progress === 0) fillBg = 'background: rgba(10, 132, 255, 0.15);';
            else if (o.progress === 100) fillBg = 'background: rgba(50, 215, 75, 0.25);';
            else {
                const hue = 40 + Math.floor((o.progress / 100) * 70);
                fillBg = `background: linear-gradient(90deg, hsla(${hue}, 100%, 45%, 0.1), hsla(${hue}, 100%, 40%, 0.4));`;
            }

            const baton = document.createElement("div");
            baton.className = "order-baton";
            baton.innerHTML = `
                <div class="order-progress-fill" style="width:${o.progress}%; ${fillBg}"></div>
                <div class="order-content">
                    <div class="order-id">${o.id}</div>
                    <div class="order-meta-group">
                        <span class="order-percent">${o.progress}%</span>
                        <div class="status-badge status-${o.status}">${o.status}</div>
                    </div>
                </div>`;
            baton.onclick = () => startOrder(o.id, o.itemsCount);
            container.appendChild(baton);
        });
    } catch(e) { showError("Błąd wczytywania zamówień"); }
}

function startOrder(id, itemsCount) {
    currentOrderID = id;
    document.getElementById("header-main-row").style.display = "flex";
    document.getElementById("order-val").innerText = id;
    document.getElementById("global-progress-bar").style.display = "block";
    speakVoice("Ilość pozycji zamówienia " + itemsCount); 
    fetchNext(0);
}

function setLoadingState(active) { 
    const card = document.querySelector('.task-card'); 
    if (active) { card.classList.add('loading-mode'); isProcessing = true; } 
    else { card.classList.remove('loading-mode'); isProcessing = false; } 
}

async function fetchNext(offset) {
    stopIdleTimer();
    showView('task-panel');
    setLoadingState(true);
    try {
        const res = await fetch(`${SCRIPT
