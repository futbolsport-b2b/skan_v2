const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxsWLv6SCzhkJaythMklT1sMlJMIQWIECUjF8Xms6c7xcG2N86Z5uVcxyE5VzxhvAxR/exec"; 
const IMAGE_BASE_URL = "https://b2b.futbolsport.pl/gfx-base/s_1/gfx/products/big/"; 

let currentOrderID = null, currentOffset = 0, targetItem = null, isProcessing = false;
let currentInputValue = "0"; 
let zoomTimeout = null; 
const html5QrCode = new Html5Qrcode("reader");
let audioCtx = null;
let wakeLock = null;

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error("SW Reg Error:", err));
}

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

function goFullscreen() {
    if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(err => console.warn(err));
        } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.webkitRequestFullscreen();
        }
    }
}

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
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]); 
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.8, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.frequency.setValueAtTime(220, audioCtx.currentTime + 0.15); 
        gainNode.gain.setValueAtTime(0.8, audioCtx.currentTime + 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
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
        setTimeout(() => { 
            sv.classList.remove('scan-success', 'scan-error'); 
        }, 800); 
    }
}

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

async function fetchWithRetry(url, retries = 3, backoff = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network error');
            return await response.json();
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(res => setTimeout(res, backoff * Math.pow(2, i))); 
        }
    }
}

function prefetchImage(nr_kat) {
    if (!nr_kat || nr_kat === "---") return;
    const formattedKat = String(nr_kat).trim().replace(/\s+/g, '_');
    const imgUrl = IMAGE_BASE_URL + "1_" + formattedKat + ".jpg";
    const img = new Image();
    img.src = imgUrl;
}

let torchOn = false;
document.getElementById('btn-torch').onclick = async () => {
    torchOn = !torchOn;
    try {
        await html5QrCode.applyVideoConstraints({ advanced: [{ torch: torchOn }] });
        document.getElementById('btn-torch').classList.toggle('active', torchOn);
    } catch(e) {
        torchOn = false;
        alert("Latarka nie jest obsługiwana w tym urządzeniu.");
    }
};

document.getElementById('btn-back-scan').onclick = () => {
    isProcessing = true;
    html5QrCode.stop().then(() => {
        isProcessing = false;
        document.getElementById("scanner-box").style.display = "none";
        document.getElementById("btn-torch").style.display = "none";
        document.getElementById("btn-back-scan").style.display = "none";
        document.getElementById("task-panel").style.display = "block";
    }).catch(() => {
        isProcessing = false;
        document.getElementById("scanner-box").style.display = "none";
        document.getElementById("task-panel").style.display = "block";
    });
};

document.getElementById('task-img').onclick = function() {
    const overlay = document.getElementById('image-zoom-overlay');
    document.getElementById('zoomed-img').src = this.src;
    overlay.style.display = 'flex';
    void overlay.offsetWidth; 
    overlay.classList.add('show');
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(closeZoom, 3000);
};

function closeZoom() {
    const overlay = document.getElementById('image-zoom-overlay');
    overlay.classList.remove('show');
    setTimeout(() => overlay.style.display = 'none', 300);
}
document.getElementById('image-zoom-overlay').onclick = closeZoom;

