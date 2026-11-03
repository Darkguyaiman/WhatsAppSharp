import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function harness(senderId = 2) {
    const events = {}, documentEvents = {}, nodes = new Map(), requests = [], replies = [];
    const timers = new Map(); let timerId = 0;
    function element() {
        const classes = new Set(), attrs = new Map();
        return {textContent:'', disabled:false, focus(){}, remove(){}, style:{setProperty(){}},
            classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),
                toggle(c,on){if(arguments.length<2)on=!classes.has(c);if(on)classes.add(c);else classes.delete(c);}},
            setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k),removeAttribute:k=>attrs.delete(k),
            querySelector:()=>null,querySelectorAll:()=>[],appendChild(){},addEventListener:(name,fn)=>events[name]=fn};
    }
    const message = {id:11,conversationId:3,senderId,senderName:'Sarah',type:0,content:'Hello',createdAt:new Date().toISOString(),canDeleteForEveryone:senderId===1};
    const row=element(); row.id='msg-11';
    const error=element(), modal=element(), buttons=[element(),element(),element()];
    modal.querySelector=()=>error;modal.querySelectorAll=()=>buttons;
    nodes.set('message-delete-modal',modal); nodes.set('messages-container',element());
    const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
    const context=vm.createContext({console,Date,Map,Set,Number,String,Boolean,requestAnimationFrame:fn=>fn(),
        setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
        document:{getElementById:node,addEventListener:(name,fn)=>documentEvents[name]=fn,createElement:element},
        loadedMessages:new Map([[11,message]]),currentUserId:1,activeConversationId:3,activeMenuMsgId:11,
        pendingReply:null,signalR:{HubConnectionState:{Connected:'Connected'}},
        connection:{state:'Connected',invoke:async(...args)=>requests.push(args)},
        closeAllModals:()=>modal.classList.add('hidden'),openDialog:()=>modal.classList.remove('hidden'),
        setReplyTo:(...args)=>replies.push(args),messagePreviewText:value=>value,showToast(){},
        renderMessages(){},cancelReply(){},
    });
    context.window=context;
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/message-actions.js',import.meta.url),'utf8'),context);
    documentEvents.DOMContentLoaded();
    const pointer=(x,y,control=false,type='touch')=>({clientX:x,clientY:y,pointerType:type,
        target:{closest:selector=>selector==='.msg'?row:control?{}:null},
        preventDefault(){this.prevented=true;}});
    // Pin refresh is unrelated to gesture/deletion tests.
    context.refreshMessagePins=()=>{};
    return {context,events,pointer,requests,replies,nodes,node,message,modal,error,buttons,timers};
}

for(const senderId of [1,2]) test(`Swipe replies to ${senderId===1?'own':'received'} messages`,()=>{
    const h=harness(senderId);
    h.events.pointerdown(h.pointer(20,100));
    const movement=h.pointer(105,103);h.events.pointermove(movement);h.events.pointerup();
    assert.equal(movement.prevented,true);
    assert.deepEqual(h.replies,[[11,senderId===1?'You':'Sarah','Hello']]);
    assert.equal(h.timers.size,0);
});

test('Scrolling, short swipes, cancelled gestures, and media controls do not reply',()=>{
    const h=harness();
    for(const [x,y,cancel] of [[25,150,false],[55,101,false],[105,101,true]]) {
        h.events.pointerdown(h.pointer(20,100));h.events.pointermove(h.pointer(x,y));
        h.events[cancel?'pointercancel':'pointerup']();
    }
    h.events.pointerdown(h.pointer(20,100,true));h.events.pointermove(h.pointer(120,100,true));h.events.pointerup();
    h.events.pointerdown(h.pointer(20,100,false,'mouse'));h.events.pointermove(h.pointer(120,100));h.events.pointerup();
    assert.equal(h.replies.length,0);assert.equal(h.timers.size,0);
});

test('Delete modal offers the right scope and cancellation sends no request',async()=>{
    for(const senderId of [1,2]) {
        const h=harness(senderId);await h.context.messageAction('delete');
        assert.equal(h.modal.classList.contains('hidden'),false);
        assert.equal(h.node('message-delete-everyone').classList.contains('hidden'),senderId!==1);
        h.context.closeAllModals();assert.equal(h.requests.length,0);
    }
});

test('Private deletion hides only this account’s copy; shared deletion uses its separate action',async()=>{
    const own=harness(1);await own.context.messageAction('delete');await own.context.confirmMessageDelete(true);
    assert.deepEqual(own.requests,[['DeleteMessage',11]]);
    const received=harness();await received.context.messageAction('delete');await received.context.confirmMessageDelete(true);
    assert.equal(received.requests.length,0);
    await received.context.confirmMessageDelete(false);
    assert.deepEqual(received.requests,[['DeleteMessageForMe',11]]);
    assert.equal(received.context.isMessageHidden(11),true);
});

