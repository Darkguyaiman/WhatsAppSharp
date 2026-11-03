let featureOpener = null;
function getCsrfToken() { return document.querySelector('input[name="__RequestVerificationToken"]')?.value || ''; }
let featureView = null;
let featureVersion = 0;
let statusPosts = [];
let statusIndex = 0;
let currentCommunity = null;
let mediaBefore = null;
let mediaKind = 'all';
let mediaQuery = '';
let mediaTimer;

async function featureRequest(handler, data, params = {}) {
    const url = new URL('/api/features', location.origin); url.searchParams.set('handler', handler);
    Object.entries(params).forEach(([key,value]) => { if (value != null) url.searchParams.set(key,value); });
    const options = data === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json', RequestVerificationToken:getCsrfToken() }, body:JSON.stringify(data) };
    const response = await fetch(url, options);
    if (response.redirected || response.status === 401) throw new Error('Your session has ended. Please sign in again.');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || (response.status === 403 ? 'You don’t have permission to do that.' : 'Couldn’t complete this action. Please try again.'));
    return result;
}
function uploadPath(url) { return /^\/uploads\/[a-f0-9]{32}\.[a-z0-9]+$/.test(url || '') ? url : ''; }
function featureEmpty(icon,title,description,action = '') { return `<div class="feature-empty"><i data-lucide="${icon}"></i><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${action}</div>`; }
function featureTime(value) { return new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
const featurePaths = { calls: '/Calls', statuses: '/Statuses', communities: '/Communities', media: '/Media' };
function syncFeatureUrl(view, extras = {}) {
    if (!view) {
        const path = typeof activeConversationId === 'number' && activeConversationId > 0
            ? `/Chat?conv=${activeConversationId}` : '/Chat';
        history.replaceState(null, '', path);
        return;
    }
    let path = featurePaths[view] || '/Chat';
    if (view === 'communities' && extras.community) path = `/Communities/${extras.community}`;
    history.replaceState(null, '', path);
}
function closeFeature() {
    const wasOpen = featureView !== null;
    featureView = null; featureVersion++; document.getElementById('feature-screen')?.classList.add('hidden'); document.querySelector('.rail-btn[aria-label="Chats"]')?.classList.add('is-active'); document.getElementById('sidebar-column').inert=false; document.querySelector('.thread')?.removeAttribute('inert');
    document.querySelectorAll('.rail-btn[data-feature]').forEach(button => { button.classList.remove('is-active'); button.removeAttribute('aria-current'); });
    syncFeatureUrl(null);
    if (wasOpen) window.animateScreenSwap?.(window.innerWidth < 900 ? document.getElementById('sidebar-column') : document.querySelector('.thread'), true);
    featureOpener?.focus?.();
}
async function openFeature(view, extras = {}) {
    if (!['calls','statuses','communities','media'].includes(view)) return;
    window.stopVoiceForNavigation?.();
    window.closeMessageInfo?.(false);
    featureOpener = document.activeElement; featureView = view; const version = ++featureVersion;
    const titles = { calls:['Calls','Voice and video, with room to reconnect.'], statuses:['Status','Little moments, shared for 24 hours.'], communities:['Communities','Bring your groups together.'], media:['Shared media','Photos, videos, and files across all your chats.'] };
    document.getElementById('feature-title').textContent = titles[view][0]; document.getElementById('feature-description').textContent = titles[view][1];
    const actions = document.getElementById('feature-actions');
    actions.innerHTML = view === 'statuses' ? '<a href="/Status/Compose" class="btn btn-primary"><i data-lucide="plus"></i>Post status</a>' : view === 'communities' ? '<a href="/Communities/Create" class="btn btn-primary"><i data-lucide="plus"></i>New community</a>' : '';
    document.getElementById('feature-screen').classList.remove('hidden'); document.querySelector('.rail-btn[aria-label="Chats"]')?.classList.remove('is-active'); document.getElementById('sidebar-column').inert=true; document.querySelector('.thread')?.setAttribute('inert','');
    window.animateScreenSwap?.(document.getElementById('feature-screen'));
    document.querySelectorAll('.rail-btn[data-feature]').forEach(button => { button.classList.toggle('is-active',button.dataset.feature === view); if (button.dataset.feature === view) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
    document.getElementById('feature-body').innerHTML = '<div class="feature-loading" role="status">Loading…</div>';
    syncFeatureUrl(view, extras);
    document.querySelector('.feature-header > button')?.focus();
    window.refreshIcons?.();
    try {
        if (view === 'statuses') await renderStatuses(version);
        if (view === 'communities') await renderCommunities(version);
        if (view === 'calls') await renderCallHistory(version);
        if (view === 'media') { mediaBefore = null; mediaKind = 'all'; mediaQuery = ''; renderMediaShell(); await loadMedia(false,version); }
        if (view === 'communities' && Number(extras.community) > 0) await openCommunity(Number(extras.community));
    } catch (error) {
        if (version === featureVersion) document.getElementById('feature-body').innerHTML = featureEmpty('wifi-off','Couldn’t load this view',error.message,`<button type="button" class="btn btn-primary" onclick="openFeature('${view}')">Try again</button>`);
    }
    if (version === featureVersion) window.refreshIcons?.();
}
async function renderStatuses(version = featureVersion) {
    const rows = await featureRequest('Statuses'); if (version !== featureVersion || featureView !== 'statuses') return; statusPosts = rows;
    const mine = rows.filter(s => s.isMine); const peers = new Map(); rows.filter(s => !s.isMine).forEach(s => { if (!peers.has(s.userId)) peers.set(s.userId,[]); peers.get(s.userId).push(s); });
    document.getElementById('feature-body').innerHTML = `<div class="status-list"><${mine.length ? 'button type="button"' : 'a href="/Status/Compose"'} class="status-row my-status" ${mine.length ? `onclick="showStatus(${mine[0].id})"` : ''}><span class="status-add"><i data-lucide="${mine.length ? 'circle-check' : 'plus'}"></i></span><span><strong>My status</strong><small>${mine.length ? `${mine.length} active update${mine.length > 1 ? 's' : ''}` : 'Share a photo or write an update'}</small></span></${mine.length ? 'button' : 'a'}><h2 class="feature-section-title">Recent updates</h2>${[...peers.values()].map(posts => `<button type="button" class="status-row" onclick="showStatus(${posts[0].id})"><img src="${escapeHtml(posts[0].avatar)}" class="status-avatar ${posts.every(s => s.viewed) ? 'is-viewed' : ''}" alt=""/><span><strong>${escapeHtml(posts[0].name)}</strong><small>${featureTime(posts[0].createdAt)} · ${posts.length} update${posts.length > 1 ? 's' : ''}</small></span><i data-lucide="chevron-right"></i></button>`).join('')}${!peers.size ? featureEmpty('circle-dashed','A quiet moment','Updates from people in your chats and communities will appear here.') : ''}</div>`;
    window.refreshIcons?.();
}
function openStatusComposer() { window.location.assign('/Status/Compose'); }
function showStatus(id) { statusIndex = statusPosts.findIndex(s => s.id === id); if (statusIndex < 0) return; drawStatus(); openDialog('status-viewer-modal'); }
function stepStatus(step) { statusIndex = Math.max(0,Math.min(statusPosts.length-1,statusIndex+step)); drawStatus(); }
function statusFontSize(size) { return ({ sm:'18px', md:'24px', lg:'30px', xl:'36px' })[size] || '24px'; }
function applyStatusStyle(image, text, style = {}) {
    const scale = Math.min(150, Math.max(50, Number(style.imageScale) || 100)) / 100;
    if (image) {
        image.style.width = `${Math.round(70 * scale)}%`;
        image.style.maxWidth = '100%';
        image.style.maxHeight = `${Math.round(42 * scale)}vh`;
        image.style.height = 'auto';
        image.style.objectFit = 'contain';
    }
    if (text) {
        text.style.textAlign = ['left','center','right'].includes(style.align) ? style.align : 'center';
        text.style.fontSize = statusFontSize(style.size);
        text.style.fontWeight = style.bold ? '700' : '400';
        text.style.fontStyle = style.italic ? 'italic' : 'normal';
        text.style.width = '100%';
    }
}
function drawStatus() {
    const status = statusPosts[statusIndex]; if (!status) return;
    if (new Date(status.expiresAt) <= new Date()) { closeAllModals(); if (featureView === 'statuses') renderStatuses().catch(error=>showToast(error.message)); return; }
    document.getElementById('status-viewer-name').textContent = status.name; document.getElementById('status-viewer-time').textContent = featureTime(status.createdAt);
    const stage = document.getElementById('status-stage'); stage.style.backgroundColor = /^#[a-f0-9]{6}$/i.test(status.color) ? status.color : '#008069';
    stage.replaceChildren();
    let image = null; let text = null;
    if (uploadPath(status.imageUrl)) { image = document.createElement('img'); image.src = status.imageUrl; image.alt = 'Status photo'; stage.append(image); }
    if (status.text) {
        text = document.createElement('p');
        if (typeof formatEmoji === 'function') text.innerHTML = formatEmoji(status.text);
        else text.textContent = status.text;
        stage.append(text);
    }
    applyStatusStyle(image, text, status.style);
    document.getElementById('status-viewer-meta').textContent = status.isMine ? `${status.views || 0} views` : `${statusIndex+1} of ${statusPosts.length}`;
    document.getElementById('status-delete').classList.toggle('hidden',!status.isMine);
    document.getElementById('status-previous').disabled = statusIndex === 0; document.getElementById('status-next').disabled = statusIndex === statusPosts.length-1;
    featureRequest('ViewStatus',{}, {id:status.id}).catch(error=>showToast(error.message)); status.viewed = true;
}
async function deleteCurrentStatus() {
    const status = statusPosts[statusIndex]; if (!status?.isMine) return;
    try { await featureRequest('DeleteStatus',{}, {id:status.id}); closeAllModals(); await renderStatuses(); }
    catch(error) { showToast(error.message); }
}
async function renderCommunities(version = featureVersion) {
    const rows = await featureRequest('Communities'); if (version !== featureVersion || featureView !== 'communities') return;
    currentCommunity = null;
    document.getElementById('feature-body').innerHTML = rows.length ? `<div class="community-list">${rows.map(c => `<button type="button" class="community-row" onclick="openCommunity(${c.id})"><span class="community-symbol"><i data-lucide="network"></i></span><span><strong>${escapeHtml(c.title)}</strong><p>${escapeHtml(c.description || 'Groups and announcements in one place.')}</p><small>${c.members} members${c.isAdmin ? ' · Admin' : ''}</small></span><i data-lucide="chevron-right"></i></button>`).join('')}</div>` : featureEmpty('network','Your people, together','Create a community for your neighbourhood, team, or friends.','<a href="/Communities/Create" class="btn btn-primary">New community</a>');
    window.refreshIcons?.();
}
async function openCommunity(id) {
    const version = ++featureVersion;
    try {
        const community = await featureRequest('Community',undefined,{id}); if (version !== featureVersion || featureView !== 'communities') return; currentCommunity = community;
        syncFeatureUrl('communities', { community: id });
        document.getElementById('feature-body').innerHTML = `<div class="community-detail"><button type="button" class="btn btn-ghost" onclick="openFeature('communities')"><i data-lucide="arrow-left"></i>All communities</button><div class="community-heading"><span class="community-symbol"><i data-lucide="network"></i></span><div><h2>${escapeHtml(community.title)}</h2><p>${escapeHtml(community.description)}</p></div></div><div class="community-detail-actions">${community.isAdmin ? `<button type="button" class="btn btn-primary" onclick="openCommunityGroup()"><i data-lucide="plus"></i>New group</button><a href="/Communities/AddMembers/${community.id}" class="btn btn-ghost"><i data-lucide="user-round-plus"></i>Add people</a>` : '<button type="button" class="btn btn-ghost" onclick="leaveCommunity()">Leave community</button>'}</div><h3 class="feature-section-title">Groups</h3>${community.groups.map(g => `<button type="button" class="community-group-row" onclick="openFeatureChat(${g.id})"><i data-lucide="${g.isAnnouncement ? 'megaphone' : 'users'}"></i><span><strong>${escapeHtml(g.title)}</strong><small>${g.isAnnouncement ? 'Updates from community admins' : 'Chat with your community'}</small></span><i data-lucide="chevron-right"></i></button>`).join('')}<details class="community-members"><summary>${community.members.length} members</summary>${community.members.map(m => `<div class="community-member"><img src="${escapeHtml(m.avatar)}" alt=""/><span>${escapeHtml(m.name)}</span>${m.isAdmin ? '<small>Admin</small>' : community.isAdmin ? `<button type="button" class="btn btn-ghost" onclick="promoteCommunityAdmin(${m.userId})">Make admin</button>` : ''}</div>`).join('')}${community.isAdmin ? '<button type="button" class="btn btn-ghost" onclick="leaveCommunity()">Leave community</button>' : ''}</details></div>`;
        window.refreshIcons?.();
    } catch(error) { showToast(error.message); }
}
async function openFeatureChat(id) { closeFeature(); await refreshConversationList(); await selectConversation(id); }
function openCommunityComposer(mode = 'create') {
    if (mode === 'members' && currentCommunity?.id) window.location.assign(`/Communities/AddMembers/${currentCommunity.id}`);
    else window.location.assign('/Communities/Create');
}
function openCommunityGroup() { document.getElementById('community-group-form').reset(); document.getElementById('community-group-error').textContent=''; openDialog('community-group-modal'); }
async function promoteCommunityAdmin(userId) { if (!currentCommunity) return; try { await featureRequest('CommunityAdmin',{}, {id:currentCommunity.id,userId}); await openCommunity(currentCommunity.id); } catch(error) { showToast(error.message); } }
async function leaveCommunity() { if (!currentCommunity) return; try { await featureRequest('LeaveCommunity',{}, {id:currentCommunity.id}); await refreshConversationList(); await openFeature('communities'); } catch(error) { showToast(error.message); } }
function renderMediaShell() {
    document.getElementById('feature-body').innerHTML = '<div class="media-toolbar"><label class="visually-hidden" for="media-search">Search shared files</label><input id="media-search" type="search" class="field-control" placeholder="Search files or group names"/><div class="media-filters" role="group" aria-label="Media type">'+['all','photos','videos','audio','documents'].map(kind=>`<button type="button" class="filter-chip ${kind==='all'?'is-active':''}" aria-pressed="${kind==='all'}" data-kind="${kind}" onclick="filterMedia('${kind}')">${kind[0].toUpperCase()+kind.slice(1)}</button>`).join('')+'</div></div><div id="media-grid" class="media-grid"></div><button type="button" id="media-more" class="btn btn-ghost media-more hidden" onclick="loadMedia(true)">Load more</button>';
    document.getElementById('media-search').addEventListener('input', event=>{ clearTimeout(mediaTimer); mediaQuery = event.target.value; mediaTimer=setTimeout(()=>filterMedia(mediaKind),200); });
}
async function filterMedia(kind) { mediaKind=kind; mediaBefore=null; const version=++featureVersion; document.querySelectorAll('.media-filters button').forEach(b=>{b.classList.toggle('is-active',b.dataset.kind===kind);b.setAttribute('aria-pressed',String(b.dataset.kind===kind));}); try { await loadMedia(false,version); } catch(error) { showToast(error.message); } }
async function loadMedia(append = false, version = featureVersion) {
    const more = document.getElementById('media-more'); if (!more || more.disabled) return; more.disabled=true;
    try {
        const rows = await featureRequest('Media',undefined,{before:append?mediaBefore:null,kind:mediaKind,query:mediaQuery}); if (version !== featureVersion || featureView !== 'media') return;
        const grid=document.getElementById('media-grid'); if (!append) grid.replaceChildren();
        for (const row of rows) {
            const url=uploadPath(row.attachmentUrl); if (!url) continue;
            const card=document.createElement('article');card.className='media-item';
            card.innerHTML=`<a class="media-preview" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(row.attachmentName || 'attachment')}">${row.isImage ? `<img src="${url}" alt="${escapeHtml(row.attachmentName || 'Shared photo')}" loading="lazy"/>` : `<i data-lucide="${row.isAudio?'music':url.endsWith('.mp4')?'video':'file-text'}"></i>`}</a><div class="media-caption"><a href="${url}" download>${escapeHtml(row.attachmentName || 'Attachment')}</a><small>${escapeHtml(row.sender)} · ${featureTime(row.createdAt)}</small><button type="button" onclick="openFeatureChat(${row.conversationId})">Open chat<i data-lucide="arrow-up-right"></i></button></div>`;grid.append(card);
        }
        if (!grid.children.length) grid.innerHTML=featureEmpty('images','No shared files yet','Photos and attachments from your chats, groups, and communities will appear here.');
        mediaBefore=rows.at(-1)?.id;more.classList.toggle('hidden',rows.length<40);window.refreshIcons?.(grid);
    } finally { more.disabled=false; }
}
async function renderCallHistory(version = featureVersion) {
    const rows=await featureRequest('Calls');if(version!==featureVersion||featureView!=='calls')return;
    document.getElementById('feature-body').innerHTML=rows.length?`<div class="call-history"><p class="social-help">Open a direct chat to start a voice or video call.</p>${rows.map(c=>`<div class="call-history-row"><i data-lucide="${c.outgoing?'phone-outgoing':'phone-incoming'}" class="${['missed','failed','interrupted'].includes(c.state)?'call-missed':''}"></i><span><strong>${escapeHtml(c.name)}</strong><small>${featureTime(c.createdAt)} · ${escapeHtml(c.state)}${c.seconds ? ' · '+Math.floor(c.seconds/60)+':'+String(c.seconds%60).padStart(2,'0'):''}</small></span><button type="button" class="icon-btn" onclick="callFromHistory(${c.conversationId},${c.video})" aria-label="Call ${escapeHtml(c.name)}"><i data-lucide="${c.video?'video':'phone'}"></i></button></div>`).join('')}</div>`:featureEmpty('phone','A conversation away','Open a direct chat and choose voice or video to make your first call.','<button type="button" class="btn btn-primary" onclick="closeFeature();openNewChatModal()">Choose someone to call</button>');window.refreshIcons?.();
}
async function callFromHistory(id,video) { await openFeatureChat(id); await startChatCall(video); }
function setupFeatureEvents(hub) {
    hub.on('StatusesChanged',()=>{ if(featureView==='statuses')renderStatuses().catch(e=>showToast(e.message)); });
    hub.on('CommunitiesChanged',async()=>{try {await refreshConversationList();if(featureView==='communities')currentCommunity?await openCommunity(currentCommunity.id):await renderCommunities();}catch(error){showToast(error.message);}});
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&featureView&&!document.querySelector('.modal-layer:not(.hidden)')&&!document.getElementById('call-panel')?.classList.contains('hidden'))return;if(event.key==='Escape'&&featureView&&!document.querySelector('.modal-layer:not(.hidden)')){event.preventDefault();event.stopImmediatePropagation();closeFeature();}},true);
document.addEventListener('DOMContentLoaded',()=>{
    if(!document.getElementById('chat-config'))return;
    document.getElementById('community-group-form').addEventListener('submit',async event=>{
        event.preventDefault();const button=event.target.querySelector('button[type=submit]');button.disabled=true;document.getElementById('community-group-error').textContent='';
        try {await featureRequest('CommunityGroup',{title:document.getElementById('community-group-name').value},{id:currentCommunity.id});closeAllModals();await refreshConversationList();await openCommunity(currentCommunity.id);}catch(error){document.getElementById('community-group-error').textContent=error.message;}finally{button.disabled=false;}
    });
    const config = document.getElementById('chat-config');
    const feature = config?.dataset.initialFeature || '';
    const communityId = Number(config?.dataset.initialCommunity || 0);
    if (['calls','statuses','communities','media'].includes(feature)) {
        openFeature(feature, communityId > 0 ? { community: communityId } : {}).catch(() => {});
    }
    setInterval(()=>{if(featureView==='statuses')renderStatuses().catch(()=>{});},60000);
});



