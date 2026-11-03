import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function client() {
    const handlers={},timers=[],calls=[],ticks={outerHTML:''}, badge={outerHTML:'star'};
    const context=vm.createContext({console,currentUserId:1,loadedMessages:new Map(),
        setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},
        signalR:{HubConnectionState:{Connected:'Connected'}},
        document:{getElementById:()=>({querySelector:selector=>selector==='[data-message-ticks]'?ticks:badge})}});
    context.window=context;
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/message-receipts.js',import.meta.url),'utf8'),context);
    const hub={state:'Connected',on:(name,fn)=>handlers[name]=fn,invoke:async(...args)=>{calls.push(args);return args[0]==='GetUndeliveredMessages'?[]:undefined;}};
    context.setupMessageReceipts(hub);
    return {context,hub,handlers,timers,calls,ticks,badge};
}

test('A live recipient acknowledgement upgrades only the tick icon and never downgrades a read',()=>{
    const h=client();const message={id:7,senderId:1,readStatus:'sent'};h.context.loadedMessages.set(7,message);
    h.handlers.MessagesDelivered({messageIds:[7]});assert.equal(message.readStatus,'delivered');assert.match(h.ticks.outerHTML,/aria-label="Delivered"/);
    h.context.updateMessageReceiptStatus([7],'read');h.handlers.MessagesDelivered({messageIds:[7]});
    assert.equal(message.readStatus,'read');assert.match(h.ticks.outerHTML,/tick-read/);assert.equal(h.badge.outerHTML,'star');
    const late={id:7,senderId:1,readStatus:'sent'};h.context.applyKnownMessageReceipt(late);assert.equal(late.readStatus,'read');
});

test('Background delivery acknowledgements deduplicate IDs, exclude own messages, and never mark read',async()=>{
    const h=client();h.context.noteMessageDelivery({id:5,senderId:2});h.context.noteMessageDelivery({id:5,senderId:2});h.context.noteMessageDelivery({id:6,senderId:1});
    await h.context.syncMessageDeliveries();
    const ack=h.calls.find(call=>call[0]==='MarkMessagesDelivered');assert.deepEqual([...ack[1]],[5]);
    assert.ok(!h.calls.some(call=>call[0]==='MarkMessagesAsRead'));
});

test('Failed delivery acknowledgement is retained for reconnection',async()=>{
    const h=client();let fail=true;
    h.hub.invoke=async(method,ids)=>{h.calls.push([method,ids]);if(method==='MarkMessagesDelivered'&&fail)throw Error('offline');return method==='GetUndeliveredMessages'?[]:undefined;};
    h.context.noteMessageDelivery({id:8,senderId:2});await h.context.syncMessageDeliveries();fail=false;await h.context.syncMessageDeliveries();
    assert.equal(h.calls.filter(call=>call[0]==='MarkMessagesDelivered'&&call[1].includes(8)).length,2);
});
