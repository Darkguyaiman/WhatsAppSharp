import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function inspector(width=1280) {
    const nodes=new Map(), pending=[], events={};let focused=0;
    function element() {
        const classes=new Set(),attributes=new Map();
        return {innerHTML:'',children:[],inert:false,isConnected:true,
            classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},
            setAttribute:(k,v)=>attributes.set(k,v),getAttribute:k=>attributes.get(k),removeAttribute:k=>attributes.delete(k),
            focus:()=>focused++,replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},
            get firstElementChild(){return this.children[0];},querySelector:()=>null,querySelectorAll:()=>[]};
    }
    const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
    const context=vm.createContext({console,innerWidth:width,document:{getElementById:node,querySelector:()=>null,
        activeElement:element(),addEventListener:(name,fn)=>events[name]=fn},
        closeAllModals(){},createMessageElement:element,escapeHtml:s=>String(s??'').replaceAll('<','&lt;'),
        connection:{state:'Connected',invoke:()=>new Promise(resolve=>pending.push(resolve))},
        signalR:{HubConnectionState:{Connected:'Connected'}},addEventListener:(name,fn)=>events[name]=fn});
    context.window=context;
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/message-info.js',import.meta.url),'utf8'),context);
    return {context,node,pending,events,focused:()=>focused};
}
const info = (name='Sarah')=>({senderName:name,createdAt:'2026-11-02T08:00:00Z',readStatus:'read',readBy:[{name:'Sarah',readAt:'2026-11-02T08:01:00Z'}]});

test('Message info is a desktop region and a modal phone screen with its own close action',async()=>{
    for(const width of [1280,390]) {
        const h=inspector(width);const open=h.context.openMessageInfo({id:1});
        assert.equal(h.node('message-info-panel').getAttribute('role'),width<900?'dialog':'region');
        assert.equal(h.node('active-chat-container').inert,width<900);
        assert.equal(h.node('app-frame').classList.contains('has-message-info'),true);
        h.pending.shift()(info());await open;
        assert.ok(h.node('message-info-content').innerHTML.includes('Read'));
        h.context.closeMessageInfo();assert.equal(h.context.isMessageInfoOpen(),false);
        assert.equal(h.node('active-chat-container').inert,false);
        assert.equal(h.node('message-info-panel').inert,true);
    }
});

test('Late message-info responses cannot overwrite a different message or reopen a closed panel',async()=>{
    const h=inspector();const first=h.context.openMessageInfo({id:1});const second=h.context.openMessageInfo({id:2});
    h.pending[1](info('New sender'));await second;
    h.pending[0](info('Old sender'));await first;
    assert.ok(h.node('message-info-content').innerHTML.includes('New sender'));
    assert.ok(!h.node('message-info-content').innerHTML.includes('Old sender'));
    const third=h.context.refreshOpenMessageInfo();h.context.closeMessageInfo();h.pending[2](info());await third;
    assert.equal(h.context.isMessageInfoOpen(),false);
});

test('Resizing an open inspector updates mobile focus protection',async()=>{
    const h=inspector();const open=h.context.openMessageInfo({id:1});h.pending[0](info());await open;
    h.context.innerWidth=390;h.events.resize();assert.equal(h.node('active-chat-container').inert,true);
    h.context.innerWidth=1280;h.events.resize();assert.equal(h.node('active-chat-container').inert,false);
});

test('Receipt updates retain a voice preview, and closing info pauses its media',async()=>{
    const h=inspector();let paused=0;const player={pause:()=>paused++};
    const preview=h.node('message-info-preview');
    preview.querySelectorAll=()=>preview.children.length?[player]:[];
    h.node('message-info-panel').querySelectorAll=()=>[player];
    const open=h.context.openMessageInfo({id:1,type:3,content:'voice metadata'});h.pending[0](info());await open;
    const original=preview.firstElementChild;
    const refresh=h.context.refreshOpenMessageInfo();h.pending[1](info());await refresh;
    assert.equal(preview.firstElementChild,original);assert.equal(paused,0);
    h.context.closeMessageInfo();assert.equal(paused,1);
});
