import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function appWindows() {
    const peers=[];let sequence=0;
    class Channel {
        constructor(){this.listeners=[];peers.push(this);}
        addEventListener(_,handler){this.listeners.push(handler);}
        postMessage(data){for(const peer of peers)if(peer!==this)queueMicrotask(()=>peer.listeners.forEach(handler=>handler({data})));}
    }
    return (focused=false)=>{
        const context=vm.createContext({setTimeout,clearTimeout,BroadcastChannel:Channel,
            crypto:{randomUUID:()=>String(++sequence)},window:{addEventListener(){}},
            document:{visibilityState:focused?'visible':'hidden',hasFocus:()=>focused,addEventListener(){}}});
        vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/pwa.js',import.meta.url),'utf8'),context);
        return context.window;
    };
}

test('A background chat detects another focused app window before sounding',async()=>{
    const make=appWindows(), background=make(false), settings=make(true);
    assert.equal(await background.isAppInForeground(),true);
    assert.equal(await settings.isAppInForeground(),true);
});

test('Background-only windows allow an alert after the attention check',async()=>{
    const make=appWindows(), first=make(false);make(false);
    assert.equal(await first.isAppInForeground(),false);
});
