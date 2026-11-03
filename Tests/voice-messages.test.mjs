import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function voiceContext() {
    const nodes = new Map(), messages = [], sent = [], uploads = [], urls = new Set();
    const timers = new Map(); let nextTimer = 1, stopped = 0, requested = 0, now = 0;
    function element(id) {
        const classes = new Set(['voice-recorder','voice-preview-play'].includes(id) ? ['hidden'] : []);
        return {dataset:{},value:'',disabled:false,textContent:'',innerHTML:'',attributes:{},style:{},
            classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on=!classes.has(c)){on?classes.add(c):classes.delete(c);}},
            setAttribute(k,v){this.attributes[k]=v;},focus(){},querySelector:()=>get('voice-discard')};
    }
    function get(id) { if(!nodes.has(id)) nodes.set(id,element(id)); return nodes.get(id); }
    class Recorder extends EventTarget {
        static isTypeSupported(type) { return type==='audio/webm;codecs=opus'; }
        constructor(stream,options) { super(); this.state='inactive';this.mimeType=options.mimeType; }
        start(){this.state='recording';}
        stop(){this.state='inactive';queueMicrotask(()=>{const event=new Event('dataavailable');event.data=new Blob(['synthetic audio'],{type:this.mimeType});this.dispatchEvent(event);this.dispatchEvent(new Event('stop'));});}
    }
    class Audio extends EventTarget {
        constructor(url){super();this.src=url;this.paused=true;this.ended=false;this.currentTime=0;}
        async play(){this.paused=false;this.dispatchEvent(new Event('play'));}
        pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
    }
    const context=vm.createContext({console,Blob,FormData,Float32Array,Event,Audio,MediaRecorder:Recorder,
        activeConversationId:1,pendingReply:null,pendingAttachment:null,currentCall:null,sendingMessage:false,uploadingAttachment:false,
        isSecureContext:true,signalR:{HubConnectionState:{Connected:'Connected'}},
        connection:{state:'Connected',invoke:async(...args)=>sent.push(args)},
        navigator:{mediaDevices:{getUserMedia:async()=>{requested++;return{getTracks:()=>[{stop(){stopped++;}}]};}}},
        document:{addEventListener(){},getElementById:get,querySelector:()=>({value:'csrf-token'})},
        addEventListener(){},performance:{now:()=>now},setInterval:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),
        URL:{createObjectURL:()=>{const url='blob:fixture-'+urls.size;urls.add(url);return url;},revokeObjectURL:url=>urls.delete(url)},
        fetch:async(url,options)=>{uploads.push({url,options});return{ok:true,redirected:false,json:async()=>({url:'/uploads/'+ 'a'.repeat(32)+'.webm',name:'Voice message.webm',size:15})};},
        showToast:text=>messages.push(text),closeAttachMenu(){},cancelReply(){context.pendingReply=null;},
        safeAttachmentUrl:url=>/^\/uploads\/[a-f0-9]{32}\.[a-z0-9]+$/.test(url||'')?url:'',
        escapeHtml:text=>String(text).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
    vm.runInContext('window=globalThis;',context);
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/voice-messages.js',import.meta.url),'utf8'),context);
    return{context,nodes,get,messages,sent,uploads,urls,advance(ms){now+=ms;for(const timer of timers.values())timer();},get stopped(){return stopped;},get requested(){return requested;}};
}

test('A voice note records, previews, uploads with CSRF protection, and sends audio metadata',async()=>{
    const t=voiceContext(); await t.context.startVoiceRecording();
    assert.equal(t.get('voice-recorder').classList.contains('hidden'),false);
    t.advance(1600);await t.context.stopVoiceRecording();
    assert.ok(t.stopped>0);
    assert.equal(t.get('voice-preview-play').classList.contains('hidden'),false);
    await t.context.previewVoiceRecording();await t.context.previewVoiceRecording();await t.context.previewVoiceRecording();
    assert.equal(t.get('voice-preview-play').attributes['aria-label'],'Pause recording');
    await t.context.sendVoiceRecording();
    assert.equal(t.uploads.length,1);assert.equal(t.uploads[0].options.headers.RequestVerificationToken,'csrf-token');
    assert.equal(t.sent[0][0],'SendMessage');assert.equal(t.sent[0][1],1);assert.equal(t.sent[0][3],'Voice');
    const data=JSON.parse(t.sent[0][2]);assert.equal(data.wa,'voice');assert.equal(data.duration,1.6);assert.equal(data.waveform.length,48);
    assert.equal(t.urls.size,0);assert.equal(t.get('voice-recorder').classList.contains('hidden'),true);
});