test('A failed delete stays open, shows the error, and can be retried',async()=>{
    const h=harness();await h.context.messageAction('delete');
    h.context.connection.invoke=async()=>{throw new Error('Connection lost');};
    await h.context.confirmMessageDelete(false);
    assert.equal(h.modal.classList.contains('hidden'),false);
    assert.equal(h.error.textContent,'Connection lost');assert.equal(h.context.isMessageHidden(11),false);
    assert.ok(h.buttons.every(button=>!button.disabled));
});

test('Personal notes start empty and keep the original message as separate context',async()=>{
    const h=harness();await h.context.messageAction('note');
    assert.equal(h.node('message-note-text').value,'');
    assert.equal(h.node('message-note-preview').textContent,'Hello');
    assert.equal(h.node('message-note-sender').textContent,'Sarah');
    assert.equal(h.node('message-note-count').textContent,'0 / 5,000');
    h.message.note='Existing private note';await h.context.messageAction('note');
    assert.equal(h.node('message-note-text').value,'Existing private note');
});

test('The edit editor shows the original and disables empty or unchanged submissions',async()=>{
    const h=harness(1);await h.context.messageAction('edit');
    assert.equal(h.node('message-edit-original').textContent,'Hello');assert.equal(h.node('message-edit-text').value,'Hello');
    assert.equal(h.node('message-edit-save').disabled,true);await h.context.saveMessageEdit();assert.equal(h.requests.length,0);
    h.node('message-edit-text').value=' ';h.context.updateMessageEditState();assert.equal(h.node('message-edit-save').disabled,true);
    h.node('message-edit-text').value='Updated message';h.context.updateMessageEditState();assert.equal(h.node('message-edit-save').disabled,false);
    await h.context.saveMessageEdit();assert.deepEqual(h.requests,[['EditMessage',11,'Updated message']]);
});

test('Edit availability expires from the original send time, regardless of a recent edit',()=>{
    const h=harness(1);h.message.createdAt=new Date(Date.now()-14*60000).toISOString();assert.equal(h.context.canEditMessage(h.message),true);
    h.message.createdAt=new Date(Date.now()-16*60000).toISOString();h.message.updatedAt=new Date().toISOString();
    assert.equal(h.context.canEditMessage(h.message),false);
    h.message.createdAt='invalid';assert.equal(h.context.canEditMessage(h.message),false);
});

test('React shows quick choices and only the plus action mounts the full picker',async()=>{
    const h=harness();let mounts=0;
    const menu=h.node('msg-context-menu'), anchor={getBoundingClientRect:()=>({right:300,bottom:100,top:60})};
    menu.getBoundingClientRect=()=>({width:286,height:45});menu.querySelector=()=>({focus(){}});
    menu.style={};h.node('msg-11').querySelector=()=>anchor;
    h.context.innerWidth=1000;h.context.innerHeight=700;
    h.context.mountEmojiPicker=()=>mounts++;
    await h.context.messageAction('react');
    assert.equal(menu.classList.contains('reaction-only'),true);assert.equal(mounts,0);
    await h.context.messageAction('more-reactions');assert.equal(mounts,1);
});

test('Message menus use the space toward the composer and never cover the input',()=>{
    const h=harness(), menu=h.node('msg-context-menu'), quick=h.node('quick');
    menu.style={};menu.getBoundingClientRect=()=>({width:252,height:Math.min(440,parseFloat(menu.style.maxHeight)||440)});
    menu.querySelector=selector=>selector==='.ctx-react'?quick:{focus(){}};
    h.node('menu-pin-btn').querySelector=()=>({});h.node('menu-star-btn').querySelector=()=>({});
    h.node('messages-container').getBoundingClientRect=()=>({top:60,bottom:700});
    h.context.document.querySelector=()=>({getBoundingClientRect:()=>({top:700})});
    h.context.innerWidth=1280;h.context.innerHeight=800;
    const open=top=>h.context.openMessageMenu({stopPropagation(){},currentTarget:{getBoundingClientRect:()=>({right:900,top,bottom:top+24})}},11);
    open(620);
    assert.equal(parseFloat(menu.style.top)+440,692,'Menu fills the space down to the composer margin');
    assert.ok(parseFloat(menu.style.top)>620-440,'It does not jump entirely above the message');
    open(90);assert.equal(parseFloat(menu.style.top),119,'A high message uses the available space below it');
});
