// Contact QR codes. A scanned value is turned into a username only; the page never navigates to a URL from a code.
let qrStream = null;
let qrScanTimer = 0;
let qrScanGeneration = 0;
let qrDetector = null;
let qrReader = "auto";
let qrLastLookup = "";
let qrLastLookupAt = 0;

function usernameFromContactCode(raw) {
    const text = (raw || "").trim();
    const compact = text.match(/^MSGAPP1:([a-z0-9_.-]{1,50})$/i);
    if (compact) return compact[1].toLowerCase();
    try {
        const url = new URL(text, location.origin);
        const path = url.pathname.replace(/\/+$/, "");
        if (!/^\/chat$/i.test(path)) return null;
        const contact = url.searchParams.get("contact") || "";
        return /^[a-z0-9_.-]{1,50}$/i.test(contact) ? contact.toLowerCase() : null;
    } catch (_) {
        return null;
    }
}

function stopQrScan() {
    qrScanGeneration++;
    clearTimeout(qrScanTimer);
    qrStream?.getTracks().forEach(track => track.stop());
    qrStream = null;
    const video = document.getElementById("qr-video");
    if (video) video.srcObject = null;
}

function setQrStatus(message) {
    const status = document.getElementById("qr-scan-status");
    if (status) status.textContent = message;
}

function resetQrScanner() {
    document.getElementById("qr-scan-result")?.classList.add("hidden");
    document.getElementById("qr-viewfinder")?.classList.add("hidden");
    document.getElementById("qr-start-camera")?.classList.remove("hidden");
    const result = document.getElementById("qr-scan-result");
    if (result) result.innerHTML = "";
}

function openMyQr() {
    const config = document.getElementById("chat-config");
    const name = document.getElementById("my-qr-name");
    const user = document.getElementById("my-qr-user");
    if (name) name.textContent = config?.dataset.displayName || "";
    if (user) user.textContent = config?.dataset.username ? "@" + config.dataset.username : "";
    const src = "/Chat?handler=ContactQr&v=" + encodeURIComponent(config?.dataset.username || "");
    const image = document.getElementById("my-qr-image");
    const download = document.getElementById("qr-download");
    if (image) image.src = src;
    if (download) download.href = src;
    closeAllModals();
    openDialog("my-qr-modal");
    if (typeof window.refreshIcons === "function") window.refreshIcons(document.getElementById("my-qr-modal"));
}

function openQrScanner(autoStart = true) {
    resetQrScanner();
    setQrStatus(autoStart ? "Point the camera at a contact QR code." : "Start the camera and point it at a contact QR code.");
    closeAllModals();
    openDialog("scan-qr-modal");
    if (typeof window.refreshIcons === "function") window.refreshIcons(document.getElementById("scan-qr-modal"));
    if (autoStart) startQrCamera();
}

async function startQrCamera() {
    const button = document.getElementById("qr-start-camera");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setQrStatus("The camera needs HTTPS or localhost. Choose a photo of the code instead.");
        return;
    }
    stopQrScan();
    const generation = qrScanGeneration;
    if (button) button.disabled = true;
    try {
        qrStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (generation !== qrScanGeneration) {
            qrStream.getTracks().forEach(track => track.stop());
            qrStream = null;
            return;
        }
        const video = document.getElementById("qr-video");
        video.srcObject = qrStream;
        await video.play();
        document.getElementById("qr-viewfinder")?.classList.remove("hidden");
        button?.classList.add("hidden");
        setQrStatus("Point the camera at a contact QR code.");
        scanQrFrame(generation);
    } catch (error) {
        const denied = error?.name === "NotAllowedError";
        setQrStatus(denied
            ? "Camera access was blocked. Allow it in the browser, or choose a photo of the code."
            : "No camera was found. Choose a photo of the code instead.");
    } finally {
        if (button) button.disabled = false;
    }
}

async function scanQrFrame(generation) {
    if (generation !== qrScanGeneration) return;
    const video = document.getElementById("qr-video");
    try {
        if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const text = await readQr(video);
            if (generation !== qrScanGeneration) return;
            if (text && await presentContactCode(text, generation)) return;
        }
    } catch (error) {
        if (generation !== qrScanGeneration) return;
        setQrStatus(error.message || "Couldn’t read that code.");
    }
    if (generation === qrScanGeneration) qrScanTimer = setTimeout(() => scanQrFrame(generation), 250);
}

