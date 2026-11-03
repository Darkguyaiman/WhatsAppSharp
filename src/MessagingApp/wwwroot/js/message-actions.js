// Shared message menus, private actions, and touch reply gestures.
(() => {
    const hidden = new Set();
    let selected = null, selectedAnchor = null, forwarding = null, pins = [], pinRequest = 0, pinExpiryTimer = null;
    const node = id => document.getElementById(id);
    const preview = message => message.isDeleted ? 'This message was deleted' :
        message.type === 3 ? 'Voice message' : messagePreviewText(message.content || message.attachmentName || (message.type === 1 ? 'Photo' : 'Attachment'));
    const stamp = value => new Date(value).toLocaleString([], {dateStyle:'medium', timeStyle:'short'});
    const glyph = (name, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${extra}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${{
        star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
        pin:'<path d="m16 3 5 5-4 1-4 5v3l-6-6h3l5-4Z"/><path d="m3 21 6-6"/>',
        reply:'<path d="m9 10-5 4 5 4m-5-4h10a6 6 0 0 0 6-6V5"/>',
        forward:'<path d="m15 5 5 5-5 5m5-5H9a5 5 0 0 0-5 5v4"/>'
    }[name]}</svg>`;
    window.isMessageHidden = id => hidden.has(Number(id));
    window.canEditMessage = message => message.senderId === currentUserId && !message.isDeleted && message.type === 0 &&
        Number.isFinite(Date.parse(message.createdAt)) && Date.now() < Date.parse(message.createdAt) + 15 * 60 * 1000;
    window.renderMessageBadges = message => `${message.isPinned ? glyph('pin') : ''}${message.isStarred ? glyph('star') : ''}`;
    window.renderForwardedLabel = message => message.isForwarded ? `<div class="message-forwarded">${glyph('forward')}<span>Forwarded</span></div>` : '';

    function placeMenu(menu, anchor) {
        menu.classList.remove('hidden');
        const margin = 8, rect = anchor.getBoundingClientRect();
        const messageMenu = menu === node('msg-context-menu');
        const thread = messageMenu ? node('messages-container')?.getBoundingClientRect?.() : null;
        const composer = messageMenu ? document.querySelector?.('#active-chat-container > .composer')?.getBoundingClientRect() : null;
        const topLimit = Math.max(margin, (thread?.top || 0) + margin);
        const bottomLimit = Math.max(topLimit + 64, Math.min(window.innerHeight - margin, (composer?.top || thread?.bottom || window.innerHeight) - margin));
        menu.style.maxHeight = `${bottomLimit - topLimit}px`;
        const bounds = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(margin, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - margin))}px`;
        const below = rect.bottom + 5;
        const reactionOnly = menu.classList.contains('reaction-only');
        const preferAbove = reactionOnly && rect.top - bounds.height - margin >= topLimit;
        // Full menus use the space down to the composer before moving upward.
        const desired = messageMenu && !reactionOnly ? below : preferAbove ? rect.top - bounds.height - margin :
            below + bounds.height <= bottomLimit ? below : rect.top - bounds.height - 5;
        menu.style.top = `${Math.max(topLimit, Math.min(desired, bottomLimit - bounds.height))}px`;
        dialogOpener = anchor;
        menu.querySelector(menu.classList.contains('reaction-only') ? '.ctx-react button' : '[role="menuitem"]:not(.hidden)')?.focus();
    }

    window.openMessageMenu = (event, id) => {
        event.stopPropagation();
        const message = loadedMessages.get(Number(id));
        if (!message || hidden.has(message.id)) return;
        activeMenuMsgId = message.id;
        selected = message; selectedAnchor = event.currentTarget;
        node('chat-actions-menu').classList.add('hidden');
        const menu = node('msg-context-menu');
        menu.classList.remove('reaction-only');
        menu.querySelector('.ctx-react').classList.toggle('hidden', message.isDeleted);
        menu.querySelectorAll('[data-message-action]').forEach(button => {
            const action = button.dataset.messageAction;
            let available = !message.isDeleted || ['info','delete'].includes(action);
            if (action === 'edit') available = available && window.canEditMessage(message) && !parseWaCard(message.content);
            if (action === 'copy') available = available && message.type !== 3 && Boolean(message.content);
            button.classList.toggle('hidden', !available);
        });
        node('menu-pin-btn').querySelector('span').textContent = message.isPinned ? 'Unpin' : 'Pin';
        node('menu-star-btn').querySelector('span').textContent = message.isStarred ? 'Unstar' : 'Star';
        placeMenu(menu, event.currentTarget);
    };

    window.openChatActionsMenu = event => {
        event.stopPropagation(); node('msg-context-menu').classList.add('hidden');
        const menu = node('chat-actions-menu');
        if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
        placeMenu(menu, event.currentTarget);
    };

    const failure = error => String(error?.message || 'Couldn’t complete this action. Try again.').replace(/^.*HubException: /, '');
    async function invoke(method, ...args) {
        if (connection?.state !== signalR.HubConnectionState.Connected) throw new Error('Waiting for a connection. Please try again.');
        return connection.invoke(method, ...args);
    }
    function dialog(id) {
        closeAllModals();
        const error = node(id).querySelector('.message-action-error'); if (error) error.textContent = '';
        openDialog(id); window.refreshIcons?.(node(id));
    }
    async function submit(id, action) {
        const modal = node(id);
        if (modal.getAttribute('aria-busy') === 'true') return;
        modal.setAttribute('aria-busy','true');
        const buttons = [...modal.querySelectorAll('button,input,textarea,select')], previous = buttons.map(button => button.disabled);
        buttons.forEach(button => button.disabled = true);
        try { await action(); closeAllModals(); }
        catch (error) { modal.querySelector('.message-action-error').textContent = failure(error); }
        finally { modal.removeAttribute('aria-busy'); buttons.forEach((button,i) => button.disabled = previous[i]); }
    }

    window.replyToMessage = id => {
        const message = loadedMessages.get(Number(id));
        if (!message || message.isDeleted || hidden.has(message.id)) return;
        closeAllModals();
        setReplyTo(message.id, message.senderId === currentUserId ? 'You' : message.senderName, preview(message));
        node('composer-input').focus();
    };

    window.messageAction = async (action, emoji) => {
        const message = selected = loadedMessages.get(activeMenuMsgId);
        if (!message) return;
        if (action === 'reply') { window.replyToMessage(message.id); return; }
        if (action === 'copy') { closeAllModals(); try { await navigator.clipboard.writeText(message.content || ''); showToast('Message copied.'); } catch (_) { showToast('Couldn’t copy this message.'); } return; }
        if (action === 'reaction') { await toggleReaction(message.id, emoji); return; }
        if (action === 'delete') {
            node('message-delete-preview').textContent = preview(message).slice(0,300);
            node('message-delete-everyone').classList.toggle('hidden', !message.canDeleteForEveryone || message.isDeleted);
            dialog('message-delete-modal'); return;
        }
        if (action === 'edit') {
            if (!window.canEditMessage(message)) { closeAllModals();showToast('The 15-minute editing window has ended.');return; }
            node('message-edit-text').value = message.content || '';node('message-edit-original').textContent=message.content || '';
            window.updateMessageEditState();dialog('message-edit-modal');
            requestAnimationFrame(()=>{node('message-edit-text').focus();node('message-edit-text').setSelectionRange?.(message.content?.length||0,message.content?.length||0);});return;
        }
        if (action === 'note') {
            node('message-note-text').value = message.note || '';
            node('message-note-sender').textContent = message.senderId === currentUserId ? 'You' : message.senderName;
            node('message-note-preview').textContent = preview(message).slice(0,300);
            window.updateMessageNoteCount(); dialog('message-note-modal');
            requestAnimationFrame(()=>node('message-note-text').focus()); return;
        }
        if (action === 'react') {
            const menu = node('msg-context-menu'); menu.classList.add('reaction-only');
            placeMenu(menu, selectedAnchor || node(`msg-${message.id}`).querySelector('.msg-menu-btn')); return;
        }
        if (action === 'more-reactions') {
            dialog('message-reaction-modal');
            mountEmojiPicker(node('message-reaction-picker'), character => toggleReaction(selected.id, character)); return;
        }
        if (action === 'info') { await window.openMessageInfo(message); return; }
        if (action === 'pin' && !message.isPinned) { dialog('message-pin-modal'); return; }
        if (action === 'forward') { await openTargets(message); return; }
        closeAllModals();
        try {
            if (action === 'star') await invoke('SetMessageStar', message.id, !message.isStarred);
            if (action === 'pin') await invoke('SetMessagePin', message.id, false, 168);
        } catch(error) { showToast(failure(error)); }
    };

    window.confirmMessageDelete = everyone => {
        const message = selected;
        if (!message || everyone && !message.canDeleteForEveryone) return;
        return submit('message-delete-modal', async () => {
            await invoke(everyone ? 'DeleteMessage' : 'DeleteMessageForMe', message.id);
            if (!everyone) hideMessage({messageId:message.id, conversationId:message.conversationId});
            showToast(everyone ? 'Message deleted for everyone.' : 'Message deleted for you.');
        });
    };
    window.saveMessageEdit = () => {
        const id = selected?.id, text = node('message-edit-text').value.trim();
        if (!id || !text || text === selected.content?.trim()) return;
        return submit('message-edit-modal', () => invoke('EditMessage', id, text));
    };
    window.updateMessageEditState = () => {
        const text=node('message-edit-text').value;
        node('message-edit-count').textContent=`${text.length.toLocaleString()} / 10,000`;
        node('message-edit-save').disabled=!text.trim()||text.trim()===selected?.content?.trim();
    };
    window.saveMessageNote = () => {
        const id = selected?.id; if (!id) return;
        return submit('message-note-modal', () => invoke('SaveMessageNote', id, node('message-note-text').value));
    };
    window.updateMessageNoteCount = () => { node('message-note-count').textContent = `${node('message-note-text').value.length.toLocaleString()} / 5,000`; };
    window.confirmMessagePin = () => {
        const id = selected?.id; if (!id) return;
        const hours = Number(document.querySelector('input[name="message-pin-hours"]:checked')?.value || 168);
        return submit('message-pin-modal', () => invoke('SetMessagePin', id, true, hours));
    };

    async function openTargets(message) {
        const state = forwarding = {message, targets:[], chosen:new Set()};
        node('message-forward-title').textContent = 'Forward message';
        node('message-forward-description').textContent = 'Choose up to five chats.';
        node('message-forward-preview').textContent = preview(message).slice(0,200);
        node('message-forward-search').value = '';
        node('message-forward-targets').textContent = 'Loading chats…';
        node('message-forward-send').disabled = true; node('message-forward-count').textContent = '0 selected';
        dialog('message-forward-modal');
        try {
            const response = await fetch('/Chat?handler=Conversations');
            if (!response.ok || response.redirected) throw new Error('Couldn’t load chats. Please try again.');
            const rows = await response.json();
            if (forwarding !== state) return;
            state.targets = rows;
            renderTargets('');
        } catch(error) { node('message-forward-targets').textContent = failure(error); }
    }
    function renderTargets(query) {
        if (!forwarding) return;
        const term = query.trim().toLowerCase();
        const rows = forwarding.targets.filter(row => row.title.toLowerCase().includes(term));
        node('message-forward-targets').innerHTML = rows.length ? rows.map(row => `<label class="message-target"><input type="checkbox" value="${Number(row.id)}" ${forwarding.chosen.has(row.id) ? 'checked' : ''}/><img src="${escapeHtml(row.avatarUrl)}" alt=""/><span>${escapeHtml(row.title)}</span></label>`).join('') : '<p class="message-empty">No matching chats. Start a chat first to add a recipient.</p>';
    }
    window.filterMessageTargets = renderTargets;
    window.sendForwardedMessage = () => {
        const state = forwarding; if (!state || !state.chosen.size) return;
        return submit('message-forward-modal', async () => {
            await invoke('ForwardMessage', state.message.id, [...state.chosen]);
            showToast('Message forwarded.');
        });
    };

    async function jumpToMessage(message) {
        closeAllModals();
        if (message.conversationId !== activeConversationId) { await refreshConversationList(); await selectConversation(message.conversationId); }
        await scrollToMessage(message.id);
    }
    function savedRows(rows) {
        const list = node('message-saved-list'); list.replaceChildren();
        if (!rows.length) { list.innerHTML = '<p class="message-empty">No messages here yet.</p>'; return; }
        rows.forEach(message => {
            const button = document.createElement('button'); button.type='button'; button.className='message-saved-row';
            button.innerHTML = `<strong>${escapeHtml(message.senderName)}</strong><span>${escapeHtml(preview(message).slice(0,250))}</span>${message.note ? `<p>${escapeHtml(message.note.slice(0,400))}</p>` : ''}<time>${escapeHtml(stamp(message.createdAt))}</time>`;
            button.addEventListener('click', () => jumpToMessage(message)); list.appendChild(button);
        });
    }
    window.showSavedMessages = async notes => {
        node('message-saved-title').textContent = notes ? 'Message notes' : 'Starred messages';
        node('message-saved-list').textContent = 'Loading…'; dialog('message-saved-modal');
        try { savedRows(await invoke('GetSavedMessages', Boolean(notes))); } catch(error) { node('message-saved-list').textContent = failure(error); }
    };
    window.showPinnedMessages = () => { node('message-saved-title').textContent = 'Pinned messages'; savedRows(pins.map(pin => pin.message)); dialog('message-saved-modal'); };
    window.openFirstPinnedMessage = () => { if (pins[0]) jumpToMessage(pins[0].message); };
    window.refreshMessagePins = async () => {
        clearTimeout(pinExpiryTimer);
        const id = activeConversationId, version = ++pinRequest;
        node('pinned-message-bar')?.classList.add('hidden');
        if (!id || connection?.state !== signalR.HubConnectionState.Connected) return;
        try {
            const result = await invoke('GetPinnedMessages', id);
            if (id !== activeConversationId || version !== pinRequest) return;
            pins = result;
            if (pins.length) {
                const delay = Math.min(...pins.map(pin => new Date(pin.expiresAt).getTime())) - Date.now();
                pinExpiryTimer = setTimeout(window.refreshMessagePins, Math.min(2147483647, Math.max(1000, delay + 250)));
            }
            node('pinned-message-bar').classList.toggle('hidden', !pins.length);
            if (pins.length) node('pinned-message-preview').textContent = preview(pins[0].message).slice(0,120);
            const pinnedIds = new Set(pins.map(pin => pin.message.id));
            loadedMessages.forEach(message => { message.isPinned = pinnedIds.has(message.id); updateBadges(message); });
        } catch (_) { /* Reconnect or reopening the chat refreshes the pin list. */ }
    };

    function updateBadges(message) {
        const badges = node(`msg-${message.id}`)?.querySelector('.message-badges');
        if (badges) badges.innerHTML = window.renderMessageBadges(message);
    }
    function hideMessage(data) {
        hidden.add(data.messageId); window.stopVoiceMessagePlayback?.(data.messageId);
        if (data.conversationId !== activeConversationId) return;
        loadedMessages.delete(data.messageId); node(`msg-${data.messageId}`)?.remove();
        if (pendingReply?.id === data.messageId) cancelReply();
        loadedMessages.forEach(message => {
            if (message.replyTo?.id === data.messageId) {
                message.replyTo.content = 'Message unavailable';
                const quote = node(`msg-${message.id}`)?.querySelector('.quote-text'); if (quote) quote.textContent = 'Message unavailable';
            }
        });
        if (!loadedMessages.size) renderMessages([]);
        window.refreshMessagePins();
    }
    window.setupMessageActions = hub => {
        hub.on('MessageHidden', hideMessage);
        hub.on('MessagePersonalStateChanged', message => {
            if (message.conversationId !== activeConversationId || hidden.has(message.id)) return;
            const existing = loadedMessages.get(message.id); if (!existing) return;
            existing.isStarred = message.isStarred; existing.note = message.note; updateBadges(existing);
        });
        hub.on('MessagePinsChanged', data => { if (data.conversationId === activeConversationId) window.refreshMessagePins(); });
    };

    function setupSwipeReply() {
        const container = node('messages-container'); if (!container) return;
        let gesture = null, suppressClickUntil = 0;
        const reset = () => {
            if (!gesture) return;
            clearTimeout(gesture.timer);
            gesture.row.classList.remove('is-swiping'); gesture.row.style.setProperty('--reply-drag','0px');
            gesture.row.querySelector('.swipe-reply-hint')?.remove(); gesture = null;
        };
        container.addEventListener('pointerdown', event => {
            reset();
            if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
            const row = event.target.closest('.msg'), message = row && loadedMessages.get(Number(row.id.replace('msg-','')));
            if (!message || message.isDeleted || event.target.closest('button,a,input,textarea,audio,video,.voice-note')) return;
            const state = gesture = {row, message, x:event.clientX, y:event.clientY, dx:0, dy:0, locked:false};
            state.timer = setTimeout(() => {
                if (gesture !== state) return;
                const anchor = row.querySelector('.msg-menu-btn'); if (!anchor) return;
                window.openMessageMenu({stopPropagation(){},currentTarget:anchor}, message.id);
                suppressClickUntil = Date.now()+500; reset();
            }, 500);
        }, {passive:true});
        container.addEventListener('pointermove', event => {
            const state = gesture; if (!state) return;
            state.dx = event.clientX-state.x; state.dy = event.clientY-state.y;
            if (Math.abs(state.dx)>6 || Math.abs(state.dy)>6) clearTimeout(state.timer);
            if (!state.locked && Math.abs(state.dy)>10 && Math.abs(state.dy)>Math.abs(state.dx)) { reset(); return; }
            if (!state.locked && state.dx>12 && state.dx>Math.abs(state.dy)*1.3) {
                state.locked = true; state.row.classList.add('is-swiping');
                container.setPointerCapture?.(event.pointerId);
                const hint = document.createElement('span'); hint.className='swipe-reply-hint';hint.setAttribute('aria-hidden','true');hint.innerHTML=glyph('reply');state.row.appendChild(hint);
            }
            if (state.locked) { event.preventDefault(); state.row.style.setProperty('--reply-drag',`${Math.min(64,Math.max(0,state.dx*.65))}px`); }
        }, {passive:false});
        container.addEventListener('pointerup', () => {
            if (!gesture) return;
            const reply = gesture.locked && gesture.dx>=64 && Math.abs(gesture.dy)<48, id=gesture.message.id;
            if (gesture.locked) suppressClickUntil=Date.now()+400;
            reset(); if (reply) window.replyToMessage(id);
        });
        container.addEventListener('pointercancel', reset);
        container.addEventListener('click', event => { if (Date.now()<suppressClickUntil) { event.preventDefault();event.stopImmediatePropagation(); } },true);
    }

    document.addEventListener('DOMContentLoaded', setupSwipeReply);
    document.addEventListener('change', event => {
        if (!event.target.matches('#message-forward-targets input[type="checkbox"]') || !forwarding) return;
        const id = Number(event.target.value), limit = 5;
        if (event.target.checked && forwarding.chosen.size>=limit) { event.target.checked=false;showToast(`Choose up to ${limit} chats.`);return; }
        if (event.target.checked) forwarding.chosen.add(id); else forwarding.chosen.delete(id);
        node('message-forward-count').textContent = `${forwarding.chosen.size} selected`;
        node('message-forward-send').disabled = !forwarding.chosen.size;
    });
    document.addEventListener('click', event => {
        const menu=node('chat-actions-menu');
        if (menu && !menu.contains(event.target) && !event.target.closest('[onclick="openChatActionsMenu(event)"]')) menu.classList.add('hidden');
    });
    document.addEventListener('keydown', event => {
        const menu=document.activeElement?.closest('#msg-context-menu,#chat-actions-menu');
        if (!menu || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
        const items=[...menu.querySelectorAll('[role="menuitem"]:not(.hidden):not(:disabled)')]; if (!items.length) return;
        event.preventDefault(); const index=items.indexOf(document.activeElement);
        items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
    });
})();
