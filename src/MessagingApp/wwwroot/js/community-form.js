const selectedPeople = new Set();
let searchVersion = 0;
let searchTimer;
let excludeIds = new Set();

function csrfToken() {
    return document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function setError(message) {
    const el = document.getElementById('community-form-error');
    if (el) el.textContent = message || '';
}

function syncSelectedCount() {
    const el = document.getElementById('community-selected-count');
    if (el) el.textContent = `${selectedPeople.size} selected`;
}

function selectPerson(input) {
    const id = Number(input.value);
    if (input.checked) selectedPeople.add(id);
    else selectedPeople.delete(id);
    syncSelectedCount();
}

async function searchPeople(query) {
    const version = ++searchVersion;
    const results = document.getElementById('community-contact-results');
    if (!results) return;
    try {
        const response = await fetch(`/Chat?handler=SearchContacts&query=${encodeURIComponent(query || '')}`);
        if (!response.ok) throw new Error('Couldn’t load people.');
        const people = await response.json();
        if (version !== searchVersion) return;
        const rows = people.filter(p => !excludeIds.has(p.id));
        results.innerHTML = rows.length
            ? rows.map(p => `<label class="contact-picker-row"><input type="checkbox" value="${p.id}" ${selectedPeople.has(p.id) ? 'checked' : ''} /><img src="${escapeHtml(p.avatarUrl)}" alt=""/><span>${escapeHtml(p.displayName)}<small>@${escapeHtml(p.username)}</small></span></label>`).join('')
            : '<p class="social-help">No people found.</p>';
        results.querySelectorAll('input[type=checkbox]').forEach(input => {
            input.addEventListener('change', () => selectPerson(input));
        });
    } catch (error) {
        results.textContent = error.message;
    }
}

async function loadExistingMembers(communityId) {
    try {
        const response = await fetch(`/api/features?handler=Community&id=${communityId}`);
        if (!response.ok) return;
        const community = await response.json();
        excludeIds = new Set((community.members || []).map(m => m.userId));
    } catch (_) { /* Search still works without exclusions. */ }
}

async function submitCommunity(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const mode = form.dataset.mode || 'create';
    const button = document.getElementById('community-submit');
    const communityId = Number(form.dataset.communityId || 0);
    button.disabled = true;
    setError('');
    try {
        const payload = {
            title: document.getElementById('community-name')?.value || '',
            description: document.getElementById('community-description')?.value || '',
            memberIds: [...selectedPeople]
        };
        const url = new URL('/api/features', location.origin);
        url.searchParams.set('handler', mode === 'members' ? 'CommunityMembers' : 'Community');
        if (mode === 'members') url.searchParams.set('id', String(communityId));
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                RequestVerificationToken: csrfToken()
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Couldn’t save this community. Please try again.');
        const id = mode === 'members' ? communityId : result.id;
        window.location.assign(`/Communities/${id}`);
    } catch (error) {
        setError(error.message || 'Couldn’t save this community. Please try again.');
        button.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('community-form');
    if (!form) return;
    form.addEventListener('submit', submitCommunity);
    document.getElementById('community-contact-search')?.addEventListener('input', event => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => searchPeople(event.target.value), 200);
    });
    if (form.dataset.mode === 'members' && form.dataset.communityId) {
        await loadExistingMembers(Number(form.dataset.communityId));
    }
    await searchPeople('');
    window.refreshIcons?.();
});
