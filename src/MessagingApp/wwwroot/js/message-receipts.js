// Delivery means the recipient's app acknowledged the message, independently of reads.
(() => {
    const pending = new Set(), states = new Map();
    let hub = null, timer = null, flushing = null, syncing = false;
    const rank = {sent:0,delivered:1,read:2};
    const doublePath = 'M11.07 0.93L4.85 7.15L2.93 5.23L1.52 6.64L4.85 9.97L12.48 2.34L11.07 0.93ZM15.07 0.93L8.85 7.15L8.41 6.71L7 8.12L8.85 9.97L16.48 2.34L15.07 0.93Z';
    window.applyKnownMessageReceipt = message => {
        const known = states.get(message.id);
        if (known && rank[known] > (rank[message.readStatus] || 0)) message.readStatus = known;
        return message;
    };
    window.renderMessageTicks = message => {
        if (message.senderId !== currentUserId || message.isDeleted) return '';
        window.applyKnownMessageReceipt(message);
        const status = message.readStatus || 'sent', doubled = status !== 'sent';
        return `<svg data-message-ticks role="img" aria-label="${status === 'read' ? 'Read' : doubled ? 'Delivered' : 'Sent'}" class="${status === 'read' ? 'tick-read' : ''}" viewBox="0 0 ${doubled ? 16 : 12} 11" fill="currentColor"><path d="${doubled ? doublePath : 'M10.48 0.93L4.26 7.15L2.34 5.23L0.93 6.64L4.26 9.97L11.89 2.34L10.48 0.93Z'}"/></svg>`;
    };
    window.updateMessageReceiptStatus = (ids, status) => {
        for (const id of ids || []) {
            if ((rank[states.get(id)] || 0) < rank[status]) states.set(id,status);
            const message = loadedMessages.get(id); if (!message) continue;
            if ((rank[message.readStatus] || 0) < rank[status]) message.readStatus = status;
            window.applyKnownMessageReceipt(message);
            const tick = document.getElementById(`msg-${id}`)?.querySelector('[data-message-ticks]');
            if (tick) tick.outerHTML = window.renderMessageTicks(message);
        }
    };
    function schedule(delay = 40) {
        if (timer || !pending.size || hub?.state !== signalR.HubConnectionState.Connected) return;
        timer = setTimeout(()=>{timer=null;flush();},delay);
    }
    function flush() {
        if (flushing) return flushing;
        if (!pending.size || hub?.state !== signalR.HubConnectionState.Connected) return Promise.resolve(false);
        const ids = [...pending].slice(0,100);
        flushing = (async()=>{
            try { await hub.invoke('MarkMessagesDelivered',ids);ids.forEach(id=>pending.delete(id));return true; }
            catch (_) { return false; }
        })().then(success=>{flushing=null;schedule(success?0:5000);return success;});
        return flushing;
    }
    window.noteMessageDelivery = message => {
        if (message.senderId !== currentUserId && !message.isDeleted && !window.isMessageHidden?.(message.id)) {
            pending.add(message.id); schedule();
        }
    };
    window.setupMessageReceipts = connection => {
        hub = connection;
        hub.on('MessagesDelivered',data=>window.updateMessageReceiptStatus(data.messageIds,'delivered'));
    };
    window.syncMessageDeliveries = async () => {
        if (syncing || hub?.state !== signalR.HubConnectionState.Connected) return;
        syncing=true;
        try {
            await flush();
            for (let page=0;page<5;page++) {
                const rows=await hub.invoke('GetUndeliveredMessages');
                if (!rows.length) return;
                rows.forEach(window.noteMessageDelivery);
                if (!await flush()) return;
            }
            setTimeout(window.syncMessageDeliveries,10000);
        } catch (_) { setTimeout(window.syncMessageDeliveries,10000); }
        finally { syncing=false;schedule(); }
    };
})();
