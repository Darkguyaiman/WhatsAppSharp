/**
 * WhatsApp Web client — SignalR chat engine
 */

let connection = null;
let currentUserId = 0;
let currentDisplayName = "";
let activeConversationId = null;
let typingTimeout = null;
let isTyping = false;
let pendingReply = null; // { id, senderName, content }
let pendingAttachment = null; // { url, name, size, type }
let messagesRequest = null;
let loadedMessages = new Map();
let hasOlderMessages = false;
let loadingOlder = false;
let sendingMessage = false;
let uploadingAttachment = false;
let attachmentUpload = null;
let attachmentVersion = 0;
let reconnectTimer = null;
let readingConversation = null;
let contactSearchVersion = 0;
let messageSearchVersion = 0;
let contactSearchTimer;
let groupMode = false;
let dialogOpener = null;
const drafts = new Map();
const draftExtras = new Map();
const selectedGroupMembers = new Set();
let favouriteConversations = new Set();

// Decode local audio once; unlock sound on a user gesture, as browsers require.
let audioCtx = null;
let messageSounds = true;
let audioBuffers = new Map();
let soundLoad = null;
try { messageSounds = localStorage.getItem('wa_message_sounds') !== 'off'; } catch (_) {}
async function unlockMessageAudio() {
    try {
        const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
        audioCtx ||= new Audio(); if (audioCtx.state === 'suspended') await audioCtx.resume();
        soundLoad ||= Promise.all(['message'].map(async name => { const response = await fetch(`/audio/${name}.wav`); if (!response.ok) return; audioBuffers.set(name,await audioCtx.decodeAudioData(await response.arrayBuffer())); }));
        await soundLoad;
    } catch (_) { soundLoad = null; }
}
async function playNotificationSound(isSent = false, force = false, messageId = null) {
    if (isSent) return;
    if (!force) {
        if (document.visibilityState === 'visible' && document.hasFocus()) return;
        // Web push owns the alert when enabled, avoiding a second in-page chime.
        if (window.hasEnabledPushNotifications?.()) return;
        if (await window.isAppInForeground?.()) return;
        if (document.visibilityState === 'visible' && document.hasFocus()) return;
    }
    if ((!messageSounds && !force) || (typeof currentCall !== 'undefined' && currentCall) || !audioCtx || audioCtx.state !== 'running') return;
    if (messageId != null && !force) {
        try { const key=`wa_sound_${currentUserId}_${messageId}`; const prior=Number(localStorage.getItem(key)); if (Date.now()-prior < 5000) return; localStorage.setItem(key,String(Date.now())); setTimeout(()=>localStorage.removeItem(key),6000); } catch (_) {}
    }
    try { const buffer=audioBuffers.get('message');if(!buffer)return;const source=audioCtx.createBufferSource();const gain=audioCtx.createGain();source.buffer=buffer;gain.gain.value=.7;source.connect(gain);gain.connect(audioCtx.destination);source.start(); } catch (_) {}
}
function syncSoundSwitch() { document.querySelectorAll('.sound-switch').forEach(button=>button.setAttribute('aria-checked',String(messageSounds))); }
function toggleMessageSounds() { messageSounds=!messageSounds;try{localStorage.setItem('wa_message_sounds',messageSounds?'on':'off');}catch(_){}syncSoundSwitch();if(messageSounds)previewMessageSound(); }
async function previewMessageSound() { await unlockMessageAudio();playNotificationSound(false,true); }
document.addEventListener('pointerdown',unlockMessageAudio,{passive:true});
document.addEventListener('keydown',unlockMessageAudio);
window.addEventListener('storage',event=>{if(event.key==='wa_message_sounds'){messageSounds=event.newValue!=='off';syncSoundSwitch();}});
// Format relative date
const messageTimeFormatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false });
const messageDateFormatter = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
const messageYearFormatter = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', year: 'numeric' });

function formatMessageDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    if (isToday) return "Today";
    if (isYesterday) return "Yesterday";
    return (d.getFullYear() !== now.getFullYear() ? messageYearFormatter : messageDateFormatter).format(d);
}

function formatMessageTime(dateStr) {
    const d = new Date(dateStr);
    return messageTimeFormatter.format(d);
}

// Document Ready
document.addEventListener("DOMContentLoaded", () => {
    const configEl = document.getElementById("chat-config");
    if (!configEl) return;

    currentUserId = parseInt(configEl.dataset.userId || "0");
    currentDisplayName = configEl.dataset.displayName || "User";
    loadFavourites();
    const initialConv = configEl.dataset.initialConvId;

    setupSignalR();
    setupEventListeners();
    setupReliabilityListeners();
    syncThemeIcon();
    syncSoundSwitch();
    applyConvFilters();

    if (initialConv) {
        selectConversation(parseInt(initialConv), window.innerWidth < 900);
    }
});

// Setup SignalR
function setupSignalR() {
    connection = new signalR.HubConnectionBuilder().withUrl('/hubs/chat')
        .withAutomaticReconnect([0, 2000, 5000, 10000, 20000, 30000]).build();
    connection.on('ReceiveMessage', handleIncomingMessage);
    window.setupMessageActions?.(connection);
    window.setupMessageInfo?.(connection);
    window.setupMessageReceipts?.(connection);
    if (typeof setupFeatureEvents === 'function') setupFeatureEvents(connection);
    if (typeof setupCallEvents === 'function') setupCallEvents(connection);
    connection.on('UserTyping', data => {
        if (data.conversationId === activeConversationId && data.userId !== currentUserId) showTypingIndicator(data.displayName, data.isTyping);
    });
    connection.on('UserPresenceChanged', data => handlePresenceChange(data.userId, data.isOnline));
    connection.on('MessagesRead', data => {
        if (data.conversationId === activeConversationId && data.readerId !== currentUserId) handleMessagesRead(data.messageIds);
    });
    connection.on('MessageReactionUpdated', updateMessageReactions);
    connection.on('MessageEdited', updateMessageContent);
    connection.on('MessageDeleted', renderMessageAsDeleted);
    connection.on('ConversationUpdated', updateConversationInList);
    connection.onreconnecting(() => setConnectionStatus('Reconnecting… Your draft is safe.'));
    connection.onreconnected(async () => { setConnectionStatus(''); await recoverChat(); });
    connection.onclose(() => { setConnectionStatus(navigator.onLine ? 'Connection lost. Reconnecting…' : 'You’re offline. Your draft is safe.'); scheduleConnection(); });
    startConnection();
}

async function selectConversation(convId, updateMobileView = true, force = false) {
    if (activeConversationId === convId && !force) { if (updateMobileView) { switchMobileView('chat');scrollToBottom(); } markVisibleChatRead(); return; }
    window.stopVoiceForNavigation?.();
    window.closeMessageInfo?.(false);
    if (isTyping) invokeQuietly('SendTyping', activeConversationId, false);
    isTyping = false;
    clearTimeout(typingTimeout);
    saveDraft();
    activeConversationId = convId;
    cancelReply();
    clearPendingAttachment();
    document.getElementById('typing-bubble-container')?.classList.add('hidden');
    document.getElementById('in-chat-search-bar')?.classList.add('hidden');
    document.getElementById('pinned-message-bar')?.classList.add('hidden');
    const input = document.getElementById('composer-input');
    input.value = drafts.get(convId) || '';
    restoreDraftExtras(convId);
    updateSendButtonState();
    document.querySelectorAll('.conv-item').forEach(el => el.classList.toggle('is-active', Number(el.dataset.id) === convId));
    if (updateMobileView) switchMobileView('chat');
    history.replaceState(null, '', `/Chat?conv=${convId}`);
    document.getElementById('empty-chat-state').classList.add('hidden');
    document.getElementById('active-chat-container').classList.remove('hidden');
    updateHeaderFromConversation(convId);
    messagesRequest?.abort();
    const request = messagesRequest = new AbortController();
    loadedMessages = new Map();
    hasOlderMessages = false;
    const container = document.getElementById('messages-container');
    container.innerHTML = '<div class="thread-loading"><span class="spinner"></span></div>';
    try {
        const response = await fetch(`/Chat?handler=Messages&conversationId=${convId}`, {signal:request.signal});
        if (!response.ok) throw new Error('Unable to load messages');
        const messages = await response.json();
        if (activeConversationId !== convId || request !== messagesRequest) return;
        messages.forEach(message=>window.noteMessageDelivery?.(message));
        hasOlderMessages = messages.length === 50;
        messages.forEach(message => { if (!window.isMessageHidden?.(message.id) && !loadedMessages.has(message.id)) loadedMessages.set(message.id, message); });
        renderMessages([...loadedMessages.values()].sort((a,b) => a.id-b.id));
        if (!force && window.innerWidth >= 900) window.animateScreenSwap?.(container);
        invokeQuietly('JoinConversation', convId);
        markVisibleChatRead();
        window.refreshMessagePins?.();
    } catch (error) {
        if (error.name === 'AbortError' || activeConversationId !== convId) return;
        container.innerHTML = '<div class="thread-start">Couldn’t load messages. <button class="btn" type="button" onclick="selectConversation(activeConversationId, true, true)">Try again</button></div>';
    }
}

