let messageSounds = true;
try { messageSounds = localStorage.getItem('wa_message_sounds') !== 'off'; } catch (_) {}

function syncSettingsTheme() {
    document.querySelectorAll('.theme-switch').forEach(button =>
        button.setAttribute('aria-checked', String(document.documentElement.classList.contains('theme-dark'))));
}

function toggleSettingsTheme() {
    const dark = !document.documentElement.classList.contains('theme-dark');
    document.documentElement.classList.toggle('theme-dark', dark);
    document.documentElement.classList.toggle('theme-light', !dark);
    try { localStorage.setItem('wa_theme', dark ? 'dark' : 'light'); } catch (_) {}
    syncSettingsTheme();
    if (typeof window.refreshIcons === 'function') window.refreshIcons();
}

function syncSettingsSounds() {
    document.querySelectorAll('.sound-switch').forEach(button =>
        button.setAttribute('aria-checked', String(messageSounds)));
}

function toggleSettingsSounds() {
    messageSounds = !messageSounds;
    try { localStorage.setItem('wa_message_sounds', messageSounds ? 'on' : 'off'); } catch (_) {}
    syncSettingsSounds();
    if (messageSounds) previewSettingsSound();
}

async function shareSettingsQr() {
    const link = document.getElementById("settings-qr")?.dataset.contactLink || "";
    try {
        const response = await fetch("/Chat?handler=ContactQr");
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
        } catch (_) { /* The download button remains available. */ }
    }
    showToast("Couldn’t share the code. Download it instead.");
}

function previewSettingsSound() {
    try {
        const audio = new Audio('/audio/message.wav');
        audio.volume = 0.7;
        audio.play().catch(() => {});
    } catch (_) {}
}

function showSettingsSection(section, animate = true) {
    const target = section || 'account';
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.classList.toggle('is-active', item.dataset.section === target);
    });
    document.querySelectorAll('.settings-panel').forEach(panel => {
        const active = panel.dataset.section === target;
        const changed = active && !panel.classList.contains('is-active');
        panel.classList.toggle('is-active', active);
        panel.hidden = !active;
        if (changed && animate) window.animateScreenSwap?.(panel);
    });
    if (target === 'app' && typeof updateInstallControls === 'function') updateInstallControls();
    if (target === 'notifications' && typeof updatePushControls === 'function') updatePushControls();
    history.replaceState(null, '', `#settings-${target}`);
}

document.addEventListener('DOMContentLoaded', () => {
    syncSettingsTheme();
    syncSettingsSounds();

    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.addEventListener('click', event => {
            event.preventDefault();
            showSettingsSection(item.dataset.section);
        });
    });

    const hash = (location.hash || '').replace(/^#settings-?/, '').replace(/^#/, '');
    const known = ['account', 'appearance', 'chats', 'notifications', 'app', 'help'];
    showSettingsSection(known.includes(hash) ? hash : 'account', false);

    if (typeof updateInstallControls === 'function') updateInstallControls();
    if (typeof updatePushControls === 'function') updatePushControls();
});

window.addEventListener('storage', event => {
    if (event.key === 'wa_message_sounds') {
        messageSounds = event.newValue !== 'off';
        syncSettingsSounds();
    }
    if (event.key === 'wa_theme') syncSettingsTheme();
});
