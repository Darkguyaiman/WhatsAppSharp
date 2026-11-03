// A persistent desktop inspector becomes a dedicated message-info screen on phones.
(() => {
    let messageId = null, source = null, request = 0, opener = null, previewKey = null;
    const node = id => document.getElementById(id);
    const stamp = value => new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
    const ticks = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 12 4 4L17 6m-6 10 10-10"/></svg>';

    function syncLayout() {
        const panel = node('message-info-panel'); if (!panel) return;
        const mobile = messageId !== null && window.innerWidth < 900;
        panel.setAttribute('role', mobile ? 'dialog' : 'region');
        if (mobile) panel.setAttribute('aria-modal','true'); else panel.removeAttribute('aria-modal');
        if (node('active-chat-container')) node('active-chat-container').inert = mobile;
    }
    function renderPreview(message) {
        const target = node('message-info-preview');
        const row = createMessageElement(message);
        row.removeAttribute('id'); row.classList.add('info-message');
        row.querySelectorAll('.msg-menu-btn,.reactions-pill,.sender-avatar').forEach(element=>element.remove());
        row.querySelectorAll('.quote').forEach(element=>element.removeAttribute('onclick'));
        const key = JSON.stringify([message.id,message.content,message.attachmentUrl,message.isDeleted,message.replyTo]);
        if (key === previewKey && target.firstElementChild) {
            const footer = row.querySelector('.msg-foot');
            if (footer) target.querySelector('.msg-foot')?.replaceWith(footer);
            window.refreshIcons?.(target); return;
        }
        target.querySelectorAll('audio,video').forEach(media=>media.pause());
        previewKey = key; target.replaceChildren();
        target.appendChild(row); window.refreshIcons?.(target);
    }
    async function loadInfo() {
        const id = messageId, version = ++request;
        node('message-info-content').innerHTML = '<p class="info-state" role="status">Loading message info…</p>';
        try {
            if (connection?.state !== signalR.HubConnectionState.Connected) throw new Error('Waiting for a connection. Try again.');
            const info = await connection.invoke('GetMessageInfo', id);
            if (messageId !== id || version !== request) return;
            source = info.message || source; renderPreview(source);
            const readers = info.readBy || [];
            const readTimes = readers.length ? readers.map(row=>`<div class="info-reader">${readers.length > 1 ? `<span>${escapeHtml(row.name)}</span>` : ''}<time>${escapeHtml(stamp(row.readAt))}</time></div>`).join('') : '<span>—</span>';
            const delivered = info.deliveredBy || [];
            const deliveryTimes = delivered.length ? delivered.map(row=>`<div class="info-reader">${delivered.length > 1 ? `<span>${escapeHtml(row.name)}</span>` : ''}<time>${escapeHtml(stamp(row.deliveredAt))}</time></div>`).join('') : `<span>${info.readStatus === 'sent' ? 'Pending' : 'Delivered'}</span>`;
            node('message-info-content').innerHTML = `<section class="info-receipts" aria-label="Message receipts"><div class="info-receipt-row info-read">${ticks}<div><h3>Read</h3>${readTimes}</div></div><div class="info-receipt-row">${ticks}<div><h3>Delivered</h3>${deliveryTimes}</div></div></section><dl class="info-details"><dt>Sent</dt><dd>${escapeHtml(stamp(info.createdAt))}</dd><dt>From</dt><dd>${escapeHtml(info.senderName)}</dd>${info.isEdited ? '<dt>Edited</dt><dd>Yes</dd>' : ''}</dl>`;
        } catch(error) {
            if (messageId !== id || version !== request) return;
            node('message-info-content').innerHTML = `<div class="info-state" role="alert"><p>${escapeHtml(String(error.message || 'Couldn’t load message info.').replace(/^.*HubException: /,''))}</p><button type="button" class="btn btn-ghost" onclick="refreshOpenMessageInfo()">Try again</button></div>`;
        }
    }
    window.openMessageInfo = message => {
        closeAllModals();
        opener = document.activeElement; messageId = message.id; source = message;
        const panel = node('message-info-panel');
        panel.inert = false; panel.setAttribute('aria-hidden','false'); panel.classList.add('is-open');
        node('app-frame').classList.add('has-message-info');
        syncLayout(); renderPreview(message); node('message-info-close').focus();
        return loadInfo();
    };
    window.closeMessageInfo = (restoreFocus = true) => {
        if (messageId === null) return;
        messageId = null; source = null; ++request;
        const panel = node('message-info-panel');
        panel.querySelectorAll('audio,video').forEach(media=>media.pause());
        panel.classList.remove('is-open'); panel.setAttribute('aria-hidden','true'); panel.inert = true;
        node('app-frame').classList.remove('has-message-info'); syncLayout();
        if (restoreFocus && opener?.isConnected) opener.focus();
    };
    window.isMessageInfoOpen = () => messageId !== null;
    window.refreshOpenMessageInfo = id => { if (messageId !== null && (id == null || id === messageId)) return loadInfo(); };
    window.setupMessageInfo = hub => {
        hub.on('MessagesRead', () => window.refreshOpenMessageInfo());
        hub.on('MessagesDelivered', () => window.refreshOpenMessageInfo());
        ['MessageEdited','MessageDeleted'].forEach(event=>hub.on(event, message=>window.refreshOpenMessageInfo(message.id)));
        hub.on('MessageHidden', data=>{if(data.messageId===messageId)window.closeMessageInfo();});
    };
    window.addEventListener('resize', syncLayout);
    document.addEventListener('keydown', event => {
        if (event.key !== 'Tab' || messageId === null || window.innerWidth >= 900 || document.querySelector('.modal-layer:not(.hidden)')) return;
        const items = [...node('message-info-panel').querySelectorAll('button,a[href],input')].filter(element=>!element.disabled);
        const first = items[0], last = items[items.length-1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
})();