function updateHeaderFromConversation(convId) {
    const item = document.querySelector(`.conv-item[data-id="${convId}"]`);
    if (!item) return;

    const title = item.querySelector(".conv-title").textContent;
    const avatar = item.querySelector(".conv-avatar").src;
    const isOnline = item.dataset.online === "true";

    document.getElementById("chat-header-title").textContent = title;
    document.querySelectorAll('.direct-call-action').forEach(button => button.classList.toggle('hidden', item.dataset.isGroup === 'true'));
    document.getElementById("chat-header-avatar").src = avatar;
    
    const statusEl = document.getElementById("chat-header-status");
    if (item.dataset.isGroup === "true") {
        statusEl.textContent = item.dataset.memberNames || "Group conversation";
        statusEl.classList.remove("is-online");
    } else {
        statusEl.textContent = isOnline ? "online" : "offline";
        statusEl.classList.toggle("is-online", isOnline);
    }
    updateFavouriteButton();
}

// Render Messages
function renderMessages(messages, scroll = true) {
    window.pauseVoicePlayback?.();
    const container = document.getElementById('messages-container');
    const fragment = document.createDocumentFragment();
    if (hasOlderMessages) {
        const button = document.createElement('button');
        button.className = 'load-older'; button.textContent = 'Load earlier messages'; button.type = 'button';
        button.onclick = loadOlderMessages; fragment.appendChild(button);
    }
    if (!messages.length) {
        const empty = document.createElement('div'); empty.className = 'thread-start'; empty.textContent = 'No messages yet. Say hello.'; fragment.appendChild(empty);
    }
    let lastDate = '';
    for (const message of messages) {
        const date = formatMessageDate(message.createdAt);
        if (date !== lastDate) { fragment.appendChild(createDateSeparator(date)); lastDate = date; }
        fragment.appendChild(createMessageElement(message));
    }
    container.replaceChildren(fragment);
    window.refreshIcons?.(container);
    window.watchMessageLayout?.();
    if (scroll) scrollToBottom();
}

function createDateSeparator(dateText) {
    const div = document.createElement("div");
    div.className = "date-chip";
    div.innerHTML = `<span>${escapeHtml(dateText)}</span>`;
    return div;
}

function parseWaCard(content) {
    const raw = String(content || '').trim();
    if (!raw.startsWith('{')) return null;
    try {
        const data = JSON.parse(raw);
        if (!data || !['contact', 'poll', 'event', 'catalogue', 'sticker', 'voice'].includes(data.wa)) return null;
        return data;
    } catch { return null; }
}

function messagePreviewText(content) {
    const card = parseWaCard(content);
    if (!card) return content || '';
    if (card.wa === 'voice') return 'Voice message';
    if (card.wa === 'contact') return `Contact: ${card.username ? '@' + card.username : card.name || 'Contact'}`;
    if (card.wa === 'poll') return `Poll: ${card.question || 'Poll'}`;
    if (card.wa === 'event') return `Event: ${card.title || 'Event'}`;
    if (card.wa === 'catalogue') return `Catalogue: ${card.name || 'Item'}`;
    return card.caption || 'Sticker';
}

function clipShareText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeAvatar(url) {
    return typeof url === 'string' && /^\/(images|uploads)\/[a-z0-9._/-]+$/i.test(url) ? url : '/images/avatars/avatar-default.svg';
}

function renderShareCard(card) {
    if (card.wa === 'contact') {
        const id = Number(card.id);
        const username = clipShareText(card.username, 50);
        const label = escapeHtml(username ? '@' + username : clipShareText(card.name, 80) || 'Contact');
        return `<div class="wa-card"><div class="wa-card-kicker">Contact</div><div class="wa-contact"><img src="${safeAvatar(card.avatar)}" alt="" /><div><h4>${label}</h4></div></div>${Number.isSafeInteger(id) && id > 0 ? `<button type="button" class="btn btn-ghost" onclick="startDirectChat(${id})">Message</button>` : ''}</div>`;
    }
    if (card.wa === 'poll') {
        const options = Array.isArray(card.options) ? card.options.map(option => clipShareText(option, 100)).filter(Boolean).slice(0, 12) : [];
        return `<div class="wa-card"><div class="wa-card-kicker">Poll</div><h4>${escapeHtml(clipShareText(card.question, 200) || 'Poll')}</h4>${options.map(option => `<div class="wa-option">${escapeHtml(option)}</div>`).join('')}</div>`;
    }
    if (card.wa === 'event') {
        const when = eventWhenLabel(card.when);
        const where = clipShareText(card.where, 120);
        const detail = clipShareText(card.detail, 500);
        return `<div class="wa-card"><div class="wa-card-kicker">Event</div><h4>${escapeHtml(clipShareText(card.title, 120) || 'Event')}</h4>${when ? `<p>${escapeHtml(when)}</p>` : ''}${where ? `<p>${escapeHtml(where)}</p>` : ''}${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</div>`;
    }
    if (card.wa === 'catalogue') {
        const price = clipShareText(card.price, 40);
        const detail = clipShareText(card.detail, 240);
        return `<div class="wa-card"><div class="wa-card-kicker">Catalogue</div><h4>${escapeHtml(clipShareText(card.name, 80) || 'Item')}</h4>${price ? `<p>${escapeHtml(price)}</p>` : ''}${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</div>`;
    }
    return '';
}

