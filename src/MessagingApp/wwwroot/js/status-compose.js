const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_BYTES = 15728640;
const FONT_SIZES = { sm: '18px', md: '24px', lg: '30px', xl: '36px' };
let selectedFile = null;
let previewUrl = null;
const styleState = { imageScale: 100, align: 'center', size: 'md', bold: false, italic: false };

function csrfToken() {
    return document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function setError(message) {
    const el = document.getElementById('status-compose-error');
    if (el) el.textContent = message || '';
}

function applyTextStyle(el) {
    if (!el) return;
    el.style.textAlign = styleState.align;
    el.style.fontSize = FONT_SIZES[styleState.size] || FONT_SIZES.md;
    el.style.fontWeight = styleState.bold ? '700' : '400';
    el.style.fontStyle = styleState.italic ? 'italic' : 'normal';
    el.style.width = '100%';
}

function applyImageStyle(el) {
    if (!el) return;
    const scale = styleState.imageScale / 100;
    el.style.width = `${Math.round(70 * scale)}%`;
    el.style.maxWidth = '100%';
    el.style.maxHeight = `${Math.round(220 * scale)}px`;
    el.style.height = 'auto';
    el.style.objectFit = 'contain';
}

function syncToolbar() {
    document.querySelectorAll('.status-tool[data-format]').forEach(button => {
        const on = !!styleState[button.dataset.format];
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.status-tool[data-align]').forEach(button => {
        const on = button.dataset.align === styleState.align;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', String(on));
    });
    const size = document.getElementById('status-font-size');
    if (size) size.value = styleState.size;
    const scale = document.getElementById('status-image-scale');
    const scaleValue = document.getElementById('status-image-scale-value');
    if (scale) {
        scale.value = String(styleState.imageScale);
        scale.setAttribute('aria-valuenow', String(styleState.imageScale));
    }
    if (scaleValue) scaleValue.textContent = `${styleState.imageScale}%`;
    document.getElementById('status-image-tools')?.classList.toggle('hidden', !previewUrl);
}

function syncPreview() {
    const raw = document.getElementById('status-text')?.value || '';
    const text = raw.trim();
    const previewText = document.getElementById('status-preview-text');
    const previewImage = document.getElementById('status-preview-image');
    const count = document.getElementById('status-count');
    if (count) count.textContent = String(raw.length);
    if (previewImage) {
        previewImage.classList.toggle('hidden', !previewUrl);
        if (previewUrl) previewImage.src = previewUrl;
        else previewImage.removeAttribute('src');
        applyImageStyle(previewImage);
    }
    if (previewText) {
        applyTextStyle(previewText);
        if (text) {
            if (typeof formatEmoji === "function") previewText.innerHTML = formatEmoji(raw.replace(/\s+$/, ''));
            else previewText.textContent = raw.replace(/\s+$/, '');
            previewText.classList.remove('status-preview-placeholder', 'hidden');
        } else if (previewUrl) {
            previewText.textContent = '';
            previewText.classList.add('hidden');
            previewText.classList.remove('status-preview-placeholder');
        } else {
            previewText.textContent = 'What’s happening?';
            previewText.classList.add('status-preview-placeholder');
            previewText.classList.remove('hidden');
        }
    }
    syncToolbar();
}

function clearPhoto() {
    selectedFile = null;
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    const input = document.getElementById('status-photo');
    if (input) input.value = '';
    document.getElementById('status-dropzone-empty')?.classList.remove('hidden');
    document.getElementById('status-dropzone-filled')?.classList.add('hidden');
    document.getElementById('status-dropzone')?.classList.remove('has-file');
    styleState.imageScale = 100;
    syncPreview();
}

function acceptFile(file) {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_BYTES) {
        setError('Choose a supported photo under 15 MB.');
        return;
    }
    setError('');
    selectedFile = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    document.getElementById('status-dropzone-empty')?.classList.add('hidden');
    document.getElementById('status-dropzone-filled')?.classList.remove('hidden');
    document.getElementById('status-dropzone')?.classList.add('has-file');
    const thumb = document.getElementById('status-dropzone-thumb');
    if (thumb) thumb.src = previewUrl;
    const name = document.getElementById('status-dropzone-name');
    if (name) name.textContent = file.name || 'Photo ready';
    const meta = document.getElementById('status-dropzone-meta');
    if (meta) meta.textContent = formatBytes(file.size);
    syncPreview();
}

function setColor(color) {
    document.getElementById('status-color').value = color;
    document.getElementById('status-preview').style.backgroundColor = color;
    document.querySelectorAll('.status-swatch').forEach(button => {
        const selected = button.dataset.color === color;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-checked', String(selected));
    });
}

