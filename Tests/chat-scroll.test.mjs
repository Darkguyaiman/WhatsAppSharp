import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

test('Chats stay at the bottom through late reflow, while scrolling up preserves the reading position',()=>{
    const events={},frames=[];let ready,resize;
    const box={scrollTop:0,scrollHeight:1000,clientHeight:300,children:[{}],style:{},addEventListener:(name,fn)=>events[name]=fn};
    class Observer{constructor(fn){resize=fn;}observe(){}disconnect(){}}
    const context=vm.createContext({ResizeObserver:Observer,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
        document:{getElementById:()=>box,addEventListener:(_,fn)=>ready=fn},window:{addEventListener(){}}});
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/chat-scroll.js',import.meta.url),'utf8'),context);
    const paint=()=>{const batch=frames.splice(0);batch.forEach(fn=>fn());};
    ready();context.window.followLatestMessages();paint();assert.equal(box.scrollTop,1000);
    box.scrollHeight=1400;resize();paint();assert.equal(box.scrollTop,1400);
    events.wheel({deltaY:-100});box.scrollTop=300;box.scrollHeight=1600;resize();paint();assert.equal(box.scrollTop,300);
    box.scrollTop=1300;events.scroll();box.scrollHeight=1800;resize();paint();assert.equal(box.scrollTop,1800);
    context.window.pauseMessageFollowing();box.scrollTop=100;events.load();paint();assert.equal(box.scrollTop,100);
});