function eventWhenLabel(value) {
    const raw = String(value || '');
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return clipShareText(raw, 40);
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function createMessageElement(msg) {
    window.applyKnownMessageReceipt?.(msg);
    const isMine = msg.senderId === currentUserId;
    const wrapper = document.createElement("div");
    wrapper.id = `msg-${msg.id}`;
    wrapper.className = `msg ${isMine ? "is-mine" : "is-theirs"}`;

    const bubble = document.createElement("div");
    bubble.className = `bubble ${isMine ? "bubble-sent" : "bubble-received"}`;

    let senderHtml = "";
    const isGroup = document.querySelector(`.conv-item[data-id="${activeConversationId}"]`)?.dataset.isGroup === "true";
    if (!isMine && msg.senderName && isGroup) {
        senderHtml = `<div class="bubble-sender group-sender-${Math.abs(msg.senderId) % 4}">${escapeHtml(msg.senderName)}</div>`;
    }

    let replyHtml = "";
    if (msg.replyTo) {
        replyHtml = `
            <div class="quote" onclick="scrollToMessage(${msg.replyTo.id})">
                <div class="quote-name">${escapeHtml(msg.replyTo.senderName)}</div>
                <div class="quote-text">${typeof formatEmoji === "function" ? formatEmoji(messagePreviewText(msg.replyTo.content || "Attachment")) : escapeHtml(messagePreviewText(msg.replyTo.content || "Attachment"))}</div>
            </div>
        `;
    }

    const card = msg.isDeleted ? null : parseWaCard(msg.content);
    let attachmentHtml = "";
    const fileUrl = safeAttachmentUrl(msg.attachmentUrl);
    if (fileUrl) {
        const lower = fileUrl.toLowerCase();
        if (msg.type === 3 && typeof renderVoiceMessage === 'function') {
            bubble.classList.add('bubble-voice');
            attachmentHtml = renderVoiceMessage(msg);
        } else if (card?.wa === 'sticker') {
            attachmentHtml = `<img class="attach-sticker" src="${escapeHtml(fileUrl)}" alt="Sticker" />`;
        } else if (msg.type === 1) {
            attachmentHtml = `
                <div class="attach-img" data-image-url="${escapeHtml(fileUrl)}">
                    <img src="${escapeHtml(fileUrl)}" alt="Shared image" loading="lazy" decoding="async" />
                </div>
            `;
        } else if (lower.endsWith('.mp4')) {
            attachmentHtml = `<video class="attach-video" controls preload="metadata" src="${escapeHtml(fileUrl)}"></video>`;
        } else if (lower.endsWith('.mp3')) {
            attachmentHtml = `<audio class="attach-audio" controls preload="metadata" src="${escapeHtml(fileUrl)}"></audio>`;
        } else {
            attachmentHtml = `
                <div class="attach-file">
                    <div class="attach-file-icon">
                        <i data-lucide="file-text"></i>
                    </div>
                    <div class="attach-file-meta">
                        <div class="attach-file-name">${escapeHtml(msg.attachmentName || "Document")}</div>
                        <div class="attach-file-size">${formatBytes(msg.attachmentSize || 0)}</div>
                    </div>
                    <a href="${escapeHtml(fileUrl)}" download="${escapeHtml(msg.attachmentName || 'file')}" class="icon-btn" aria-label="Download">
                        <i data-lucide="download"></i>
                    </a>
                </div>
            `;
        }
    }

    let contentHtml = "";
    if (msg.isDeleted) {
        contentHtml = `<span class="deleted-msg">This message was deleted</span>`;
    } else if (msg.type === 3) {
        if (!fileUrl) contentHtml = '<span class="deleted-msg">Voice message unavailable</span>';
    } else if (card && !['sticker', 'voice'].includes(card.wa)) {
        contentHtml = renderShareCard(card);
    } else if (card?.caption) {
        contentHtml = `<div class="message-text">${typeof formatEmoji === "function" ? formatEmoji(card.caption) : escapeHtml(card.caption)}</div>`;
    } else if (msg.content && !card) {
        const onlyEmoji = typeof emojiOnlyCount === "function" && emojiOnlyCount(msg.content);
        contentHtml = `<div class="message-text${onlyEmoji > 0 && onlyEmoji <= 3 ? " emoji-only" : ""}">${typeof formatEmoji === "function" ? formatEmoji(msg.content) : escapeHtml(msg.content)}</div>`;
    }

    const tickHtml = window.renderMessageTicks?.(msg) || '';

    const editedHtml = msg.isEdited && !msg.isDeleted ? `<span>(edited)</span>` : "";

    let reactionsHtml = "";
    if (msg.reactions && msg.reactions.length > 0) {
        reactionsHtml = `<div class="reactions-pill">`;
        msg.reactions.forEach(r => {
            reactionsHtml += `
                <button type="button" onclick="toggleReaction(${msg.id}, '${escapeHtml(r.emoji)}')">
                    <span>${typeof formatEmoji === "function" ? formatEmoji(r.emoji) : escapeHtml(r.emoji)}</span>
                    ${r.count > 1 ? `<span>${r.count}</span>` : ""}
                </button>
            `;
        });
        reactionsHtml += `</div>`;
    }

    const hoverMenuTrigger = `
        <button type="button" class="msg-menu-btn"
                data-message-id="${msg.id}"
                aria-label="Message actions">
            <i data-lucide="chevron-down"></i>
        </button>
    `;

    bubble.innerHTML = `
        ${window.renderForwardedLabel?.(msg) || ''}
        ${senderHtml}
        ${replyHtml}
        ${attachmentHtml}
        ${contentHtml}
        <div class="msg-foot">
            <span class="message-badges">${window.renderMessageBadges?.(msg) || ''}</span>
            ${editedHtml}
            <span>${formatMessageTime(msg.createdAt)}</span>
            ${tickHtml}
        </div>
        ${reactionsHtml}
        ${hoverMenuTrigger}
    `;

    if (!isMine && isGroup) {
        const avatar = document.createElement('img');
        avatar.className = 'sender-avatar'; avatar.src = msg.senderAvatarUrl || '/images/avatars/avatar-default.svg'; avatar.alt = '';
        avatar.loading = 'lazy'; wrapper.appendChild(avatar);
    }
    wrapper.appendChild(bubble);
    const trigger = wrapper.querySelector('.msg-menu-btn');
    if (trigger) trigger.addEventListener('click', event => openMessageMenu(event, msg.id));
    wrapper.querySelector('[data-image-url]')?.addEventListener('click', () => openLightbox(safeAttachmentUrl(msg.attachmentUrl)));
    return wrapper;
}

// Inbound message handling
function handleIncomingMessage(message) {
    if (window.isMessageHidden?.(message.id)) return;
    window.noteMessageDelivery?.(message);
    window.applyKnownMessageReceipt?.(message);
    message.isMine = message.senderId === currentUserId;
    if (message.conversationId !== activeConversationId) { if (!message.isMine) playNotificationSound(false, false, message.id); return; }
    if (loadedMessages.has(message.id)) return;
    loadedMessages.set(message.id, message);
    const container = document.getElementById('messages-container');
    if (container.querySelector('.spinner')) return; // Merge with the request when it completes.
    container.querySelector('.thread-start')?.remove();
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
    const previous = container.querySelector('.msg:last-child');
    const previousMessage = previous ? loadedMessages.get(Number(previous.id.replace('msg-', ''))) : null;
    if (!previousMessage || formatMessageDate(previousMessage.createdAt) !== formatMessageDate(message.createdAt))
        container.appendChild(createDateSeparator(formatMessageDate(message.createdAt)));
    const element = createMessageElement(message); container.appendChild(element); window.refreshIcons?.(element);
    window.watchMessageLayout?.(element);
    if (nearBottom || message.isMine) scrollToBottom();
    playNotificationSound(message.isMine, false, message.id);
    if (!message.isMine) markVisibleChatRead();
}

function handlePresenceChange(userId, isOnline) {
    // Update active chat header if current contact matches
    const activeHeaderStatus = document.getElementById("chat-header-status");
    const activeConvItem = document.querySelector(`.conv-item[data-id="${activeConversationId}"]`);
    
    if (activeConvItem && parseInt(activeConvItem.dataset.otherUserId) === userId) {
        activeConvItem.dataset.online = isOnline ? "true" : "false";
        if (activeHeaderStatus && activeConvItem.dataset.isGroup !== "true") {
            activeHeaderStatus.textContent = isOnline ? "online" : "offline";
            activeHeaderStatus.classList.toggle("is-online", isOnline);
        }
    }

    // Update online indicator on conversation list
    document.querySelectorAll(`.conv-item[data-other-user-id="${userId}"]`).forEach(el => {
        el.dataset.online = isOnline ? "true" : "false";
        const dot = el.querySelector(".online-dot");
        if (dot) {
            if (isOnline) dot.classList.remove("hidden");
            else dot.classList.add("hidden");
        }
    });
}

// Typing Indicator
function showTypingIndicator(userName, isTyping) {
    const statusEl = document.getElementById("chat-header-status");
    const bubbleEl = document.getElementById("typing-bubble-container");

    if (isTyping) {
        if (statusEl) statusEl.textContent = `${userName} is typing...`;
        if (bubbleEl) bubbleEl.classList.remove("hidden");
        scrollToBottom();
    } else {
        if (statusEl) {
            const activeConvItem = document.querySelector(`.conv-item[data-id="${activeConversationId}"]`);
            const isOnline = activeConvItem?.dataset.online === "true";
            statusEl.textContent = isOnline ? "online" : "offline";
            statusEl.classList.toggle("is-online", isOnline);
        }
        if (bubbleEl) bubbleEl.classList.add("hidden");
    }
}

// Read receipts update
function handleMessagesRead(messageIds) {
    window.updateMessageReceiptStatus?.(messageIds,'read');
}

// Reactions update
function updateMessageReactions(message) {
    if (message.conversationId !== activeConversationId) return;
    if (window.isMessageHidden?.(message.id)) return;
    window.applyKnownMessageReceipt?.(message);
    loadedMessages.set(message.id, message);
    const msgEl = document.getElementById(`msg-${message.id}`);
    if (!msgEl) return;

    let pill = msgEl.querySelector(".reactions-pill");
    if (!message.reactions || message.reactions.length === 0) {
        if (pill) pill.remove();
        return;
    }

    let reactionsHtml = `<div class="reactions-pill">`;
    message.reactions.forEach(r => {
        reactionsHtml += `
            <button type="button" onclick="toggleReaction(${message.id}, '${escapeHtml(r.emoji)}')">
                <span>${typeof formatEmoji === "function" ? formatEmoji(r.emoji) : escapeHtml(r.emoji)}</span>
                ${r.count > 1 ? `<span>${r.count}</span>` : ""}
            </button>
        `;
    });
    reactionsHtml += `</div>`;

    if (pill) {
        pill.outerHTML = reactionsHtml;
    } else {
        const bubble = msgEl.querySelector(".bubble-sent, .bubble-received");
        if (bubble) bubble.insertAdjacentHTML("beforeend", reactionsHtml);
    }
}

// Message Edit update
function updateMessageContent(message) {
    if (message.conversationId !== activeConversationId) return;
    if (window.isMessageHidden?.(message.id)) return;
    window.applyKnownMessageReceipt?.(message);
    loadedMessages.set(message.id, message);
    const msgEl = document.getElementById(`msg-${message.id}`);
    if (!msgEl) return;
    const replacement=createMessageElement(message);msgEl.replaceWith(replacement);
    window.refreshIcons?.(replacement);window.watchMessageLayout?.(replacement);
}

// Message Delete update
function renderMessageAsDeleted(message) {
    window.stopVoiceMessagePlayback?.(message.id);
    if (message.conversationId !== activeConversationId) return;
    if (window.isMessageHidden?.(message.id)) return;
    loadedMessages.set(message.id, message);
    const msgEl = document.getElementById(`msg-${message.id}`);
    if (!msgEl) return;

    const replacement = createMessageElement(message);
    msgEl.replaceWith(replacement); window.refreshIcons?.(replacement);
    window.watchMessageLayout?.(replacement);
    loadedMessages.forEach(other => {
        if (other.replyTo?.id === message.id) {
            other.replyTo.content = 'This message was deleted';
            const quote = document.getElementById(`msg-${other.id}`)?.querySelector('.quote-text');
            if (quote) quote.textContent = 'This message was deleted';
        }
    });
}

// Update Conversation in Left Sidebar List
function updateConversationInList(conv) {
    const list = document.getElementById('conversations-list');
    if (!list) return;
    const existing = list.querySelector(`.conv-item[data-id="${conv.id}"]`);
    const item = createConversationListItem(conv);
    existing?.remove();
    list.querySelector('.empty-list')?.remove();
    const next = [...list.querySelectorAll('.conv-item')].find(row => Number(row.dataset.timestamp) < Number(item.dataset.timestamp));
    list.insertBefore(item, next || null);
    if (conv.id === activeConversationId) updateHeaderFromConversation(conv.id);
    applyConvFilters();
}

async function refreshConversationList() {
    const response = await fetch('/Chat?handler=Conversations');
    if (!response.ok) throw new Error('Couldn’t refresh chats. Please reload.');
    const conversations = await response.json();
    const list = document.getElementById('conversations-list');
    const fragment = document.createDocumentFragment();
    conversations.forEach(c => fragment.appendChild(createConversationListItem(c)));
    list.replaceChildren(fragment);
    if (!conversations.length) list.innerHTML = '<div class="empty-list">No chats yet. Use New chat to start a conversation.</div>';
    applyConvFilters();
}

function createConversationListItem(c) {
    const div = document.createElement("div");
    div.className = `conv-item ${activeConversationId === c.id ? "is-active" : ""} ${c.unreadCount > 0 ? "has-unread" : ""}`;
    div.dataset.id = c.id;
    div.dataset.timestamp = c.lastMessageTimestamp ? new Date(c.lastMessageTimestamp).getTime() : 0;
    div.dataset.otherUserId = c.otherUserId || "";
    div.dataset.online = c.isOnline ? "true" : "false";
    div.dataset.isGroup = c.isGroup ? "true" : "false";
    div.dataset.memberNames = c.memberNames || '';
    div.dataset.unread = c.unreadCount || 0;
    div.setAttribute("role", "button");
    div.tabIndex = 0;
    div.onclick = () => selectConversation(c.id);

    div.innerHTML = `
        <div class="conv-avatar-wrap">
            <img src="${escapeHtml(c.avatarUrl)}" class="conv-avatar" alt="" />
            <span class="online-dot ${c.isOnline ? "" : "hidden"}"></span>
        </div>
        <div class="conv-body">
            <div class="conv-top">
                <span class="conv-title">${escapeHtml(c.title)}</span>
                <span class="conv-time">${c.lastMessageTimestamp ? formatMessageTime(c.lastMessageTimestamp) : ""}</span>
            </div>
            <div class="conv-bottom">
                <span class="conv-last-msg">${c.lastMessageSenderId === currentUserId ? `<svg class="conv-preview-ticks ${c.lastMessageIsRead ? 'tick-read' : ''}" viewBox="0 0 20 14" aria-hidden="true"><path d="m1 7 4 4L14 2m-4 8 2 1 7-9" /></svg>` : ''}<span class="conv-preview-text">${typeof formatEmoji === "function" ? formatEmoji(messagePreviewText(c.lastMessageContent || "No messages yet")) : escapeHtml(messagePreviewText(c.lastMessageContent || "No messages yet"))}</span></span>
                <span class="unread-badge ${c.unreadCount > 0 ? "" : "hidden"}">${c.unreadCount}</span>
            </div>
        </div>
    `;
    return div;
}

// Send Message
async function sendMessage() {
    const input = document.getElementById('composer-input');
    const content = input.value.trim();
    if (sendingMessage || (!content && !pendingAttachment) || !activeConversationId) return;
    if (connection?.state !== signalR.HubConnectionState.Connected) { showToast('Waiting for a connection. Your draft is safe.'); return; }
    sendingMessage = true; input.readOnly = true; updateSendButtonState();
    const conversationId = activeConversationId;
    const attachment = pendingAttachment;
    const reply = pendingReply;
    clearTimeout(typingTimeout); isTyping = false;
    invokeQuietly('SendTyping', conversationId, false);
    try {
        const outbound = attachment?.kind === 'sticker' ? JSON.stringify({ wa: 'sticker', caption: content }) : content;
        await connection.invoke('SendMessage', conversationId, outbound,
            attachment ? (attachment.type.startsWith('image/') ? 'Image' : 'Document') : 'Text',
            attachment?.url || null, attachment?.name || null, attachment?.size || null, reply?.id || null);
        drafts.delete(conversationId);
        draftExtras.delete(conversationId);
        if (activeConversationId === conversationId) {
            input.value = ''; input.style.height = 'auto'; cancelReply(); clearPendingAttachment();
        }
    } catch (error) { showToast('Message wasn’t confirmed. Your draft is kept. Check the chat before trying again.'); }
    finally { sendingMessage = false; input.readOnly = false; updateSendButtonState(); if (activeConversationId === conversationId) input.focus(); }
}

function setupEventListeners() {
    const input = document.getElementById("composer-input");
    const sendBtn = document.getElementById("send-btn");

    if (input) {
        input.addEventListener("input", () => {
            // Auto resize
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 120) + "px";
            updateSendButtonState();

            // Handle typing detection with debounce
            if (!isTyping && activeConversationId) {
                isTyping = true;
                invokeQuietly("SendTyping", activeConversationId, true);
            }
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                isTyping = false;
                invokeQuietly("SendTyping", activeConversationId, false);
            }, 2500);
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener("click", sendMessage);
    }

    // Conversation Search Filter
    const searchInput = document.getElementById("search-conversations-input");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            applyConvFilters();
        });
    }

    // Attachment Input Handlers
    const fileInput = document.getElementById("attachment-file-input");
    if (fileInput) {
        fileInput.addEventListener("change", handleFileUpload);
    }

    window.addEventListener('keydown', handleEscape);

    // Close dropdowns on outside click
    window.addEventListener("click", (e) => {
        const menu = document.getElementById("msg-context-menu");
        if (menu && !menu.contains(e.target) && !e.target.closest(".msg-menu-btn")) {
            menu.classList.add("hidden");
        }
        const emojiPicker = document.getElementById("emoji-picker-container");
        if (emojiPicker && !emojiPicker.contains(e.target) && !e.target.closest("#emoji-toggle-btn")) {
            emojiPicker.classList.add("hidden");
        }
        const attachMenu = document.getElementById("attach-menu");
        if (attachMenu && !attachMenu.contains(e.target) && !e.target.closest("#attach-toggle")) closeAttachMenu();
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth >= 900) {
            document.getElementById("app-frame")?.classList.remove("is-chat");
        }
    });
}

