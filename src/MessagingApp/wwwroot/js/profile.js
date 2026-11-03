function syncAccountTheme() {
    document.querySelector('.theme-switch')?.setAttribute('aria-checked', String(document.documentElement.classList.contains('theme-dark')));
}
function toggleAccountTheme() {
    const dark = !document.documentElement.classList.contains('theme-dark');
    document.documentElement.classList.toggle('theme-dark', dark);
    document.documentElement.classList.toggle('theme-light', !dark);
    try { localStorage.setItem('wa_theme', dark ? 'dark' : 'light'); } catch (_) {}
    syncAccountTheme();
}
document.addEventListener('DOMContentLoaded', () => {
    syncAccountTheme();
    const feedback = document.getElementById('profile-feedback');
    const save = document.getElementById('save-profile');
    document.getElementById('use-initials')?.addEventListener('click', event => {
        document.getElementById('selectedAvatarInput').value = '/images/avatars/avatar-default.svg';
        document.getElementById('currentAvatarPreview').src = event.currentTarget.dataset.initials;
    });
    document.getElementById('profile-photo')?.addEventListener('change', async event => {
        const file = event.target.files[0]; if (!file) return;
        if (!['image/jpeg','image/png','image/gif','image/webp'].includes(file.type) || file.size > 15728640) { feedback.textContent = 'Choose a supported image under 15 MB.'; return; }
        const body = new FormData(); body.append('file', file); save.disabled = true; feedback.textContent = 'Uploading photo…';
        try {
            const response = await fetch('/api/upload', { method:'POST', body, headers:{ RequestVerificationToken:document.querySelector('input[name="__RequestVerificationToken"]').value } });
            const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The photo could not be uploaded.');
            document.getElementById('selectedAvatarInput').value = result.url; document.getElementById('currentAvatarPreview').src = result.url;
            feedback.textContent = 'Photo ready. Save changes to update your profile.';
        } catch (error) { feedback.textContent = error.message; }
        finally { save.disabled = false; event.target.value = ''; }
    });
    document.getElementById('profile-editor')?.addEventListener('submit', () => { save.disabled = true; save.textContent = 'Saving…'; });
});
