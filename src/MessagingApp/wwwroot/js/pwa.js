let installPrompt = null;
let pwaRegistration = null;
let pushConfig = null;
let notificationBusy = false;
let toastTimeout;
let pushNotificationsActive = false;
let appUpdatePending = false, appUpdateTimer = null, appUpdateReloading = false;
function applyQuietAppUpdate() {
    appUpdateTimer=null;if(!appUpdatePending||appUpdateReloading)return;
    const changedForm=[...document.querySelectorAll('input:not([type=hidden]),textarea,select')].some(field=>{
        if(field.closest('.hidden')||!field.getClientRects().length)return false;
        if(field.type==='checkbox'||field.type==='radio')return field.checked!==field.defaultChecked;
        if(field.tagName==='SELECT')return [...field.options].some(option=>option.selected!==option.defaultSelected);
        return field.value!==field.defaultValue;
    });
    if(changedForm||document.querySelector('.modal-layer:not(.hidden)')||window.canApplyAppUpdate?.()===false){appUpdateTimer=setTimeout(applyQuietAppUpdate,2000);return;}
    appUpdateReloading=true;window.location.reload();
}
window.hasEnabledPushNotifications = () => pushNotificationsActive;

// Ask other app windows before sounding an in-page alert in a background tab.
const attentionChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('wa-attention') : null;
const attentionRequests = new Map();
attentionChannel?.addEventListener('message', event => {
    const data = event.data;
    if (data?.type === 'query' && document.visibilityState === 'visible' && document.hasFocus())
        attentionChannel.postMessage({type:'focused',id:data.id});
    if (data?.type === 'focused') attentionRequests.get(data.id)?.();
});
window.isAppInForeground = () => {
    if (document.visibilityState === 'visible' && document.hasFocus()) return Promise.resolve(true);
    if (!attentionChannel) return Promise.resolve(false);
    return new Promise(resolve => {
        const id = crypto.randomUUID();
        const timer = setTimeout(()=>{attentionRequests.delete(id);resolve(false);},80);
        attentionRequests.set(id,()=>{clearTimeout(timer);attentionRequests.delete(id);resolve(true);});
        attentionChannel.postMessage({type:'query',id});
    });
};

function showToast(message) {
    const toast = document.getElementById('app-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 6000);
}

const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const supportsPush = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateInstallControls();
});
window.addEventListener('appinstalled', () => {
    installPrompt = null;
    updateInstallControls();
    showToast('App installed. Your chats are ready to go.');
});

function updateInstallControls() {
    const button = document.getElementById('install-app-btn');
    const description = document.getElementById('install-description');
    const loginInstall = document.getElementById('login-install');
    if (loginInstall) loginInstall.hidden = isInstalled();
    if (!button) return;
    button.disabled = isInstalled();
    const label = isInstalled() ? 'App installed' : installPrompt ? 'Install app' : 'How to install';
    const labelNode = button.querySelector('span');
    if (labelNode) labelNode.textContent = label;
    else button.textContent = label;
    if (!description) return;
    description.textContent = isInstalled() ? 'You’re using the installed app.' : isIos()
        ? 'Open this site in Safari, tap Share, then Add to Home Screen.'
        : 'Install for a dedicated window and quick access. You can also use your browser’s install option.';
}