function updateSendButtonState() {
    const input = document.getElementById('composer-input');
    const button = document.getElementById('send-btn');
    if (!input || !button) return;
    button.disabled = sendingMessage || uploadingAttachment || connection?.state !== signalR.HubConnectionState.Connected || !(input.value.trim() || pendingAttachment);
    button.title = sendingMessage ? 'Sending…' : connection?.state !== signalR.HubConnectionState.Connected ? 'Waiting for connection' : 'Send';
    window.syncVoiceComposer?.();
}

function setReplyTo(id, senderName, content) {
    pendingReply = { id, senderName, content };
    const bar = document.getElementById("reply-preview-bar");
    document.getElementById("reply-preview-sender").textContent = senderName;
    const preview = messagePreviewText(content || "Attachment");
    document.getElementById("reply-preview-content").innerHTML = typeof formatEmoji === "function" ? formatEmoji(preview) : escapeHtml(preview);
    bar.classList.remove("hidden");
    bar.classList.add("flex");
    document.getElementById("composer-input").focus();
}

function cancelReply() {
    pendingReply = null;
    const bar = document.getElementById("reply-preview-bar");
    if (bar) {
        bar.classList.add("hidden");
        bar.classList.remove("flex");
    }
}

// Attachment Management
function handleFileUpload(e) {
    const file = e.target.files[0];
    const kind = e.target.dataset.kind || 'document';
    e.target.value = '';
    if (file) uploadAttachment(file, kind);
}

