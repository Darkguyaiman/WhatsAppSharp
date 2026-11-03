import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
function callContext(){
 const nodes=new Map();const noop=()=>{};
 const element=()=>({textContent:'',innerHTML:'',srcObject:null,attributes:{},pause:noop,focus:noop,play:async()=>{},setAttribute(k,v){this.attributes[k]=v;},classList:{add:noop,remove:noop,toggle:noop,contains:()=>true}});
 const calls=[];const context=vm.createContext({console,Date,JSON,Promise,Map,Set,setTimeout:()=>1,clearTimeout:noop,setInterval:()=>1,clearInterval:noop,window:{addEventListener:noop,isSecureContext:true,RTCPeerConnection:function(){}},document:{activeElement:{focus:noop},addEventListener:noop,getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},querySelector:()=>null},navigator:{mediaDevices:{getUserMedia:async()=>{throw Object.assign(new Error('Denied'),{name:'NotAllowedError'});}}},connection:{state:'Connected',invoke:async(...args)=>calls.push(args)},signalR:{HubConnectionState:{Connected:'Connected'}},currentUserId:1,featureView:null,showToast:noop,featureRequest:async()=>({iceServers:[],relayConfigured:true})});
 vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/calls.js', import.meta.url),'utf8'),context);return{context,nodes,calls};
}
test('Weak call connections lower video bandwidth while preserving audio priority',async()=>{
 const {context}=callContext();const senders=[{track:{kind:'video'},params:{encodings:[{}]},getParameters(){return this.params;},async setParameters(p){this.params=p;}},{track:{kind:'audio'},params:{encodings:[{}]},getParameters(){return this.params;},async setParameters(p){this.params=p;}}];context.senders=senders;vm.runInContext('callPeer={getSenders:()=>senders}',context);await vm.runInContext("applyCallQuality('poor')",context);assert.equal(senders[0].params.encodings[0].maxBitrate,180000);assert.equal(senders[0].params.encodings[0].scaleResolutionDownBy,3);assert.equal(senders[1].params.encodings[0].priority,'high');assert.equal(senders[1].params.encodings[0].maxBitrate,32000);await vm.runInContext("applyCallQuality('good')",context);assert.equal(senders[0].params.encodings[0].scaleResolutionDownBy,1);assert.equal(senders[0].params.encodings[0].maxBitrate,1800000);
});
test('Ending a call stops camera and microphone tracks and releases remote streams',()=>{
 const {context,nodes}=callContext();let stopped=0,closed=0;context.tracks=[{stop(){stopped++;}},{stop(){stopped++;}}];context.peer={close(){closed++;}};vm.runInContext("callStream={getTracks:()=>tracks};callPeer=peer;currentCall={id:'test'};cleanupCall()",context);assert.equal(stopped,2);assert.equal(closed,1);assert.equal(vm.runInContext('currentCall',context),null);assert.equal(nodes.get('call-remote-audio').srcObject,null);
});
test('Mute and camera controls operate on the live media tracks',()=>{
 const {context,calls}=callContext();context.audioTrack={enabled:true};context.videoTrack={enabled:true};vm.runInContext("callStream={getAudioTracks:()=>[audioTrack],getVideoTracks:()=>[videoTrack]};currentCall={id:'call'};toggleCallMute();toggleCallCamera()",context);assert.equal(context.audioTrack.enabled,false);assert.equal(context.videoTrack.enabled,false);assert.equal(calls[0][1],'call');assert.equal(calls[0][2],'video-state');
});
test('ICE candidates arriving before the offer are queued and then flushed',async()=>{
 const {context}=callContext();const candidates=[];context.candidates=candidates;vm.runInContext("currentCall={id:'call'};callPeer={remoteDescription:null,addIceCandidate:async c=>candidates.push(c)}",context);await vm.runInContext("handleCallSignal({id:'call',kind:'ice',payload:JSON.stringify({candidate:'test'})})",context);assert.equal(candidates.length,0);assert.equal(vm.runInContext('callIceQueue.length',context),1);vm.runInContext('callPeer.remoteDescription={type:"offer"}',context);await vm.runInContext('flushCallIce()',context);assert.equal(candidates.length,1);
});
test('Permission denial provides a useful microphone/camera error',async()=>{
 const {context}=callContext();await assert.rejects(vm.runInContext('acquireCallMedia(true)',context),/access was denied/);
});