async function fetchNext(offset) {
    setLoadingState(true); 
    currentOffset = offset;
    try {
        const res = await fetchWithRetry(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&action=get_next&offset=${offset}`);
        
        if(res.progress !== undefined) {
            document.getElementById("global-progress-fill").style.width = res.progress + "%";
        }

        if (res.status === "next_item") {
            targetItem = res.item; 
            currentOffset = res.current_offset;
            
            if(res.prefetch_kat) prefetchImage(res.prefetch_kat);

            setTimeout(() => {
                const m = document.getElementById("qty-modal");
                if (m.style.display === "flex") {
                    m.style.display = "none";
                    document.getElementById("btn-qty-ok").classList.remove("is-loading");
                    document.getElementById("btn-qty-ok").disabled = false;
                }

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

                document.getElementById("task-panel").style.display = "block"; 
                setLoadingState(false);
            }, 350);
        } else { 
            speakVoice("Zamówienie kompletne!");
            playSound('success'); 
            alert("ZAMÓWIENIE ZREALIZOWANE"); 
            location.reload(); 
        }
    } catch (e) {
        setLoadingState(false); 
        showError("Brak połączenia! Spróbuj ponownie.");
    }
}

function onScan(text) {
    if (isProcessing) return; 
    const code = text.trim();
    
    // ZMIANA: Natychmiastowy sygnał fizycznego odczytania kodu (jak w fizycznym urządzeniu)
    playSound('success');
    
    // START - Logika pierwszego kodu QR
    if (!currentOrderID) {
        isProcessing = true; 
        document.getElementById("qr-instruction").innerText = "WERYFIKACJA...";
        
        fetchWithRetry(`${SCRIPT_URL}?orderID=${encodeURIComponent(code)}&action=check_order`)
        .then(res => {
            if (res.status === "success") {
                triggerScanVisual('success'); // Celownik na zielono
                currentOrderID = code; 

                // ZMIANA: Przedłużone opóźnienie aby oko ludzkie zarejestrowało zieloną ramkę
                setTimeout(() => {
                    html5QrCode.stop().then(() => { 
                        document.getElementById("scanner-box").style.display = "none"; 
                        document.getElementById("btn-torch").style.display = "none";
                        document.getElementById("btn-back-scan").style.display = "none";
                        document.getElementById("brand-title").style.display = "none"; 
                        
                        document.getElementById("startup-screen-elements").style.display = "none";
                        document.getElementById("header-main-row").style.display = "flex";
                        document.getElementById("qr-instruction").innerText = "ZESKANUJ KOD QR"; 
                        
                        const orderValElem = document.getElementById("order-val");
                        orderValElem.innerHTML = `${code}<br><span style="font-size:14px; color:var(--text-sec); display:block; margin-top:8px;">DOTKNIJ ABY ROZPOCZĄĆ</span>`;
                        orderValElem.classList.add("breathing"); 
                        orderValElem.style.textAlign = "center";
                        orderValElem.style.fontSize = "32px";
                        orderValElem.style.color = "#fff"; 
                        orderValElem.style.cursor = "pointer";
                        orderValElem.style.padding = "20px";
                        orderValElem.style.background = "var(--success)";
                        orderValElem.style.borderRadius = "16px";
                        orderValElem.style.marginTop = "15vh";
                        orderValElem.style.width = "100%";
                        
                        orderValElem.onclick = () => {
                            goFullscreen();
                            unlockAudioAPI();

                            // ZMIANA: Usunięto tekst "Dotknij aby rozpocząć"
                            speakVoice(`Ilość pozycji zamówienia ${res.items_count}`);

                            orderValElem.classList.remove("breathing");
                            orderValElem.innerHTML = code;
                            orderValElem.style.textAlign = "left";
                            orderValElem.style.fontSize = "26px";
                            orderValElem.style.background = "transparent";
                            orderValElem.style.padding = "0";
                            orderValElem.style.marginTop = "0";
                            orderValElem.onclick = null;
                            orderValElem.style.cursor = "default";

                            document.getElementById("global-progress-bar").style.display = "block"; 
                            document.getElementById("btn-finish-icon").style.display = "flex"; 
                            
                            fetchNext(0); 
                        };
                    });
                }, 600); 

            } else {
                // Kod był zły -> Ramka na czerwono i buczenie "error" z błędem na ekranie
                triggerScanVisual('error');
                showError("NIE ZNALEZIONO ZAMÓWIENIA", true); // "true" blokuje podwójny dźwięk
                document.getElementById("qr-instruction").innerText = "ZESKANUJ KOD QR";
            }
        })
        .catch(() => {
            triggerScanVisual('error');
            showError("Błąd sieci. Spróbuj ponownie.");
            document.getElementById("qr-instruction").innerText = "ZESKANUJ KOD QR";
        });
        
    } else if (code === targetItem.ean) {
        // SKANOWANIE EAN PRODUKTU
        isProcessing = true;
        triggerScanVisual('success');
        
        setTimeout(() => { 
            html5QrCode.stop().then(() => { 
                document.getElementById("scanner-box").style.display = "none"; 
                document.getElementById("btn-torch").style.display = "none";
                document.getElementById("btn-back-scan").style.display = "none";
                
                if (targetItem.pozostalo > 1) {
                    showQty(); 
                } else {
                    sendVal(1); 
                }
            }); 
        }, 600); 
    } else { 
        triggerScanVisual('error');
        showError("BŁĘDNY PRODUKT"); 
    }
}

async function startQR() { 
    isProcessing = false; 
    document.body.className = "qr-mode"; 
    
    document.getElementById("header-main-row").style.display = "none";
    document.getElementById("startup-screen-elements").style.display = "flex";
    
    document.getElementById("scanner-instruction").style.display = "none"; 
    document.getElementById("btn-torch").style.display = "none"; 
    document.getElementById("btn-back-scan").style.display = "none"; 
    
    const qrInst = document.getElementById("qr-instruction");
    qrInst.innerText = "ZESKANUJ KOD QR";
    qrInst.style.cursor = "default";
    qrInst.onclick = null;
    
    try {
        await html5QrCode.start({ facingMode: "environment" }, { fps: 25 }, onScan);
    } catch (err) {
        console.warn("Wymagana zgoda na kamerę:", err);
        qrInst.innerText = "KLIKNIJ, ABY WŁĄCZYĆ KAMERĘ";
        qrInst.style.cursor = "pointer";
        qrInst.onclick = () => startQR(); 
    }
}

async function startEAN() {
    isProcessing = false; 
    document.body.className = "ean-mode"; 
    document.getElementById("target-kat-val").innerText = targetItem.nr_kat;
    document.getElementById("target-size-val").innerText = targetItem.rozmiar || "---"; 
    document.getElementById("scanner-instruction").style.display = "block";
    
    document.getElementById("btn-torch").style.display = "flex"; 
    document.getElementById("btn-back-scan").style.display = "flex"; 
    document.getElementById("btn-torch").classList.remove('active');
    torchOn = false;
    
    try {
        await html5QrCode.start({ facingMode: "environment" }, { fps: 25 }, onScan);
    } catch (e) {
        showError("BŁĄD KAMERY");
    }
}

function updateDisplay(val) {
    currentInputValue = String(val);
    document.getElementById("qty-input-display").innerText = currentInputValue;
}

function flashDisplayError() {
    playSound('error');
    speakVoice("Niewłaściwa ilość"); 
    const disp = document.getElementById("qty-input-display");
    disp.classList.add("flash-error");
    setTimeout(() => disp.classList.remove("flash-error"), 300);
}

document.querySelectorAll('.np-btn[data-val]').forEach(btn => {
    btn.onclick = () => {
        let digit = btn.getAttribute('data-val');
        let newVal = currentInputValue === "0" ? digit : currentInputValue + digit;
        if (parseInt(newVal) > targetItem.pozostalo) {
            flashDisplayError();
        } else {
            updateDisplay(newVal);
        }
    };
});

document.getElementById('np-del').onclick = () => {
    let newVal = currentInputValue.slice(0, -1);
    updateDisplay(newVal === "" ? "0" : newVal);
};

document.getElementById('np-clear').onclick = () => updateDisplay("0");

document.querySelectorAll('.btn-quick[data-add]').forEach(btn => {
    btn.onclick = () => {
        let addVal = parseInt(btn.getAttribute('data-add'));
        let newVal = parseInt(currentInputValue) + addVal;
        
        if (newVal > targetItem.pozostalo) {
            playSound('error'); 
            speakVoice("Niewłaściwa ilość"); 
            btn.classList.add('flash-error'); 
            setTimeout(() => { btn.classList.remove('flash-error'); }, 300); 
        } else {
            updateDisplay(newVal);
        }
    };
});

document.getElementById('btn-quick-max').onclick = () => updateDisplay(targetItem.pozostalo);

function showQty() {
    const m = document.getElementById("qty-modal"); 
    document.getElementById("qty-name").innerText = targetItem.nazwa;
    
    const sizeDisplay = targetItem.rozmiar || "---";
    document.getElementById("qty-kat-val").innerHTML = "Nr Kat: <span class='kat-number'>" + targetItem.nr_kat + "</span> <span class='meta-separator'>|</span> Roz: <span class='size-number'>" + sizeDisplay + "</span>"; 
    document.getElementById("qty-remain").innerText = targetItem.pozostalo;
    
    document.getElementById("btn-qty-ok").classList.remove("is-loading");
    document.getElementById("btn-qty-ok").disabled = false;

    updateDisplay("0"); 
    m.style.display = "flex"; 
    
    speakVoice(`Pobierz ${targetItem.pozostalo} sztuk`);
}

function sendVal(q) {
    if(!q || isNaN(q) || parseInt(q) <= 0) { flashDisplayError(); return; }

    const btnOk = document.getElementById("btn-qty-ok");
    btnOk.classList.add("is-loading");
    btnOk.disabled = true;

    fetchWithRetry(`${SCRIPT_URL}?orderID=${encodeURIComponent(currentOrderID)}&ean=${encodeURIComponent(targetItem.ean)}&qty=${q}&action=validate`)
    .then(res => { 
        if (res.status === "success") { 
            let qInt = parseInt(q);
            if (qInt >= targetItem.pozostalo) {
                speakVoice("Zatwierdzono pełne pobranie");
            } else {
                speakVoice(`Zatwierdzono ${qInt} sztuk`);
            }
            fetchNext(currentOffset); 
        } else { 
            btnOk.classList.remove("is-loading");
            btnOk.disabled = false;
            showError(res.msg); 
        } 
    })
    .catch(() => {
        btnOk.classList.remove("is-loading");
        btnOk.disabled = false;
        showError("Błąd zapisu! Sprawdź połączenie Wi-Fi.");
    });
}

function showError(m, preventDoubleSound = false) { 
    isProcessing = true; 
    
    if(!preventDoubleSound) {
        playSound('error'); 
    } else {
        // Ponieważ w onScan zrobiliśmy już playSound('success') (jako potwierdzenie zczytania fizycznego)
        // Odtwarzamy dźwięk błędu z opóźnieniem jako odpowiedź serwera: pip... BUZZ!
        setTimeout(() => { playSound('error'); }, 150); 
    }
    
    if(m && m.toUpperCase().includes("ILOŚĆ")) {
        speakVoice("Niewłaściwa ilość");
    } else if (m && (m.toUpperCase().includes("POŁĄCZENIE") || m.toUpperCase().includes("ZAPISU") || m.toUpperCase().includes("SIECI"))) {
        speakVoice("Błąd sieci");
    } else if (m && m.toUpperCase().includes("NIE ZNALEZIONO")) {
        // Wyciszono
    } else if (m && m.toUpperCase().includes("ZREALIZOWANE")) {
        speakVoice("Zamówienie zrealizowane");
    } else {
        speakVoice("Zły produkt");
    }

    const o = document.getElementById("error-overlay"); 
    document.getElementById("error-text").innerText = m; 
    o.style.display = "flex"; 
    setTimeout(() => { o.style.display = "none"; isProcessing = false; }, 2000); 
}

let touchStartX = 0;
const taskPanel = document.getElementById('task-panel');
taskPanel.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
taskPanel.addEventListener('touchend', e => {
    let touchEndX = e.changedTouches[0].screenX;
    if (touchEndX < touchStartX - 50 && !isProcessing) fetchNext(currentOffset + 1); 
    if (touchEndX > touchStartX + 50 && !isProcessing) fetchNext(currentOffset - 1); 
}, {passive: true});

document.getElementById("btn-qty-ok").onclick = () => sendVal(currentInputValue);
document.getElementById("btn-scan-item").onclick = () => { 
    document.getElementById("task-panel").style.display = "none"; 
    document.getElementById("scanner-box").style.display = "block"; 
    startEAN(); 
};
document.getElementById("btn-prev").onclick = () => fetchNext(currentOffset - 1);
document.getElementById("btn-next").onclick = () => fetchNext(currentOffset + 1);
document.getElementById("btn-finish-icon").onclick = () => { if(confirm("Zakończyć to zamówienie?")) location.reload(); };
document.getElementById("btn-qty-cancel").onclick = () => { document.getElementById("qty-modal").style.display = "none"; fetchNext(currentOffset); };

// AUTOSTART KAMERY
startQR();
