import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const noop = () => {};
function clientContext() {
    const input = {value: 'Keep this draft', style: {}, focus: noop};
    const button = {};
    const context = vm.createContext({ console, setTimeout, clearTimeout, requestAnimationFrame: noop,
        window: {addEventListener: noop}, navigator: {onLine:true}, signalR: {HubConnectionState: {Connected:'Connected'}},
        document: { addEventListener: noop, getElementById: id => id === 'composer-input' ? input : id === 'send-btn' ? button : null,
            querySelector: () => null, hasFocus: () => true, createElement: () => ({children:[], appendChild(child) { this.children.push(child); }, querySelector: () => null}) },
        showToast: noop
    });
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/chat.js', import.meta.url), 'utf8'), context);
    return {context, input, button};
}

test('A failed send retains text, attachment, and reply', async () => {
    const {context,input} = clientContext();
    vm.runInContext(`activeConversationId=1; pendingAttachment={url:'/uploads/${'a'.repeat(32)}.png', name:'photo.png',size:10,type:'image/png'}; pendingReply={id:2}; connection={state:'Connected',invoke: async method => {if(method==='SendMessage') throw new Error('Offline');}};`, context);
    await vm.runInContext('sendMessage()', context);
    assert.equal(input.value, 'Keep this draft');
    assert.equal(vm.runInContext('pendingAttachment.name', context), 'photo.png');
    assert.equal(vm.runInContext('pendingReply.id', context), 2);
    assert.equal(input.readOnly, false);
});

test('An offline send keeps the draft and makes no request', async () => {
    const {context,input} = clientContext();
    vm.runInContext("activeConversationId=1; connection={state:'Disconnected',invoke:()=>{throw new Error('Unexpected call');}};",context);
    await vm.runInContext('sendMessage()',context);
    assert.equal(input.value,'Keep this draft');
});

test('Quoted message text is escaped and never injected into action handlers', () => {
    const {context} = clientContext();
    vm.runInContext('currentUserId=1;',context);
    const element = vm.runInContext(`createMessageElement({id:1,conversationId:1,senderId:1,content:"';alert(1);// <script>bad</script>",createdAt:'2026-10-01T00:00:00Z',reactions:[]})`,context);
    assert.ok(element.children[0].innerHTML.includes('&lt;script&gt;'));
    assert.ok(!element.children[0].innerHTML.includes('onclick="openMessageMenu'));
    assert.ok(!element.children[0].innerHTML.includes('<script>'));
});

test('Attachment links accept only app-owned upload paths', () => {
    const {context} = clientContext();
    assert.equal(vm.runInContext("safeAttachmentUrl('javascript:alert(1)')",context),'');
    assert.equal(vm.runInContext("safeAttachmentUrl('https://other.example/image.png')",context),'');
    const path='/uploads/'+ 'a'.repeat(32)+'.png';
    assert.equal(vm.runInContext(`safeAttachmentUrl('${path}')`,context),path);
});

test('Internal message cards parse independently of whitespace and JSON property order',()=>{
    const {context}=clientContext();
    for(const content of ['{ "duration": 2, "wa": "voice", "waveform": [0.2] }','{\n"name":"A person","wa":"contact"}']) {
        context.cardContent=content;const result=vm.runInContext('messagePreviewText(cardContent)',context);
        assert.ok(!result.includes('{'));assert.ok(result==='Voice message'||result==='Contact: A person');
    }
    assert.equal(vm.runInContext('messagePreviewText(\'{"normal":"user JSON"}\')',context),'{"normal":"user JSON"}');
});