async function installApp() {
    if (!installPrompt) {
        showToast(isIos() ? 'In Safari: tap Share → Add to Home Screen.' : 'Use your browser’s menu → Install app or Add to Home screen. Installation requires HTTPS (or localhost).');
        return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    await prompt.userChoice;
    updateInstallControls();
}

async function pushRequest(handler, subscription) {
    const response = await fetch(`/api/push?handler=${handler}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json',
            RequestVerificationToken: document.querySelector('input[name="__RequestVerificationToken"]')?.value || '' },
        body: JSON.stringify(subscription.toJSON ? subscription.toJSON() : subscription)
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Couldn’t update notifications. Please try again.');
    }
}

async function updatePushControls() {
    const button = document.getElementById('push-toggle-btn');
    const description = document.getElementById('push-description');
    if (!button || !description) return;
    if (!supportsPush() || isIos() && !isInstalled()) {
        button.disabled = true;
        description.textContent = isIos() && !isInstalled() ? 'Add this app to your Home Screen first, then enable notifications here.'
            : !window.isSecureContext ? 'Notifications require a secure HTTPS connection.' : 'This browser doesn’t support web push. Try an up-to-date browser.';
        button.textContent = 'Notifications unavailable';
        return;
    }
    if (!pushConfig?.enabled) {
        button.disabled = true;
        button.textContent = 'Notifications unavailable';
        description.textContent = 'Message notifications haven’t been configured on this server yet.';
        return;
    }
    const sub = await pwaRegistration?.pushManager.getSubscription();
    button.disabled = notificationBusy || Notification.permission === 'denied';
    button.textContent = notificationBusy ? 'Updating…' : sub && Notification.permission === 'granted' ? 'Disable notifications' : 'Enable notifications';
    description.textContent = Notification.permission === 'denied' ? 'Notifications are blocked. Allow them in your browser’s site settings, then reload.'
        : sub && Notification.permission === 'granted' ? 'Notifications are on for this device, even when the app is closed.'
        : 'Get notified when a new message arrives, even when the app is closed.';
}

async function togglePushNotifications() {
    if (notificationBusy || !supportsPush() || !pwaRegistration || !pushConfig?.enabled) return;
    notificationBusy = true;
    // Request permission immediately in the click gesture (required by Safari).
    const permissionPromise = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    updatePushControls();
    try {
        const permission = await permissionPromise;
        if (permission !== 'granted') { showToast('Notifications weren’t enabled. You can change this in your browser’s site settings.'); return; }
        let subscription = await pwaRegistration.pushManager.getSubscription();
        if (subscription) {
            await pushRequest('Unsubscribe', subscription);
            await subscription.unsubscribe();
            pushNotificationsActive = false;
            const notifications = await pwaRegistration.getNotifications();
            notifications.forEach(notification => notification.close());
            showToast('Notifications disabled on this device.');
        } else {
            const padding = '='.repeat((4 - pushConfig.publicKey.length % 4) % 4);
            const raw = atob((pushConfig.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/'));
            subscription = await pwaRegistration.pushManager.subscribe({ userVisibleOnly: true,
                applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
            try { await pushRequest('Subscribe', subscription); }
            catch (error) { await subscription.unsubscribe(); throw error; }
            pushNotificationsActive = true;
            showToast('Message notifications enabled.');
        }
    } catch (error) { showToast(error.message || 'Couldn’t enable notifications. Please try again.'); }
    finally { notificationBusy = false; await updatePushControls(); }
}

async function logoutWithPush(event) {
    event.preventDefault();
    const url = event.currentTarget.href;
    try {
        const subscription = await pwaRegistration?.pushManager.getSubscription();
        if (subscription) { await pushRequest('Unsubscribe', subscription); await subscription.unsubscribe(); }
        (await pwaRegistration?.getNotifications() || []).forEach(n => n.close());
    } catch (_) { /* Server also removes this device's subscription when signing out. */ }
    try {
        const response = await fetch(url, { method: 'POST', headers: {
            RequestVerificationToken: document.querySelector('input[name="__RequestVerificationToken"]')?.value || ''
        } });
        if (!response.ok) throw new Error('Logout failed');
        window.location.assign('/Account/Login');
    } catch (_) { showToast('Couldn’t log out. Please try again.'); }
}

function openAppSettings(section) {
    const path = section ? `/Account/Settings#settings-${section}` : '/Account/Settings';
    window.location.assign(path);
}

document.addEventListener('DOMContentLoaded', async () => {
    updateInstallControls();
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try {
        let controlled=Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener('controllerchange',()=>{
            if(controlled){appUpdatePending=true;clearTimeout(appUpdateTimer);appUpdateTimer=setTimeout(applyQuietAppUpdate,1000);}
            controlled=true;
        });
        const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        const activateWaiting=()=>registration.waiting?.postMessage({type:'SKIP_WAITING'});
        activateWaiting();
        registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',activateWaiting));
        pwaRegistration = await navigator.serviceWorker.ready;
        const needsPush = document.getElementById('chat-config') || document.getElementById('push-toggle-btn');
        if (!needsPush) return;
        const response = await fetch('/api/push');
        if (response.ok) pushConfig = await response.json();
        if (supportsPush() && pushConfig?.enabled && Notification.permission === 'granted') {
            const subscription = await pwaRegistration.pushManager.getSubscription();
            if (subscription) { await pushRequest('Subscribe', subscription); pushNotificationsActive = true; }
        }
        await updatePushControls();
    } catch (_) { showToast('App setup couldn’t finish. Check your connection and reload.'); }
});
