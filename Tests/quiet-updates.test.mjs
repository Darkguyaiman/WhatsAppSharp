import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

async function page(controlled=true) {
    const timers=new Map(),events={},messages=[];let ready,reloads=0,next=0;
    const registration={waiting:{postMessage:data=>messages.push(data)},addEventListener(){}};
    const document={getElementById:()=>null,addEventListener:(_,fn)=>ready=fn,querySelectorAll:()=>[],querySelector:()=>null};
    const window={isSecureContext:true,addEventListener(){},location:{reload:()=>reloads++}};
    const context=vm.createContext({window,document,setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),
        navigator:{serviceWorker:{controller:controlled?{}:null,addEventListener:(name,fn)=>events[name]=fn,register:async()=>registration,ready:Promise.resolve(registration)}}});
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/pwa.js',import.meta.url),'utf8'),context);
    await ready();
    return {window,document,events,messages,get reloads(){return reloads;},tick(){const entries=[...timers];timers.clear();entries.forEach(([,fn])=>fn());}};
}

test('Waiting app updates activate and reload quietly when safe',async()=>{
    const h=await page();assert.equal(h.messages[0].type,'SKIP_WAITING');h.events.controllerchange();h.tick();assert.equal(h.reloads,1);
    h.events.controllerchange();h.tick();assert.equal(h.reloads,1);
});
test('Quiet updates defer for unsent work and resume when it is clear',async()=>{
    const h=await page();let busy=true;h.window.canApplyAppUpdate=()=>!busy;
    h.events.controllerchange();h.tick();assert.equal(h.reloads,0);busy=false;h.tick();assert.equal(h.reloads,1);
});
test('First installation does not reload the page',async()=>{
    const h=await page(false);h.events.controllerchange();h.tick();assert.equal(h.reloads,0);
});