test('Sent messages and incoming messages in a focused app never chime', async () => {
    const {context} = clientContext(); let played=0;
    context.countSound = ()=>played++;
    context.document.visibilityState='visible';context.document.hasFocus=()=>true;
    vm.runInContext("audioCtx={state:'running',destination:{},createBufferSource:()=>({connect(){},start:countSound}),createGain:()=>({gain:{},connect(){}})};audioBuffers.set('message',{});",context);
    await vm.runInContext('playNotificationSound(true,false,1)',context);
    await vm.runInContext('playNotificationSound(false,false,2)',context);
    assert.equal(played,0);
    context.document.visibilityState='hidden';context.document.hasFocus=()=>false;
    await vm.runInContext('playNotificationSound(true,false,3)',context);
    assert.equal(played,0);
    await vm.runInContext('playNotificationSound(false,false,4)',context);
    assert.equal(played,1);
    context.document.visibilityState='visible';
    await vm.runInContext('playNotificationSound(false,false,5)',context);
    assert.equal(played,2,'A visible window behind another application can alert');
    context.window.hasEnabledPushNotifications=()=>true;
    await vm.runInContext('playNotificationSound(false,false,6)',context);
    assert.equal(played,2,'System push owns the alert when enabled');
    context.window.hasEnabledPushNotifications=()=>false;
    context.window.isAppInForeground=async()=>true;
    await vm.runInContext('playNotificationSound(false,false,7)',context);
    assert.equal(played,2,'Another focused app window suppresses this background tab');
});

test('Explicit sound preview still works while the app is focused', async () => {
    const {context}=clientContext();let played=0;
    context.countSound=()=>played++;
    context.document.visibilityState='visible';context.document.hasFocus=()=>true;
    vm.runInContext("audioCtx={state:'running',destination:{},createBufferSource:()=>({connect(){},start:countSound}),createGain:()=>({gain:{},connect(){}})};audioBuffers.set('message',{});",context);
    await vm.runInContext('playNotificationSound(false,true)',context);
    assert.equal(played,1);
});

function navigationContext() {
    const {context, input, button} = clientContext();
    const nodes = new Map();
    function element(hidden = false) {
        const classes = new Set(hidden ? ['hidden'] : []);
        return {style:{}, value:'', dataset:{id:'3'}, focus:noop, replaceChildren:noop,
            classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c),
                toggle(c, on = !classes.has(c)) { if(on) classes.add(c); else classes.delete(c); }}};
    }
    for (const id of ['active-chat-container','empty-chat-state','messages-container','app-frame','search-conversations-input',
        'reply-preview-bar','reply-preview-sender','reply-preview-content','attachment-preview-bar','attachment-name-preview',
        'typing-bubble-container','in-chat-search-bar','emoji-picker-container','msg-context-menu']) nodes.set(id, element());
    for (const id of ['empty-chat-state','reply-preview-bar','attachment-preview-bar','typing-bubble-container',
        'in-chat-search-bar','emoji-picker-container','msg-context-menu']) nodes.get(id).classList.add('hidden');
    const row = element(); row.classList.add('is-active');
    const modal = element(true);
    context.document.getElementById = id => id === 'composer-input' ? input : id === 'send-btn' ? button : nodes.get(id) || null;
    context.document.querySelectorAll = selector => selector === '.modal-layer' ? [modal] : selector.startsWith('.conv-item') ? [row] : [];
    context.document.querySelector = selector => selector.startsWith('.modal-layer') && !modal.classList.contains('hidden') ? modal : null;
    context.window.innerWidth = 1280;
    context.AbortController = AbortController;
    const urls = []; context.history = {replaceState:(_,__,url)=>urls.push(url)};
    context.fetch = async () => ({ok:true,json:async()=>[]});
    vm.runInContext('activeConversationId=3; markVisibleChatRead=()=>{}; renderMessages=()=>{};', context);
    return {context,input,nodes,modal,row,urls};
}

function escapeEvent(overrides = {}) { return {key:'Escape',preventDefault(){this.defaultPrevented=true;},...overrides}; }

test('Screen transitions restart on rapid navigation without delaying the view update', () => {
    const window = {};
    const context = vm.createContext({window});
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/navigation.js', import.meta.url), 'utf8'), context);
    const panel = {dataset:{}};
    window.animateScreenSwap(panel);
    assert.equal(panel.dataset.screenSwap, 'a');
    assert.equal(panel.dataset.swapDirection, 'forward');
    window.animateScreenSwap(panel, true);
    assert.equal(panel.dataset.screenSwap, 'b');
    assert.equal(panel.dataset.swapDirection, 'back');
    window.animateScreenSwap(panel);
    assert.equal(panel.dataset.screenSwap, 'a');
    assert.doesNotThrow(()=>window.animateScreenSwap(null));
});