async function scanQrFile(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    stopQrScan();
    document.getElementById("qr-viewfinder")?.classList.add("hidden");
    setQrStatus("Reading that photo…");
    try {
        const text = await readQrFile(file);
        if (!text) {
            setQrStatus("No QR code found in that photo.");
            return;
        }
        await presentContactCode(text, qrScanGeneration);
    } catch (_) {
        setQrStatus("That photo couldn’t be read. Try another image.");
    }
}

async function presentContactCode(text, generation) {
    const username = usernameFromContactCode(text);
    if (!username) {
        setQrStatus("That QR code isn’t a contact code.");
        return false;
    }
    const now = Date.now();
    if (text === qrLastLookup && now - qrLastLookupAt < 1600) return false;
    qrLastLookup = text;
    qrLastLookupAt = now;
    try {
        const user = await lookupContact("code=" + encodeURIComponent(text));
        if (generation !== qrScanGeneration) return true;
        qrLastLookup = "";
        stopQrScan();
        showScannedContact(user);
        return true;
    } catch (error) {
        if (generation !== qrScanGeneration) return true;
        setQrStatus(error.message);
        return false;
    }
}

function showScannedContact(user) {
    const result = document.getElementById("qr-scan-result");
    document.getElementById("qr-viewfinder")?.classList.add("hidden");
    document.getElementById("qr-start-camera")?.classList.add("hidden");
    setQrStatus("Contact found.");
    result.classList.remove("hidden");
    result.innerHTML = `
        <img src="${escapeHtml(user.avatarUrl)}" alt="" />
        <div><strong>${escapeHtml(user.displayName)}</strong><span>@${escapeHtml(user.username)}</span></div>
        <button type="button" class="btn btn-primary" id="qr-message-btn">Message</button>
        <button type="button" class="btn btn-ghost" id="qr-scan-again">Scan another</button>`;
    document.getElementById("qr-message-btn").onclick = () => startDirectChat(user.id);
    document.getElementById("qr-scan-again").onclick = () => openQrScanner(true);
    document.getElementById("qr-message-btn").focus();
}

async function lookupContact(query) {
    const response = await fetch("/Chat?handler=ContactByCode&" + query);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "No one here uses that code.");
    return body;
}

async function openContactFromCode(username) {
    try {
        const user = await lookupContact("username=" + encodeURIComponent(username));
        await startDirectChat(user.id);
    } catch (error) {
        showToast(error.message);
    }
}

async function shareContactCode(link, imageUrl) {
    try {
        const response = await fetch(imageUrl);
        if (response.ok && navigator.canShare) {
            const file = new File([await response.blob()], "contact-qr.svg", { type: "image/svg+xml" });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: "Message me", text: "Scan this code to message me." });
                return;
            }
        }
    } catch (error) {
        if (error?.name === "AbortError") return;
    }
    try {
        if (navigator.share && link) {
            await navigator.share({ title: "Message me", text: "Scan or open this to message me.", url: link });
            return;
        }
    } catch (error) {
        if (error?.name === "AbortError") return;
    }
    if (link && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(link);
            showToast("Contact link copied.");
            return;
        } catch (_) { /* Fall through to the manual hint. */ }
    }
    showToast("Couldn’t share the code. Download it instead.");
}

function shareMyQr() {
    const config = document.getElementById("chat-config");
    const image = document.getElementById("my-qr-image");
    shareContactCode(config?.dataset.contactLink || "", image?.src || "/Chat?handler=ContactQr");
}

async function readQr(source, allowFallback = false) {
    if (qrReader !== "jsqr" && "BarcodeDetector" in window) {
        try {
            qrDetector ??= new BarcodeDetector({ formats: ["qr_code"] });
            const codes = await qrDetector.detect(source);
            qrReader = "native";
            const value = codes[0]?.rawValue || null;
            if (value || !allowFallback) return value;
        } catch (_) {
            qrReader = "jsqr";
        }
    }
    return readQrWithJs(source);
}

function readQrWithJs(source) {
    if (typeof jsQR !== "function") return null;
    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;
    if (!width || !height) return null;
    const scale = Math.min(1, 480 / Math.max(width, height));
    const canvas = document.getElementById("qr-canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const result = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
    return result?.data || null;
}

function readQrFile(file) {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = async () => {
            try { resolve(await readQr(image, true)); }
            catch (error) { reject(error); }
            finally { URL.revokeObjectURL(url); }
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("unreadable"));
        };
        image.src = url;
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const config = document.getElementById("chat-config");
    if (!config) return;
    const contact = new URLSearchParams(location.search).get("contact");
    if (contact || config.dataset.openScanner === "true") history.replaceState(null, "", "/Chat");
    if (contact) openContactFromCode(contact);
    else if (config.dataset.openScanner === "true") openQrScanner(false);
});