test('The recording waveform changes bar density with its displayed width',async()=>{
    const t=voiceContext(), svg={width:960,attributes:{},getBoundingClientRect(){return{width:this.width};},setAttribute(k,v){this.attributes[k]=v;}};
    const path=t.get('voice-record-wave-path');path.ownerSVGElement=svg;
    await t.context.startVoiceRecording();t.advance(1600);await t.context.stopVoiceRecording();
    assert.equal(svg.attributes.viewBox,'0 0 960 32');
    assert.equal((path.attributes.d.match(/M/g)||[]).length,240);
    svg.width=320;t.context.syncVoiceComposer();
    assert.equal(svg.attributes.viewBox,'0 0 320 32');
    assert.equal((path.attributes.d.match(/M/g)||[]).length,80);
    assert.ok(!path.attributes.d.includes('NaN'));
});

test('Switching chats stops the microphone, keeps the draft, and cannot send it to the new chat',async()=>{
    const t=voiceContext();await t.context.startVoiceRecording();t.advance(1800);
    t.context.stopVoiceForNavigation();t.context.activeConversationId=2;await new Promise(resolve=>queueMicrotask(resolve));
    await t.context.sendVoiceRecording();assert.equal(t.sent.length,0);assert.ok(t.stopped>0);
    t.context.activeConversationId=1;t.context.syncVoiceComposer();await t.context.sendVoiceRecording();assert.equal(t.sent[0][1],1);
});

test('Failed message confirmation preserves the recording and reuses its uploaded file on retry',async()=>{
    const t=voiceContext();await t.context.startVoiceRecording();t.advance(1200);await t.context.stopVoiceRecording();
    t.context.connection.invoke=async()=>{throw new Error('offline');};await t.context.sendVoiceRecording();
    assert.equal(t.urls.size,1);assert.match(t.messages.at(-1),/recording is kept/);
    t.context.connection.invoke=async(...args)=>t.sent.push(args);await t.context.sendVoiceRecording();
    assert.equal(t.uploads.length,1);assert.equal(t.sent.length,1);assert.equal(t.urls.size,0);
});

test('Send while recording stops capture and sends only after the final audio chunk arrives',async()=>{
    const t=voiceContext();await t.context.startVoiceRecording();t.advance(1500);
    await t.context.sendVoiceRecording();
    assert.ok(t.stopped>0);assert.equal(t.sent.length,1);assert.equal(t.uploads.length,1);
    assert.equal(JSON.parse(t.sent[0][2]).duration,1.5);
});

test('Discarding an active recording releases capture without uploading or sending',async()=>{
    const t=voiceContext();await t.context.startVoiceRecording();t.advance(1500);t.context.discardVoiceRecording();
    await new Promise(resolve=>queueMicrotask(resolve));
    assert.ok(t.stopped>0);assert.equal(t.sent.length,0);assert.equal(t.uploads.length,0);assert.equal(t.urls.size,0);
});

test('Discarding while permission is pending stops any late stream without creating a recording',async()=>{
    const t=voiceContext();let resolve;
    t.context.navigator.mediaDevices.getUserMedia=()=>new Promise(done=>resolve=done);
    const pending=t.context.startVoiceRecording();t.context.discardVoiceRecording();
    let stopped=false;resolve({getTracks:()=>[{stop(){stopped=true;}}]});await pending;
    assert.equal(stopped,true);assert.equal(t.sent.length,0);assert.equal(t.get('voice-recorder').classList.contains('hidden'),true);
});

test('Microphone denial and insecure pages keep the regular composer usable',async()=>{
    const t=voiceContext();t.context.navigator.mediaDevices.getUserMedia=async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});};
    await t.context.startVoiceRecording();assert.match(t.messages.at(-1),/denied/);assert.equal(t.get('message-composer-row').classList.contains('hidden'),false);
    t.context.isSecureContext=false;await t.context.startVoiceRecording();assert.match(t.messages.at(-1),/HTTPS/);
});

test('Voice playback rendering validates attachment URLs, escapes avatars, and does not preload audio',()=>{
    const t=voiceContext(),message={attachmentUrl:'/uploads/'+ 'a'.repeat(32)+'.webm',content:JSON.stringify({wa:'voice',duration:2,waveform:[.2,.8]}),senderAvatarUrl:'" onerror="bad'};
    const html=t.context.renderVoiceMessage(message);assert.match(html,/preload="none"/);assert.match(html,/Seek voice message/);assert.ok(!html.includes('src="" onerror'));
    assert.match(t.context.renderVoiceMessage({...message,attachmentUrl:'https://untrusted.example/audio.webm'}),/unavailable/);
    assert.match(t.context.renderVoiceMessage({...message,content:'{"wa":"voice","duration":99999,"waveform":[1]}'}),/unavailable/);
});