test('Hidden emoji pickers create no catalogue controls during page startup', () => {
    const listeners = [];
    let created = 0;
    const picker = {dataset:{}, classList:{contains:()=>true}};
    const context = vm.createContext({window:{WA_EMOJI:[{id:'people',label:'People',items:[['😀','grinning face']]}]},
        document:{addEventListener:(_,handler)=>listeners.push(handler),
            querySelectorAll:selector=>selector === '[data-emoji-picker]' ? [picker] : [],
            getElementById:()=>null, querySelector:()=>null,
            createElement:()=>{created++; throw new Error('Hidden picker should remain empty');}}, console});
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/emoji.js', import.meta.url), 'utf8'), context);
    listeners.forEach(handler=>handler());
    assert.equal(created, 0);
    assert.equal(picker.dataset.ready, undefined);
});

test('Opening the emoji picker initializes it, while closing it does not rebuild it', () => {
    const {context,nodes} = navigationContext();
    const mounted = [];
    context.mountEmojiPicker = picker=>mounted.push(picker);
    context.closeAttachMenu = noop;
    vm.runInContext('toggleEmojiPicker()', context);
    assert.equal(nodes.get('emoji-picker-container').classList.contains('hidden'), false);
    assert.equal(mounted.length, 1);
    vm.runInContext('toggleEmojiPicker()', context);
    assert.equal(nodes.get('emoji-picker-container').classList.contains('hidden'), true);
    assert.equal(mounted.length, 1);
});

test('Escape restores the empty view and reopening restores text, reply, and attachment drafts', async () => {
    const {context,input,nodes,row,urls} = navigationContext();
    vm.runInContext(`pendingAttachment={url:'/uploads/${'a'.repeat(32)}.png',name:'photo.png',size:10,type:'image/png'}; pendingReply={id:2,senderName:'Sarah',content:'Reply text'};`, context);
    context.escape = escapeEvent(); vm.runInContext('handleEscape(escape)', context);
    assert.equal(vm.runInContext('activeConversationId',context),null);
    assert.equal(nodes.get('empty-chat-state').classList.contains('hidden'),false);
    assert.equal(nodes.get('active-chat-container').classList.contains('hidden'),true);
    assert.equal(row.classList.contains('is-active'),false);
    assert.equal(urls.at(-1),'/Chat');
    await vm.runInContext('selectConversation(3)',context);
    assert.equal(input.value,'Keep this draft');
    assert.equal(vm.runInContext('pendingReply.content',context),'Reply text');
    assert.equal(vm.runInContext('pendingAttachment.name',context),'photo.png');
    assert.equal(nodes.get('attachment-preview-bar').classList.contains('hidden'),false);
});

test('Escape dismisses the dialog first and does not close a chat while composing text', () => {
    const {context,modal,nodes} = navigationContext();
    modal.classList.remove('hidden'); context.escape = escapeEvent();
    vm.runInContext('handleEscape(escape)',context);
    assert.equal(modal.classList.contains('hidden'),true);
    assert.equal(vm.runInContext('activeConversationId',context),3);
    assert.equal(nodes.get('active-chat-container').classList.contains('hidden'),false);
    context.escape = escapeEvent({isComposing:true}); vm.runInContext('handleEscape(escape)',context);
    assert.equal(vm.runInContext('activeConversationId',context),3);
    context.escape = escapeEvent(); vm.runInContext('handleEscape(escape)',context);
    assert.equal(vm.runInContext('activeConversationId',context),null);
});

test('A late message response cannot reopen a chat closed by Escape', async () => {
    const {context,nodes} = navigationContext();
    let resolveResponse, renders = 0;
    context.fetch = () => new Promise(resolve=>resolveResponse=resolve);
    context.renderMessages = () => renders++;
    const pending = vm.runInContext('selectConversation(4)',context);
    context.escape = escapeEvent(); vm.runInContext('handleEscape(escape)',context);
    resolveResponse({ok:true,json:async()=>[{id:99,conversationId:4}]}); await pending;
    assert.equal(renders,0);
    assert.equal(vm.runInContext('activeConversationId',context),null);
    assert.equal(nodes.get('empty-chat-state').classList.contains('hidden'),false);
});

