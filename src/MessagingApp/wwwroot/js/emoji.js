// Draws the same emoji characters WhatsApp uses, with Twemoji artwork so they match on every device.
const emojiImageOptions = { base: '/emoji/', folder: 'svg', ext: '.svg', className: 'emoji' };
const pickerImageOptions = { ...emojiImageOptions, attributes: () => ({ loading: 'lazy', decoding: 'async' }) };

function escapeEmojiText(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatEmoji(text) {
    const raw = String(text ?? '');
    const safe = escapeEmojiText(raw);
    if (typeof twemoji === 'undefined' || !twemoji.test(raw)) return safe;
    return twemoji.parse(safe, emojiImageOptions);
}

function paintEmoji(root, options = emojiImageOptions) {
    if (!root || typeof twemoji === 'undefined') return;
    twemoji.parse(root, options);
}

function emojiOnlyCount(text) {
    const plain = String(text ?? '').trim();
    if (!plain || typeof twemoji === 'undefined') return 0;
    let count = 0;
    const rest = twemoji.replace(plain, () => { count += 1; return ''; });
    return rest.trim() ? 0 : count;
}

function recentEmojiKey() {
    const id = document.getElementById('chat-config')?.dataset.userId || 'local';
    return `wa_recent_emoji_${id}`;
}

function loadRecentEmoji() {
    try {
        const saved = JSON.parse(localStorage.getItem(recentEmojiKey()) || '[]');
        return Array.isArray(saved) ? saved.filter(item => typeof item === 'string').slice(0, 32) : [];
    } catch { return []; }
}

function mountEmojiPicker(root, onChoose = null) {
    if (!root || root.dataset.ready || !window.WA_EMOJI) return;
    root.dataset.ready = '1';

    root.innerHTML = `
        <label class="emoji-search"><span class="visually-hidden">Search emoji</span><input type="search" placeholder="Search emoji" autocomplete="off" /></label>
        <div class="emoji-scroll"></div>
        <div class="emoji-tabs" role="tablist" aria-label="Emoji categories"></div>`;
    const search = root.querySelector('input');
    const scroll = root.querySelector('.emoji-scroll');
    const tabs = root.querySelector('.emoji-tabs');

    const sections = document.createDocumentFragment();
    const recent = document.createElement('section');
    recent.className = 'emoji-section';
    recent.dataset.section = 'recent';
    recent.innerHTML = '<h4>Recent</h4><div class="emoji-grid" data-recent></div><p class="emoji-empty">Emoji you use show up here.</p>';
    sections.appendChild(recent);

    for (const group of window.WA_EMOJI) {
        const section = document.createElement('section');
        section.className = 'emoji-section';
        section.dataset.section = group.id;
        section.innerHTML = `<h4>${escapeEmojiText(group.label)}</h4><div class="emoji-grid"></div>`;
        const grid = section.querySelector('.emoji-grid');
        for (const item of group.items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'emoji-cell';
            button.dataset.base = item[0];
            button.dataset.emoji = item[0];
            button.dataset.name = item[1] || '';
            button.title = item[1] || '';
            button.textContent = item[0];
            button.addEventListener('mousedown', event => event.preventDefault());
            button.addEventListener('click', () => chooseEmoji(button.dataset.emoji));
            grid.appendChild(button);
        }
        sections.appendChild(section);
    }
    scroll.appendChild(sections);

    function renderRecent() {
        const grid = root.querySelector('[data-recent]');
        const empty = recent.querySelector('.emoji-empty');
        const saved = loadRecentEmoji();
        grid.innerHTML = '';
        saved.forEach(character => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'emoji-cell';
            button.dataset.emoji = character;
            button.dataset.base = character;
            button.dataset.name = '';
            button.textContent = character;
            button.addEventListener('mousedown', event => event.preventDefault());
            button.addEventListener('click', () => chooseEmoji(character));
            grid.appendChild(button);
        });
        empty.hidden = saved.length > 0;
        recent.hidden = false;
        paintEmoji(grid, pickerImageOptions);
    }
    function chooseEmoji(character) {
        if (!character) return;
        const saved = [character, ...loadRecentEmoji().filter(item => item !== character)].slice(0, 32);
        try { localStorage.setItem(recentEmojiKey(), JSON.stringify(saved)); } catch {}
        renderRecent();
        if (onChoose) onChoose(character);
        else if (typeof insertEmoji === 'function') insertEmoji(character);
    }
    function showTab(id) {
        tabs.querySelectorAll('button').forEach(button => button.classList.toggle('is-on', button.dataset.section === id));
    }

    [['recent', '🕒', 'Recent'], ...window.WA_EMOJI.map(group => [group.id, group.icon, group.label])].forEach(([id, icon, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.section = id;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.textContent = icon;
        button.addEventListener('click', () => {
            const section = scroll.querySelector(`[data-section="${id}"]`);
            if (!section) return;
            scroll.scrollTop = section.offsetTop;
            showTab(id);
        });
        tabs.appendChild(button);
    });

    search.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
    search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase();
        scroll.querySelectorAll('.emoji-section').forEach(section => {
            if (section.dataset.section === 'recent') {
                section.hidden = query.length > 0;
                return;
            }
            let visible = 0;
            section.querySelectorAll('.emoji-cell').forEach(button => {
                const match = !query || button.dataset.name.includes(query) || button.dataset.base.includes(query);
                button.hidden = !match;
                if (match) visible += 1;
            });
            section.hidden = visible === 0;
        });
        let empty = scroll.querySelector('.emoji-none');
        const any = [...scroll.querySelectorAll('.emoji-section')].some(section => !section.hidden);
        if (!any) {
            if (!empty) {
                empty = document.createElement('p');
                empty.className = 'emoji-none';
                empty.textContent = 'No emoji found.';
                scroll.appendChild(empty);
            }
        } else empty?.remove();
    });
    scroll.addEventListener('scroll', () => {
        if (search.value.trim()) return;
        let current = 'recent';
        scroll.querySelectorAll('.emoji-section').forEach(section => {
            if (section.hidden) return;
            if (section.offsetTop - scroll.scrollTop <= 24) current = section.dataset.section;
        });
        showTab(current);
    });

    paintEmoji(scroll, pickerImageOptions);
    renderRecent();
    showTab('recent');
    paintEmoji(tabs);
}

document.addEventListener('DOMContentLoaded', () => {
    // The picker is hidden on initial load. Build its catalogue only when opened.
    paintEmoji(document.getElementById('conversations-list'));
    paintEmoji(document.querySelector('.ctx-react'));
});
