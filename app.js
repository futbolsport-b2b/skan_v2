const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyxJ78_K_WaaWMT4C5X80gKOTKM4gipFlVVYJIoEE2_QPTVdtN7xxsvoaceRPcvMjzd/exec"; 
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/"; 

let currentUser = null, currentOrderID = null, targetItem = null;
let currentOffset = 0, currentInputValue = "0", isProcessing = false; 
const html5QrCode = new Html5Qrcode("reader");

let audioCtx = null;
let wakeLock = null;
let scanIdleTimer = null; 

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

function startIdleTimer() {
    stopIdleTimer(); 
    scanIdleTimer = setTimeout(() => {
        speakVoice("Skanuj produkt");
        startIdleTimer(); 
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
    
    document.getElementById("user-list").innerHTML = `
        <div class="loader-container">
            <div class="modern-spinner"></div>
            <div class="loader-text-small">Autoryzacja...</div>
        </div>
    `;
    
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
    container.innerHTML = `
        <div class="loader-container">
            <div class="modern-spinner"></div>
            <div class="loader-text-small">Pobieranie zadań...</div>
        </div>
    `;
    try {
        const resp = await fetch(`${SCRIPT_URL}?action=get_orders_list&userName=${encodeURIComponent(currentUser)}`);
        const data = await resp.json();
        container.innerHTML = "";
        
        if (data.orders.length === 0) {
            container.innerHTML = "<div class='view-label' style='text-transform:none; margin-top: 50px;'>Brak przypisanych zamówień.</div>";
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
    speakVoice("Ilość pozycji do uszykowania " + itemsCount); 
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
        const res = await fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&action=get_next&offset=${offset}`);
        const data = await res.json();
        
        if(data.status === "error") {
            showError("SERWER: " + data.msg);
            setLoadingState(false);
            return;
        }

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
            const uwagiStr = targetItem.uwagi ? String(targetItem.uwagi).trim() : "";
            
            if (uwagiStr !== "") { 
                document.getElementById("task-notes").innerText = uwagiStr; 
                notesRow.style.display = "block"; 
                qtyElem.style.color = "var(--error)"; 
            } else { 
                notesRow.style.display = "none"; 
                qtyElem.style.color = "var(--accent-green)";
            }
            
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
            playSound('success');
            speakVoice("Zamówienie kompletne!");
            alert("ZAMÓWIENIE ZREALIZOWANE");
            loadOrders();
            showView('view-orders-dashboard');
            setLoadingState(false);
        }
    } catch(e) {
        setLoadingState(false);
        showError("Błąd wyświetlania danych"); 
    }
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

let torchOn = false;
document.getElementById('btn-torch').onclick = async () => {
    torchOn = !torchOn;
    try {
        await html5QrCode.applyVideoConstraints({ advanced: [{ torch: torchOn }] });
        document.getElementById('btn-torch').classList.toggle('active', torchOn);
    } catch(e) { torchOn = false; alert("Latarka niedostępna"); }
};

// --- ZMODYFIKOWANA OPCJA SKANERA (TYLKO OPTYMALIZACJA) ---
async function startScannerView() {
    showView('scanner-box');
    document.getElementById("target-kat-val").innerText = targetItem.nr_kat;
    document.getElementById("target-size-val").innerText = targetItem.rozmiar || "---";
    document.getElementById("btn-torch").classList.remove('active');
    torchOn = false;

    startIdleTimer(); 

    // Optymalizacja skanera
    const formats = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_8
    ];

    const config = {
        fps: 15, 
        qrbox: { width: 300, height: 120 }, 
        formatsToSupport: formats,
        aspectRatio: 1.777778, 
        disableFlip: false 
    };

    const cameraConstraints = {
        facingMode: "environment",
        width: { ideal: 1280, min: 640 }, 
        height: { ideal: 720, min: 480 },
        advanced: [{ focusMode: "continuous" }] 
    };

    try {
        if (html5QrCode.isScanning) {
            await html5QrCode.stop();
        }
        await html5QrCode.start(cameraConstraints, config, (text) => {
            
            stopIdleTimer(); 
            
            if(text.trim() === String(targetItem.ean)) {
                triggerScanVisual('success');
                playSound('success');
                
                if (html5QrCode.isScanning) {
                    html5QrCode.stop().then(() => {
                        if(targetItem.pozostalo > 1) { 
                            currentInputValue = "0";
                            document.getElementById("qty-input-display").innerText = "0";
                            document.getElementById("qty-name").innerText = targetItem.nazwa;
                            document.getElementById("qty-kat-val").innerHTML = "Nr Kat: " + targetItem.nr_kat;
                            document.getElementById("qty-remain").innerText = targetItem.pozostalo;
                            document.getElementById("qty-modal").style.display = "flex";
                            speakVoice(`Pobierz ${targetItem.pozostalo} sztuk`);
                        } else { sendVal(1); }
                    }).catch(e => console.error("Kamera stop error", e));
                }
            } else { 
                triggerScanVisual('error');
                showError("BŁĘDNY PRODUKT!"); 
                setTimeout(() => startIdleTimer(), 2500);
            }
        });
    } catch(e) { showError("Błąd kamery lub brak wsparcia HD"); }
}

document.getElementById("btn-scan-item").onclick = () => startScannerView();

document.getElementById("btn-qty-cancel").onclick = () => {
    document.getElementById("qty-modal").style.display = "none";
    startScannerView(); 
};

function sendVal(q) {
    stopIdleTimer();
    const btnOk = document.getElementById("btn-qty-ok");
    btnOk.classList.add("is-loading");
    btnOk.disabled = true;

    let qInt = parseInt(q);
    fetch(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&ean=${encodeURIComponent(targetItem.ean)}&qty=${qInt}&action=validate`)
    .then(res => res.json())
    .then(data => {
        btnOk.classList.remove("is-loading");
        btnOk.disabled = false;
        
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
        btnOk.classList.remove("is-loading");
        btnOk.disabled = false;
        showError("Błąd zapisu danych!");
    });
}

function showView(id) {
    ['view-user-selection', 'view-orders-dashboard', 'scanner-box', 'task-panel'].forEach(v => {
        document.getElementById(v).style.display = (v === id) ? 'block' : 'none';
    });
}

function showError(m) {
    playSound('error');
    const msgUpper = m.toUpperCase();
    if(msgUpper.includes("ILOŚĆ") || msgUpper.includes("PRZEKROCZONO")) {
        speakVoice("Niewłaściwa ilość");
    } else if (msgUpper.includes("PRODUKT")) {
        speakVoice("Niewłaściwy produkt");
    } else {
        speakVoice("Błąd, sprawdź ekran");
    }
    
    const o = document.getElementById("error-overlay");
    o.style.display = "flex";
    document.getElementById("error-text").innerText = m;
    setTimeout(() => { o.style.display = "none"; }, 2500);
}

function updateDisplay(val) {
    currentInputValue = String(val);
    document.getElementById("qty-input-display").innerText = currentInputValue;
}

document.getElementById("btn-qty-ok").onclick = () => {
    let val = parseInt(currentInputValue);
    if(val <= 0 || isNaN(val) || val > targetItem.pozostalo) {
        flashDisplayError();
        return;
    }
    sendVal(val); 
};

document.querySelectorAll('.np-btn[data-val]').forEach(b => {
    b.onclick = () => {
        let newVal = currentInputValue === "0" ? b.dataset.val : currentInputValue + b.dataset.val;
        if(parseInt(newVal) > targetItem.pozostalo) flashDisplayError();
        else updateDisplay(newVal);
    };
});

document.getElementById("np-clear").onclick = () => updateDisplay("0");
document.getElementById("np-del").onclick = () => { 
    let newVal = currentInputValue.slice(0, -1);
    updateDisplay(newVal === "" ? "0" : newVal);
};

document.querySelectorAll('.btn-quick[data-add]').forEach(btn => {
    btn.onclick = () => {
        let newVal = parseInt(currentInputValue) + parseInt(btn.getAttribute('data-add'));
        if (newVal > targetItem.pozostalo) {
            flashDisplayError();
            btn.classList.add('flash-error');
            setTimeout(() => { btn.classList.remove('flash-error'); }, 300);
        } else {
            updateDisplay(newVal);
        }
    };
});

document.getElementById('btn-quick-max').onclick = () => updateDisplay(targetItem.pozostalo);

document.getElementById("btn-logout").onclick = () => {
    stopIdleTimer();
    document.getElementById("header-main-row").style.display = "none";
    document.getElementById("global-progress-bar").style.display = "none";
    initApp();
};

document.getElementById("btn-back-scan").onclick = () => { 
    stopIdleTimer(); 
    if (html5QrCode.isScanning) {
        html5QrCode.stop().then(() => showView('task-panel')).catch(() => showView('task-panel'));
    } else {
        showView('task-panel');
    }
};

document.getElementById("btn-prev").onclick = () => { if(!isProcessing) fetchNext(currentOffset - 1); };
document.getElementById("btn-next").onclick = () => { if(!isProcessing) fetchNext(currentOffset + 1); };
document.getElementById("btn-finish-icon").onclick = () => { 
    stopIdleTimer();
    if(confirm("Opuścić zamówienie?")) {
        document.getElementById("header-main-row").style.display = "none";
        document.getElementById("global-progress-bar").style.display = "none";
        loadOrders();
        showView('view-orders-dashboard');
    }
};