test('Escape closes message info before closing the conversation',()=>{
    const {context}=navigationContext();let closed=0;
    context.window.isMessageInfoOpen=()=>true;context.window.closeMessageInfo=()=>closed++;
    context.escape=escapeEvent();vm.runInContext('handleEscape(escape)',context);
    assert.equal(closed,1);assert.equal(vm.runInContext('activeConversationId',context),3);
});

function workerContext(windows=[]) {
    const handlers={}, requests=[], notifications=[], cached=[];
    const context=vm.createContext({URL, console,
        self:{location:{origin:'https://chat.example'},skipWaiting:async()=>{},addEventListener:(type,handler)=>handlers[type]=handler,
            clients:{matchAll:async()=>windows,claim:async()=>{}},registration:{showNotification:async(title,options)=>notifications.push({title,options})}},
        caches:{open:async()=>({addAll:async urls=>cached.push(...urls),put:async()=>{}}),match:async()=>({offline:true})},
        fetch:async request=>{requests.push(request);throw new Error('Offline');}
    });
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/sw.js', import.meta.url),'utf8'),context);
    return {handlers,requests,notifications,cached};
}

test('The offline cache excludes conversations, authentication, APIs, and uploads', async()=>{
    const worker=workerContext(); let promise;
    worker.handlers.install({waitUntil:p=>promise=p}); await promise;
    assert.ok(worker.cached.includes('/offline.html'));
    assert.ok(worker.cached.every(path=>!/^\/(Chat|Account|api|uploads)/.test(path)));
    let intercepted=false;
    worker.handlers.fetch({request:{method:'GET',url:'https://chat.example/Chat?handler=Messages',mode:'cors'},respondWith:()=>intercepted=true});
    assert.equal(intercepted,false);
});

test('Offline navigation falls back to the public offline page', async()=>{
    const worker=workerContext(); let response;
    worker.handlers.fetch({request:{method:'GET',url:'https://chat.example/Chat',mode:'navigate'},respondWith:p=>response=p});
    assert.equal((await response).offline,true);
});

test('Push displays a notification when all app windows are closed', async()=>{
    const worker=workerContext(); let promise;
    worker.handlers.push({data:{json:()=>({title:'Alex',body:'Hello',conversationId:3,url:'/Chat?conv=3'})},waitUntil:p=>promise=p});
    await promise;
    assert.equal(worker.notifications.length,1);
    assert.equal(worker.notifications[0].options.data.url,'/Chat?conv=3');
    assert.equal(worker.notifications[0].options.silent,false);
});

for (const url of ['https://chat.example/Chat?conv=99','https://chat.example/Account/Settings'])
    test(`Push is silent while looking at ${new URL(url).pathname}, regardless of the incoming chat`,async()=>{
        const worker=workerContext([{focused:true,visibilityState:'visible',url}]);let promise;
        worker.handlers.push({data:{json:()=>({conversationId:3})},waitUntil:p=>promise=p});await promise;
        assert.equal(worker.notifications[0].options.silent,true);
    });

test('Push alerts when the app is open in the background',async()=>{
    const worker=workerContext([{focused:false,visibilityState:'hidden',url:'https://chat.example/Chat?conv=3'}]);let promise;
    worker.handlers.push({data:{json:()=>({conversationId:3})},waitUntil:p=>promise=p});await promise;
    assert.equal(worker.notifications[0].options.silent,false);
});

test('A received push acknowledges delivery after showing its notification',async()=>{
    const worker=workerContext();let promise;
    worker.handlers.push({data:{json:()=>({conversationId:3,deliveryToken:'signed-test-token'})},waitUntil:p=>promise=p});await promise;
    assert.equal(worker.notifications.length,1);assert.equal(worker.requests[0],'/api/delivery');
});

test('Focused conversations still display a visible push without a second sound', async()=>{
    const worker=workerContext([{focused:true,url:'https://chat.example/Chat?conv=3'}]); let promise;
    worker.handlers.push({data:{json:()=>({title:'Alex',conversationId:3})},waitUntil:p=>promise=p}); await promise;
    assert.equal(worker.notifications.length,1);
    assert.equal(worker.notifications[0].options.silent,true);
    worker.handlers.push({data:{json:()=>({title:'Alex',conversationId:4})},waitUntil:p=>promise=p}); await promise;
    assert.equal(worker.notifications.length,2);
    assert.equal(worker.notifications[1].options.silent,true);
});