function insertEmoji(emoji) {
    const textarea = document.getElementById('status-text');
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const next = textarea.value.slice(0, start) + emoji + textarea.value.slice(end);
    if (next.length > 700) {
        setError('That emoji would go past the 700 character limit.');
        return;
    }
    setError('');
    textarea.value = next;
    const caret = start + emoji.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    syncPreview();
}

function toggleEmojiPanel(force) {
    const panel = document.getElementById('status-emoji-panel');
    const toggle = document.getElementById('status-emoji-toggle');
    if (!panel || !toggle) return;
    const open = force ?? panel.classList.contains('hidden');
    if (open && typeof mountEmojiPicker === 'function') mountEmojiPicker(panel);
    panel.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-active', open);
}

async function postStatus(event) {
    event.preventDefault();
    const button = document.getElementById('status-submit');
    const text = document.getElementById('status-text').value.trim();
    if (!text && !selectedFile) {
        setError('Write an update or choose a photo.');
        return;
    }
    button.disabled = true;
    button.textContent = 'Posting…';
    setError('');
    try {
        let imageUrl = null;
        if (selectedFile) {
            const body = new FormData();
            body.append('file', selectedFile);
            const upload = await fetch('/api/upload', {
                method: 'POST',
                body,
                headers: { RequestVerificationToken: csrfToken() }
            });
            const uploaded = await upload.json().catch(() => ({}));
            if (!upload.ok) throw new Error(uploaded.error || 'Photo upload failed.');
            imageUrl = uploaded.url;
        }
        const response = await fetch('/api/features?handler=Status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                RequestVerificationToken: csrfToken()
            },
            body: JSON.stringify({
                text: document.getElementById('status-text').value,
                imageUrl,
                color: document.getElementById('status-color').value,
                style: styleState
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Couldn’t post your update. Please try again.');
        window.location.assign('/Statuses');
    } catch (error) {
        setError(error.message || 'Couldn’t post your update. Please try again.');
        button.disabled = false;
        button.textContent = 'Post status';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('status-dropzone');
    const input = document.getElementById('status-photo');
    if (!dropzone || !input) return;

    document.getElementById('status-text')?.addEventListener('input', syncPreview);
    document.getElementById('status-compose-form')?.addEventListener('submit', postStatus);
    document.getElementById('status-photo-clear')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        clearPhoto();
    });
    document.getElementById('status-font-size')?.addEventListener('change', event => {
        styleState.size = event.target.value;
        syncPreview();
    });
    document.getElementById('status-image-scale')?.addEventListener('input', event => {
        styleState.imageScale = Number(event.target.value) || 100;
        syncPreview();
    });
    document.getElementById('status-emoji-toggle')?.addEventListener('click', () => toggleEmojiPanel());
    document.querySelectorAll('.status-tool[data-format]').forEach(button => {
        button.addEventListener('click', () => {
            styleState[button.dataset.format] = !styleState[button.dataset.format];
            syncPreview();
        });
    });
    document.querySelectorAll('.status-tool[data-align]').forEach(button => {
        button.addEventListener('click', () => {
            styleState.align = button.dataset.align;
            syncPreview();
        });
    });
    document.querySelectorAll('.status-swatch').forEach(button => {
        button.addEventListener('click', () => setColor(button.dataset.color));
    });
    document.addEventListener('click', event => {
        const panel = document.getElementById('status-emoji-panel');
        const toggle = document.getElementById('status-emoji-toggle');
        if (!panel || panel.classList.contains('hidden')) return;
        if (panel.contains(event.target) || toggle?.contains(event.target)) return;
        toggleEmojiPanel(false);
    });

    const openPicker = () => input.click();
    dropzone.addEventListener('click', event => {
        if (event.target.closest('#status-photo-clear')) return;
        openPicker();
    });
    dropzone.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
        }
    });
    input.addEventListener('change', () => acceptFile(input.files?.[0]));

    ['dragenter', 'dragover'].forEach(type => {
        dropzone.addEventListener(type, event => {
            event.preventDefault();
            event.stopPropagation();
            dropzone.classList.add('is-dragging');
        });
    });
    ['dragleave', 'drop'].forEach(type => {
        dropzone.addEventListener(type, event => {
            event.preventDefault();
            event.stopPropagation();
            dropzone.classList.remove('is-dragging');
        });
    });
    dropzone.addEventListener('drop', event => {
        const file = event.dataTransfer?.files?.[0];
        if (file) acceptFile(file);
    });

    syncPreview();
    window.refreshIcons?.();
});