async function uploadAttachment(file, kind) {
    if (!file) return;
    if (!activeConversationId) { showToast('Open a chat first.'); return; }
    if (file.size > 15 * 1024 * 1024) { showToast('Choose a file smaller than 15 MB.'); return; }
    closeAllModals();
    const uploadingTo = activeConversationId;
    const uploadVersion = ++attachmentVersion;
    attachmentUpload?.abort();const controller=attachmentUpload=new AbortController();
    uploadingAttachment = true; updateSendButtonState();
    const formData = new FormData();
    formData.append("file", file);

    const banner = document.getElementById("attachment-preview-bar");
    banner.classList.remove("hidden");
    banner.classList.add("flex");
    document.getElementById("attachment-name-preview").textContent = `Uploading ${file.name}...`;

    try {
        const data = window.uploadFile ? await window.uploadFile(file,{signal:controller.signal,onProgress:percent=>{
            if(uploadVersion===attachmentVersion)document.getElementById('attachment-name-preview').textContent=percent<100?`Uploading ${file.name} · ${percent}%`:'Finishing upload…';
        }}) : await (async()=>{const res = await fetch("/api/upload", {
            method: "POST",
            headers: { RequestVerificationToken: document.querySelector('input[name="__RequestVerificationToken"]')?.value || '' },
            body: formData
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Upload failed");
        }
        return await res.json();})();
        if (uploadVersion !== attachmentVersion || uploadingTo !== activeConversationId) return;
        pendingAttachment = {
            url: data.url,
            name: data.name,
            size: data.size,
            type: file.type,
            kind
        };
        document.getElementById("attachment-name-preview").textContent = `${data.name} (${formatBytes(data.size)})`;
        updateSendButtonState();
    } catch (err) {
        if(err.name==='AbortError')return;
        showToast('Upload failed: ' + err.message);
        if (uploadVersion === attachmentVersion) clearPendingAttachment();
    } finally {
        if(attachmentUpload===controller){attachmentUpload=null;uploadingAttachment=false;updateSendButtonState();}
    }
}

function clearPendingAttachment() {
    attachmentUpload?.abort();attachmentUpload=null;uploadingAttachment=false;
    ++attachmentVersion;
    pendingAttachment = null;
    const banner = document.getElementById("attachment-preview-bar");
    if (banner) {
        banner.classList.add("hidden");
        banner.classList.remove("flex");
    }
    updateSendButtonState();
}

// Emoji Picker
function toggleEmojiPicker() {
    const picker = document.getElementById("emoji-picker-container");
    if (picker.classList.contains('hidden') && typeof mountEmojiPicker === 'function') mountEmojiPicker(picker);
    picker.classList.toggle("hidden");
    if (!picker.classList.contains("hidden")) closeAttachMenu();
}

function insertEmoji(emoji) {
    const input = document.getElementById("composer-input");
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const next = input.value.slice(0, start) + emoji + input.value.slice(end);
    if (next.length > input.maxLength) return;
    input.value = next;
    const caret = start + emoji.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

// Reactions
async function toggleReaction(messageId, emoji) {
    if (!connection) return;
    try {
        await connection.invoke("SendReaction", messageId, emoji);
    } catch (e) {
        console.error("Reaction failed:", e);
    }
    closeAllModals();
}

// Shared selection for message-actions.js.
let activeMenuMsgId = null;

// Lightbox for image previews
function openLightbox(imageUrl) {
    const modal = document.getElementById("lightbox-modal");
    document.getElementById("lightbox-image").src = imageUrl;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function closeLightbox() {
    const modal = document.getElementById("lightbox-modal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

// In-Chat Message Search
function toggleChatSearch() {
    const searchBar = document.getElementById("in-chat-search-bar");
    searchBar.classList.toggle("hidden");
    if (!searchBar.classList.contains("hidden")) {
        document.getElementById("in-chat-search-input").focus();
    }
}

async function performChatSearch() {
    const q = document.getElementById("in-chat-search-input").value.trim();
    if (!q || !activeConversationId) return;
    const conversationId = activeConversationId;
    const version = ++messageSearchVersion;

    try {
        const res = await fetch(`?handler=SearchMessages&conversationId=${activeConversationId}&query=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error('Couldn’t search messages.');
        const results = await res.json();
        if (activeConversationId !== conversationId || version !== messageSearchVersion) return;
        const resultsContainer = document.getElementById("in-chat-search-results");
        resultsContainer.innerHTML = "";
        
        if (results.length === 0) {
            resultsContainer.innerHTML = `<div class="search-hit">No messages found.</div>`;
            return;
        }

        results.forEach(m => {
            const div = document.createElement("div");
            div.className = "search-hit";
            div.onclick = () => {
                scrollToMessage(m.id);
                toggleChatSearch();
            };
            div.innerHTML = `
                <div class="search-hit-meta">
                    <span>${escapeHtml(m.senderName)}</span>
                    <span>${formatMessageTime(m.createdAt)}</span>
                </div>
                <div>${typeof formatEmoji === "function" ? formatEmoji(messagePreviewText(m.content)) : escapeHtml(messagePreviewText(m.content))}</div>
            `;
            resultsContainer.appendChild(div);
        });
    } catch (e) {}
}

// New Chat Modal & Contact Search
function openNewChatModal() {
    groupMode = false; selectedGroupMembers.clear(); updateGroupControls();
    setAddContactOpen(false);
    openDialog('new-chat-modal');
    searchNewChatContacts('');
}

async function searchNewChatContacts(query) {
    const version = ++contactSearchVersion;
    try {
        const res = await fetch(`/Chat?handler=SearchContacts&query=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Search failed');
        const contacts = await res.json();
        if (version !== contactSearchVersion) return;
        const container = document.getElementById("new-chat-contacts-list");
        container.innerHTML = "";

        if (contacts.length === 0) {
            container.innerHTML = `<div class="empty-list">${query.trim() ? 'No matching contacts.' : 'No chats yet. Use Add contact with their exact username.'}</div>`;
            return;
        }

        contacts.forEach(user => {
            const div = document.createElement("div");
            div.className = "contact-row";
            div.tabIndex = 0; div.setAttribute('role', 'button');
            div.classList.toggle('is-selected', selectedGroupMembers.has(user.id));
            div.onclick = () => {
                if (!groupMode) { startDirectChat(user.id); return; }
                if (selectedGroupMembers.has(user.id)) selectedGroupMembers.delete(user.id); else selectedGroupMembers.add(user.id);
                div.classList.toggle('is-selected', selectedGroupMembers.has(user.id));
                div.setAttribute('aria-pressed', String(selectedGroupMembers.has(user.id))); updateGroupControls();
            };
            div.innerHTML = `
                <div class="conv-avatar-wrap">
                    <img src="${escapeHtml(user.avatarUrl)}" alt="" />
                    <span class="online-dot ${user.isOnline ? "" : "hidden"}"></span>
                </div>
                <div class="conv-body">
                    <div class="conv-title">${escapeHtml(user.displayName)}</div>
                    <div class="contact-about">${escapeHtml(user.about || "@" + user.username)}</div>
                </div>
            `;
            container.appendChild(div);
        });
        if (typeof window.refreshIcons === "function") window.refreshIcons(container);
    } catch (e) { showToast('Couldn’t search contacts. Try again.'); }
}

async function startDirectChat(targetUserId) {
    try {
        const formData = new FormData();
        formData.append("targetUserId", targetUserId);

        const res = await fetch("?handler=StartDirectChat", {
            method: "POST",
            body: formData,
            headers: {
                "RequestVerificationToken": document.querySelector('input[name="__RequestVerificationToken"]')?.value || ""
            }
        });
        if (!res.ok) throw new Error('Couldn’t start this chat.');
        const conv = await res.json();
        closeAllModals();
        await refreshConversationList();
        selectConversation(conv.id);
    } catch (e) {
        showToast(e.message);
    }
}

// Theme Switching
function toggleTheme() {
    const root = document.documentElement;
    const isLight = root.classList.contains("theme-light");
    root.classList.remove("theme-light", "theme-dark");
    const btn = document.getElementById("theme-toggle-btn");
    if (isLight) {
        root.classList.add("theme-dark");
        try { localStorage.setItem("wa_theme", "dark"); } catch (_) {}
        if (btn) btn.innerHTML = '<i data-lucide="moon"></i>';
    } else {
        root.classList.add("theme-light");
        try { localStorage.setItem("wa_theme", "light"); } catch (_) {}
        if (btn) btn.innerHTML = '<i data-lucide="sun"></i>';
    }
    syncThemeSwitches();
    if (typeof window.refreshIcons === "function") window.refreshIcons(btn || document);
}

function syncThemeSwitches() { document.querySelectorAll('.theme-switch').forEach(button => button.setAttribute('aria-checked', String(document.documentElement.classList.contains('theme-dark')))); }
function syncThemeIcon() {
    syncThemeSwitches();
    const btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;
    const isLight = document.documentElement.classList.contains("theme-light");
    btn.innerHTML = isLight ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
    if (typeof window.refreshIcons === "function") window.refreshIcons(btn);
}

// Mobile Responsive Navigation
function switchMobileView(view) {
    const frame = document.getElementById("app-frame");
    if (!frame) return;
    if (window.innerWidth >= 900) {
        frame.classList.remove("is-chat");
        return;
    }
    const wasChat = frame.classList.contains('is-chat');
    frame.classList.toggle("is-chat", view === "chat");
    if (wasChat !== (view === 'chat'))
        window.animateScreenSwap?.(view === 'chat' ? document.querySelector('.thread') : document.getElementById('sidebar-column'), view !== 'chat');
    history.replaceState(null, '', view === 'chat' && activeConversationId ? `/Chat?conv=${activeConversationId}` : '/Chat');
}

let convFilter = "all";

function setConvFilter(filter, btn) {
    convFilter = filter;
    document.querySelectorAll(".filter-chip").forEach(el => { el.classList.toggle("is-on", el === btn); el.setAttribute('aria-pressed', String(el === btn)); });
    applyConvFilters();
}

function applyConvFilters() {
    const query = (document.getElementById('search-conversations-input')?.value || '').toLowerCase().trim();
    let count = 0;
    const items = document.querySelectorAll('.conv-item');
    items.forEach(item => {
        const title = item.querySelector('.conv-title')?.textContent.toLowerCase() || '';
        const last = item.querySelector('.conv-last-msg')?.textContent.toLowerCase() || '';
        const matches = (!query || title.includes(query) || last.includes(query)) &&
            (convFilter === 'all' || convFilter === 'groups' && item.dataset.isGroup === 'true' || convFilter === 'unread' && Number(item.dataset.unread) > 0 || convFilter === 'favourites' && favouriteConversations.has(Number(item.dataset.id)));
        item.classList.toggle('hidden', !matches); if (matches) count++;
    });
    document.getElementById('filter-empty')?.classList.toggle('hidden', count > 0 || items.length === 0);
    const unreadCount = [...items].filter(item => Number(item.dataset.unread) > 0).length;
    const groupCount = [...items].filter(item => item.dataset.isGroup === 'true').length;
    const unreadLabel = document.getElementById('unread-filter-count');
    const groupLabel = document.getElementById('group-filter-count');
    if (unreadLabel) unreadLabel.textContent = unreadCount ? ` ${unreadCount}` : '';
    if (groupLabel) groupLabel.textContent = groupCount ? ` ${groupCount}` : '';
}

function showChatFilter(filter) {
    if (typeof closeFeature === 'function') closeFeature();
    const button = document.querySelector(`.filter-chip[data-filter="${filter}"]`);
    setConvFilter(filter, button);
    switchMobileView('sidebar');
}

function loadFavourites() {
    try {
        const saved = JSON.parse(localStorage.getItem(`wa_favourites_${currentUserId}`) || '[]');
        favouriteConversations = new Set(Array.isArray(saved) ? saved.filter(id => Number.isSafeInteger(id) && id > 0) : []);
    } catch { favouriteConversations = new Set(); }
}

function toggleConversationFavourite() {
    if (!activeConversationId) return;
    if (favouriteConversations.has(activeConversationId)) favouriteConversations.delete(activeConversationId);
    else favouriteConversations.add(activeConversationId);
    try { localStorage.setItem(`wa_favourites_${currentUserId}`, JSON.stringify([...favouriteConversations])); }
    catch { showToast('Favourites will be remembered for this session.'); }
    updateFavouriteButton(); applyConvFilters();
}

function updateFavouriteButton() {
    const button = document.getElementById('favourite-chat-btn');
    if (!button) return;
    const favourite = favouriteConversations.has(activeConversationId);
    button.setAttribute('aria-pressed', String(favourite));
    button.setAttribute('aria-label', favourite ? 'Remove from favourites' : 'Add to favourites');
    button.title = favourite ? 'Remove from favourites' : 'Add to favourites';
}

function openNewGroupModal() {
    openNewChatModal(); groupMode = true; selectedGroupMembers.clear(); updateGroupControls();
}

function scrollToBottom() {
    if (window.followLatestMessages) { window.followLatestMessages(); return; }
    const container = document.getElementById('messages-container');
    if (container) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

async function scrollToMessage(msgId) {
    window.pauseMessageFollowing?.();
    while (!document.getElementById(`msg-${msgId}`) && hasOlderMessages && !loadingOlder) {
        const previous = loadedMessages.size;
        await loadOlderMessages();
        if (loadedMessages.size === previous) break;
    }
    const element = document.getElementById(`msg-${msgId}`);
    if (!element) { showToast('This message couldn’t be found in the chat.'); return; }
    element.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    element.classList.add('msg-flash'); setTimeout(() => element.classList.remove('msg-flash'), 1500);
}

function closeAllModals() {
    document.getElementById('chat-actions-menu')?.classList.add('hidden');
    if (typeof stopQrScan === "function") stopQrScan();
    stopAttachCamera();
    document.querySelectorAll(".modal-layer").forEach(m => {
        m.classList.add("hidden");
        m.classList.remove("flex");
    });
    const menu = document.getElementById("msg-context-menu");
    if (menu) menu.classList.add("hidden");
    dialogOpener?.focus();
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeAttribute(str) {
    if (!str) return "";
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function safeAttachmentUrl(url) {
    return /^\/uploads\/[a-f0-9]{32}\.[a-z0-9]+$/i.test(url || '') ? url : '';
}

function setConnectionStatus(message) {
    const status = document.getElementById('connection-status');
    if (status) { status.textContent = message; status.classList.toggle('hidden', !message); }
    updateSendButtonState();
}

async function invokeQuietly(method, ...args) {
    if (connection?.state !== signalR.HubConnectionState.Connected) return;
    try { await connection.invoke(method, ...args); } catch (_) { /* Reconnect restores state. */ }
}

async function startConnection() {
    if (connection?.state !== signalR.HubConnectionState.Disconnected) return;
    setConnectionStatus(navigator.onLine ? 'Connecting…' : 'You’re offline. Your draft is safe.');
    try {
        await connection.start(); setConnectionStatus(''); await recoverChat(); if (typeof restorePendingCall === 'function') await restorePendingCall();
    } catch (_) { setConnectionStatus('Unable to connect. Retrying…'); scheduleConnection(); }
}

function scheduleConnection() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(startConnection, 5000);
}

async function recoverChat() {
    try {
        await refreshConversationList();
        if (activeConversationId) await selectConversation(activeConversationId, false, true);
        window.syncMessageDeliveries?.();
    } catch (_) { showToast('Connected, but chats couldn’t refresh. Please reload.'); }
}

function isReadingChat() {
    return activeConversationId && document.visibilityState === 'visible' && document.hasFocus() &&
        (window.innerWidth >= 900 || document.getElementById('app-frame')?.classList.contains('is-chat'));
}

async function markVisibleChatRead() {
    if (!isReadingChat() || connection?.state !== signalR.HubConnectionState.Connected || document.querySelector('.thread-loading')) return;
    const id = activeConversationId;
    if (readingConversation === id) return;
    readingConversation = id;
    try {
        await connection.invoke('MarkMessagesAsRead', id);
        const item = document.querySelector(`.conv-item[data-id="${id}"]`);
        if (item) {
            item.dataset.unread = '0'; item.classList.remove('has-unread');
            item.querySelector('.unread-badge')?.classList.add('hidden'); applyConvFilters();
        }
    } catch (_) { /* Read receipts are retried when focus or connectivity returns. */ }
    finally { readingConversation = null; }
}

function saveDraft() {
    if (!activeConversationId) return;
    const value = document.getElementById('composer-input')?.value;
    if (value) drafts.set(activeConversationId, value); else drafts.delete(activeConversationId);
    if (pendingAttachment || pendingReply) draftExtras.set(activeConversationId, { attachment: pendingAttachment, reply: pendingReply });
    else draftExtras.delete(activeConversationId);
}

function restoreDraftExtras(conversationId) {
    const saved = draftExtras.get(conversationId);
    if (saved?.reply) setReplyTo(saved.reply.id, saved.reply.senderName, saved.reply.content);
    if (saved?.attachment) {
        pendingAttachment = saved.attachment;
        const banner = document.getElementById('attachment-preview-bar');
        banner?.classList.remove('hidden'); banner?.classList.add('flex');
        const label = document.getElementById('attachment-name-preview');
        if (label) label.textContent = `${pendingAttachment.name} (${formatBytes(pendingAttachment.size)})`;
    }
}

function closeConversation() {
    if (!activeConversationId) return;
    window.stopVoiceForNavigation?.();
    window.closeMessageInfo?.(false);
    saveDraft();
    if (isTyping) invokeQuietly('SendTyping', activeConversationId, false);
    isTyping = false; clearTimeout(typingTimeout);
    messagesRequest?.abort(); messagesRequest = null;
    messageSearchVersion++;
    activeConversationId = null;
    loadedMessages.clear(); hasOlderMessages = false;
    cancelReply(); clearPendingAttachment();
    const input = document.getElementById('composer-input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
    document.getElementById('messages-container')?.replaceChildren();
    document.getElementById('typing-bubble-container')?.classList.add('hidden');
    document.getElementById('in-chat-search-bar')?.classList.add('hidden');
    document.getElementById('active-chat-container')?.classList.add('hidden');
    document.getElementById('empty-chat-state')?.classList.remove('hidden');
    if (window.innerWidth >= 900) window.animateScreenSwap?.(document.getElementById('empty-chat-state'), true);
    document.querySelectorAll('.conv-item.is-active').forEach(item => item.classList.remove('is-active'));
    switchMobileView('sidebar');
    history.replaceState(null, '', '/Chat');
    document.getElementById('search-conversations-input')?.focus({preventScroll: true});
    updateSendButtonState();
}

function handleEscape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    if (document.querySelector('.modal-layer:not(.hidden)')?.getAttribute?.('aria-busy') === 'true') { event.preventDefault(); return; }
    if (document.querySelector('.modal-layer:not(.hidden), #msg-context-menu:not(.hidden), #chat-actions-menu:not(.hidden)')) {
        event.preventDefault(); closeAllModals(); return;
    }
    if (window.isMessageInfoOpen?.()) { event.preventDefault(); window.closeMessageInfo(); return; }
    if (window.stopVoiceOnEscape?.()) { event.preventDefault(); return; }
    const picker = document.getElementById('emoji-picker-container');
    if (picker && !picker.classList.contains('hidden')) {
        event.preventDefault(); picker.classList.add('hidden'); document.getElementById('composer-input')?.focus(); return;
    }
    const attachMenu = document.getElementById('attach-menu');
    if (attachMenu && !attachMenu.classList.contains('hidden')) {
        event.preventDefault(); closeAttachMenu(); document.getElementById('composer-input')?.focus(); return;
    }
    const search = document.getElementById('in-chat-search-bar');
    if (search && !search.classList.contains('hidden')) {
        event.preventDefault(); search.classList.add('hidden'); messageSearchVersion++; document.getElementById('composer-input')?.focus(); return;
    }
    if (activeConversationId) { event.preventDefault(); closeConversation(); }
}

async function loadOlderMessages() {
    if (!hasOlderMessages || loadingOlder || !loadedMessages.size) return;
    window.pauseMessageFollowing?.();
    loadingOlder = true;
    const id = activeConversationId;
    const container = document.getElementById('messages-container');
    const previousHeight = container.scrollHeight;
    const previousTop = container.scrollTop;
    const button = container.querySelector('.load-older');
    if (button) { button.disabled = true; button.textContent = 'Loading…'; }
    try {
        const earliest = Math.min(...loadedMessages.keys());
        const response = await fetch(`/Chat?handler=Messages&conversationId=${id}&beforeMessageId=${earliest}`);
        if (!response.ok) throw new Error('Unable to load earlier messages.');
        const messages = await response.json();
        if (activeConversationId !== id) return;
        hasOlderMessages = messages.length === 50;
        messages.forEach(message => { if (!window.isMessageHidden?.(message.id)) loadedMessages.set(message.id, message); });
        renderMessages([...loadedMessages.values()].sort((a,b) => a.id - b.id), false);
        container.scrollTop = previousTop + container.scrollHeight - previousHeight;
    } catch (_) { showToast('Couldn’t load earlier messages. Try again.'); }
    finally {
        loadingOlder = false;
        if (button) { button.disabled = false; button.textContent = 'Load earlier messages'; }
    }
}

function openDialog(id) {
    dialogOpener = document.activeElement;
    const modal = document.getElementById(id);
    modal.classList.remove('hidden'); modal.classList.add('flex');
    requestAnimationFrame(() => modal.querySelector('input:not([type=hidden]), button, a')?.focus());
}

function setupReliabilityListeners() {
    document.addEventListener('visibilitychange', markVisibleChatRead);
    window.addEventListener('focus', markVisibleChatRead);
    window.addEventListener('online', () => { clearTimeout(reconnectTimer); startConnection(); });
    window.addEventListener('offline', () => setConnectionStatus('You’re offline. Your draft is safe.'));
    document.getElementById('composer-input')?.addEventListener('input', saveDraft);
    document.getElementById('group-title')?.addEventListener('input', updateGroupControls);
    document.addEventListener('keydown', event => {
        const modal = document.querySelector('.modal-layer:not(.hidden)');
        if (event.key === 'Tab' && modal) {
            const items = [...modal.querySelectorAll('button:not(:disabled), input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(el => !el.closest('.hidden'));
            const first = items[0], last = items[items.length-1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.conv-item, .contact-row')) { event.preventDefault(); event.target.click(); }
    });
    document.querySelectorAll('.filter-chip').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('is-on'))));
}

window.canApplyAppUpdate = () => {saveDraft();return !sendingMessage && !uploadingAttachment && !pendingAttachment && !pendingReply &&
    ![...drafts.values()].some(text=>text.trim()) && !draftExtras.size && !document.getElementById('composer-input')?.value.trim() &&
    !window.hasUnsentVoiceMessages?.() && !(typeof currentCall !== 'undefined' && currentCall) && !window.isMessageInfoOpen?.();};

function debouncedContactSearch(query) {
    clearTimeout(contactSearchTimer);
    contactSearchTimer = setTimeout(() => searchNewChatContacts(query), 200);
}

function toggleGroupMode() {
    groupMode = !groupMode; selectedGroupMembers.clear(); updateGroupControls();
    if (groupMode) setAddContactOpen(false);
    searchNewChatContacts(document.querySelector('#new-chat-modal input[type=search]')?.value || '');
}

function setAddContactOpen(open) {
    document.getElementById('add-contact-fields')?.classList.toggle('hidden', !open);
    const label = document.getElementById('add-contact-label');
    if (label) label.textContent = open ? 'Hide add contact' : 'Add contact';
    if (open) {
        const input = document.getElementById('add-contact-username');
        if (input) { input.value = ''; setTimeout(() => input.focus(), 0); }
    }
}

function toggleAddContact() {
    const fields = document.getElementById('add-contact-fields');
    const opening = fields?.classList.contains('hidden');
    if (opening) { groupMode = false; selectedGroupMembers.clear(); updateGroupControls(); }
    setAddContactOpen(!!opening);
}

async function addContactByUsername() {
    const input = document.getElementById('add-contact-username');
    const button = document.getElementById('add-contact-btn');
    const raw = (input?.value || '').trim();
    if (!raw) { showToast('Enter their exact username.'); input?.focus(); return; }
    if (button) button.disabled = true;
    try {
        const response = await fetch('/Chat?handler=ContactByCode&username=' + encodeURIComponent(raw));
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No one uses that username.');
        if (groupMode) {
            selectedGroupMembers.add(data.id);
            updateGroupControls();
            setAddContactOpen(false);
            searchNewChatContacts(document.querySelector('#new-chat-modal input[type=search]')?.value || '');
            showToast(`Added ${data.displayName} to the group.`);
            return;
        }
        await startDirectChat(data.id);
    } catch (error) {
        showToast(error.message || 'Couldn’t add that contact.');
    } finally {
        if (button) button.disabled = false;
    }
}

function updateGroupControls() {
    document.getElementById('group-fields')?.classList.toggle('hidden', !groupMode);
    document.getElementById('group-mode-label').textContent = groupMode ? 'Back to direct chat' : 'New group';
    const button = document.getElementById('create-group-btn');
    button.disabled = !selectedGroupMembers.size || !document.getElementById('group-title').value.trim();
    button.textContent = selectedGroupMembers.size ? `Create group (${selectedGroupMembers.size})` : 'Select contacts below';
}

async function createGroup() {
    const button = document.getElementById('create-group-btn'); button.disabled = true;
    try {
        const response = await fetch('/Chat?handler=CreateGroup', { method: 'POST',
            headers: { 'Content-Type': 'application/json', RequestVerificationToken: document.querySelector('input[name="__RequestVerificationToken"]').value },
            body: JSON.stringify({title:document.getElementById('group-title').value.trim(), memberIds:[...selectedGroupMembers]}) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Couldn’t create the group.'); }
        const conversation = await response.json(); closeAllModals(); await refreshConversationList(); await selectConversation(conversation.id);
    } catch (error) { showToast(error.message); }
    finally { updateGroupControls(); }
}

let attachCameraStream;
let shareSending = false;
let shareContactTimer;

function requireChat() {
    if (activeConversationId) return true;
    showToast('Open a chat first.');
    return false;
}

function closeAttachMenu() {
    document.getElementById('attach-menu')?.classList.add('hidden');
    document.getElementById('attach-toggle')?.setAttribute('aria-expanded', 'false');
}

function toggleAttachMenu() {
    const menu = document.getElementById('attach-menu');
    if (!menu) return;
    const willOpen = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    document.getElementById('attach-toggle')?.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) document.getElementById('emoji-picker-container')?.classList.add('hidden');
}

function pickAttachment(kind) {
    if (!requireChat()) return;
    closeAttachMenu();
    const input = document.getElementById('attachment-file-input');
    input.accept = {
        document: '.pdf,.doc,.docx,.txt,.zip,.xlsx,.csv',
        media: 'image/*,.mp4,video/mp4',
        audio: '.mp3,audio/mpeg',
        sticker: 'image/png,image/webp,image/gif,image/jpeg'
    }[kind] || '';
    input.dataset.kind = kind;
    input.value = '';
    input.click();
}

function stopAttachCamera() {
    attachCameraStream?.getTracks().forEach(track => track.stop());
    attachCameraStream = null;
    const video = document.getElementById('attach-camera-video');
    if (video) video.srcObject = null;
}

async function openAttachCamera() {
    if (!requireChat()) return;
    closeAttachMenu();
    openDialog('camera-modal');
    stopAttachCamera();
    const video = document.getElementById('attach-camera-video');
    if (!navigator.mediaDevices?.getUserMedia) { showToast('Camera isn’t available. Choose a photo instead.'); return; }
    try {
        try { attachCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
        catch { attachCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
        video.srcObject = attachCameraStream;
        await video.play();
    } catch { showToast('Camera isn’t available. Choose a photo instead.'); }
}

function captureAttachPhoto() {
    const video = document.getElementById('attach-camera-video');
    if (!video?.videoWidth) { showToast('Camera isn’t ready yet.'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
        if (!blob) { showToast('Couldn’t take the photo.'); return; }
        uploadAttachment(new File([blob], 'photo.jpg', { type: 'image/jpeg' }), 'media');
    }, 'image/jpeg', 0.92);
}

async function sendShareCard(card) {
    if (shareSending || !requireChat()) return;
    if (connection?.state !== signalR.HubConnectionState.Connected) { showToast('Waiting for a connection.'); return; }
    shareSending = true;
    try {
        await connection.invoke('SendMessage', activeConversationId, JSON.stringify(card), 'Text', null, null, null, null);
        closeAllModals();
    } catch { showToast('Couldn’t send that.'); }
    finally { shareSending = false; }
}

function openShareContact() {
    if (!requireChat()) return;
    closeAttachMenu();
    openDialog('share-contact-modal');
    loadShareContacts('');
}

function queueShareContacts(value) {
    clearTimeout(shareContactTimer);
    shareContactTimer = setTimeout(() => loadShareContacts(value), 200);
}

async function loadShareContacts(query) {
    const list = document.getElementById('share-contact-list');
    if (!list) return;
    try {
        const res = await fetch(`/Chat?handler=SearchContacts&query=${encodeURIComponent(query || '')}`);
        if (!res.ok) throw new Error('Search failed');
        const activeItem = document.querySelector(`.conv-item[data-id="${activeConversationId}"]`);
        const recipientId = activeItem?.dataset.isGroup === 'true' ? 0 : parseInt(activeItem?.dataset.otherUserId, 10);
        const contacts = (await res.json()).filter(user => user.id !== recipientId);
        list.innerHTML = '';
        if (!contacts.length) { list.innerHTML = '<div class="empty-list">No contacts to share yet.</div>'; return; }
        contacts.forEach(user => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'contact-row';
            row.innerHTML = `<img src="${safeAvatar(user.avatarUrl)}" alt="" /><div class="conv-body"><div class="conv-title">${escapeHtml(user.username ? '@' + user.username : user.displayName)}</div></div>`;
            row.onclick = () => sendShareCard({ wa: 'contact', id: user.id, name: user.displayName, username: user.username, avatar: safeAvatar(user.avatarUrl) });
            list.appendChild(row);
        });
    } catch { showToast('Couldn’t load contacts.'); }
}

function openPollComposer() {
    if (!requireChat()) return;
    closeAttachMenu();
    const box = document.getElementById('poll-options');
    box.innerHTML = '';
    addPollOption();
    addPollOption();
    document.getElementById('poll-question').value = '';
    openDialog('poll-modal');
}

function addPollOption() {
    const box = document.getElementById('poll-options');
    if (!box || box.children.length >= 12) return;
    const input = document.createElement('input');
    input.maxLength = 100;
    input.placeholder = `Option ${box.children.length + 1}`;
    input.setAttribute('aria-label', input.placeholder);
    box.appendChild(input);
}

function submitPoll(event) {
    event.preventDefault();
    const question = document.getElementById('poll-question').value.trim();
    const options = [...document.querySelectorAll('#poll-options input')].map(input => input.value.trim()).filter(Boolean);
    if (!question || options.length < 2) { showToast('Add a question and at least two options.'); return; }
    sendShareCard({ wa: 'poll', question, options });
}

function openEventComposer() {
    if (!requireChat()) return;
    closeAttachMenu();
    document.getElementById('event-title').value = '';
    document.getElementById('event-when').value = '';
    document.getElementById('event-where').value = '';
    document.getElementById('event-detail').value = '';
    openDialog('event-modal');
}

function submitEvent(event) {
    event.preventDefault();
    const title = document.getElementById('event-title').value.trim();
    const when = document.getElementById('event-when').value;
    if (!title || !when) { showToast('Add a title and a time.'); return; }
    sendShareCard({
        wa: 'event',
        title,
        when,
        where: document.getElementById('event-where').value.trim(),
        detail: document.getElementById('event-detail').value.trim()
    });
}

function attachList(name) {
    try {
        const id = document.getElementById('chat-config')?.dataset.userId || 'local';
        const saved = JSON.parse(localStorage.getItem(`wa_${name}_${id}`) || '[]');
        return Array.isArray(saved) ? saved : [];
    } catch { return []; }
}

function saveAttachList(name, items) {
    const id = document.getElementById('chat-config')?.dataset.userId || 'local';
    localStorage.setItem(`wa_${name}_${id}`, JSON.stringify(items.slice(0, 40)));
}

function openCatalogue() {
    if (!requireChat()) return;
    closeAttachMenu();
    renderCatalogue();
    openDialog('catalogue-modal');
}

function renderCatalogue() {
    const list = document.getElementById('catalogue-list');
    const items = attachList('catalogue');
    list.innerHTML = items.length ? '' : '<div class="empty-list">No catalogue items yet.</div>';
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'contact-row';
        row.innerHTML = `<div class="conv-body"><div class="conv-title">${escapeHtml(item.name)}</div><div class="contact-about">${escapeHtml(item.price || item.detail || '')}</div></div><div class="share-row-actions"><button type="button" class="btn btn-ghost">Send</button><button type="button" class="icon-btn" aria-label="Remove item"><i data-lucide="trash-2"></i></button></div>`;
        row.querySelector('.btn').onclick = () => sendShareCard({ wa: 'catalogue', name: item.name, price: item.price || '', detail: item.detail || '' });
        row.querySelector('.icon-btn').onclick = () => { saveAttachList('catalogue', attachList('catalogue').filter(saved => saved.id !== item.id)); renderCatalogue(); };
        list.appendChild(row);
    });
    window.refreshIcons?.(list);
}

function saveCatalogueItem(event) {
    event.preventDefault();
    const name = document.getElementById('catalogue-name').value.trim();
    if (!name) return;
    const items = attachList('catalogue');
    items.unshift({ id: Date.now(), name, price: document.getElementById('catalogue-price').value.trim(), detail: document.getElementById('catalogue-detail').value.trim() });
    saveAttachList('catalogue', items);
    event.target.reset();
    renderCatalogue();
}

function openQuickReplies() {
    if (!requireChat()) return;
    closeAttachMenu();
    renderQuickReplies();
    openDialog('replies-modal');
}

function renderQuickReplies() {
    const list = document.getElementById('replies-list');
    const items = attachList('replies');
    list.innerHTML = items.length ? '' : '<div class="empty-list">No quick replies yet.</div>';
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'contact-row';
        row.innerHTML = `<button type="button" class="conv-body reply-use"><div class="conv-title">${escapeHtml(item.text)}</div></button><button type="button" class="icon-btn" aria-label="Remove reply"><i data-lucide="trash-2"></i></button>`;
        row.querySelector('.reply-use').onclick = () => { closeAllModals(); insertComposerText(item.text); };
        row.querySelector('.icon-btn').onclick = () => { saveAttachList('replies', attachList('replies').filter(saved => saved.id !== item.id)); renderQuickReplies(); };
        list.appendChild(row);
    });
    window.refreshIcons?.(list);
}

function saveQuickReply(event) {
    event.preventDefault();
    const text = document.getElementById('reply-text').value.trim();
    if (!text) return;
    const items = attachList('replies');
    items.unshift({ id: Date.now(), text });
    saveAttachList('replies', items);
    event.target.reset();
    renderQuickReplies();
}

function insertComposerText(text) {
    const input = document.getElementById('composer-input');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const next = input.value.slice(0, start) + text + input.value.slice(end);
    if (next.length > input.maxLength) { showToast('That reply is too long for this message.'); return; }
    input.value = next;
    const caret = start + text.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}



