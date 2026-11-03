function setCallOverlay(visible) { document.getElementById('call-backdrop')?.classList.toggle('hidden',!visible); const frame=document.getElementById('app-frame');if(frame)frame.inert=visible;const feature=document.getElementById('feature-screen');if(feature)feature.inert=visible; }
let currentCall = null;
let callPeer = null;
let callStream = null;
let callIceQueue = [];
let callStatsTimer;
let callClockTimer;
let callStartedAt;
let callReconnectTimer;
let callRetryCount = 0;
let callRingtoneTimer;
let callSignalQueue = Promise.resolve();
let callOfferBusy = false;
let callAnswered = false;
let callPreparing = false;
let callPreviousStats = new Map();
let callQualityLevel = 'good';
let callGoodSamples = 0;
let callBadSamples = 0;
let callPreviousFocus;
function callStatus(text) { const el=document.getElementById('call-state');if(el)el.textContent=text;document.getElementById('call-mini-label').textContent=text==='Connected'?'Return to call':text; }
function showCall(info,incoming=false) {
    document.getElementById('call-panel').classList.toggle('is-video',Boolean(info.video));
    document.getElementById('call-panel').classList.toggle('is-incoming',incoming);
    document.getElementById('call-video-waiting')?.classList.remove('hidden');
    callPreviousFocus=document.activeElement; setCallOverlay(true); document.getElementById('call-panel').setAttribute('aria-modal','true');
    const mine=info.callerId===currentUserId;
    document.getElementById('call-peer-name').textContent=mine?info.recipientName:info.callerName;
    document.getElementById('call-peer-avatar').src=mine?info.recipientAvatar:info.callerAvatar;
    document.getElementById('call-type-label').textContent=info.video?'Video call':'Voice call';
    document.getElementById('call-incoming-actions').classList.toggle('hidden',!incoming);
    document.getElementById('call-active-actions').classList.toggle('hidden',incoming);
    document.getElementById('call-camera').classList.toggle('hidden',!info.video);
    document.getElementById('call-panel').classList.remove('hidden'); document.getElementById('call-mini').classList.add('hidden');
    document.getElementById('call-video-stage').classList.toggle('hidden',!info.video||incoming);
    document.getElementById('call-quality').textContent='';document.getElementById('call-timer').textContent='';
    callStatus(incoming?'Incoming call…':'Calling…');window.refreshIcons?.();
    document.querySelector(incoming?'#call-incoming-actions button:last-child':'#call-active-actions .call-hangup')?.focus();
}
function minimizeCall() { if(!currentCall)return;setCallOverlay(false);document.getElementById('call-panel').classList.add('hidden');document.getElementById('call-panel').setAttribute('aria-modal','false');document.getElementById('call-mini').classList.remove('hidden'); }
function restoreCall() { if(!currentCall)return;setCallOverlay(true);document.getElementById('call-panel').classList.remove('hidden');document.getElementById('call-panel').setAttribute('aria-modal','true');document.getElementById('call-mini').classList.add('hidden'); }
function ringCall() { if(!currentCall||callAnswered)return; try { const audio=new Audio('/audio/ringtone.wav');audio.volume=.32;audio.play().catch(()=>{}); } catch(_){} }
function stopCallRinging() { clearInterval(callRingtoneTimer);callRingtoneTimer=null; }
async function acquireCallMedia(video) {
    window.stopVoiceForNavigation?.();
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection)throw new Error('Calls need HTTPS (or localhost) and a browser that supports microphone access.');
    try { return await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:video?{width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:30,max:30},facingMode:'user'}:false}); }
    catch(error){if(error.name==='NotAllowedError')throw new Error('Microphone or camera access was denied. Allow access in your browser settings and try again.');if(error.name==='NotFoundError')throw new Error('A microphone or camera could not be found. Check your devices.');if(error.name==='NotReadableError')throw new Error('Your microphone or camera is busy in another app. Close it there and retry.');throw error;}
}
async function prepareCallPeer(info) {
    const config=await featureRequest('CallConfig');
    callPeer=new RTCPeerConnection({iceServers:config.iceServers,iceCandidatePoolSize:4,bundlePolicy:'max-bundle'});
    callIceQueue=[];callRetryCount=0;callPreviousStats.clear();callQualityLevel='good';
    if(!config.relayConfigured)document.getElementById('call-quality').textContent='If the call does not connect, try another network.';
    callStream.getTracks().forEach(track=>{
        const sender=callPeer.addTrack(track,callStream);
        if(track.kind==='video') { const codecs=RTCRtpSender.getCapabilities?.('video')?.codecs;if(codecs?.length){const transceiver=callPeer.getTransceivers().find(t=>t.sender===sender);transceiver?.setCodecPreferences?.([...codecs.filter(c=>c.mimeType==='video/VP8'),...codecs.filter(c=>c.mimeType!=='video/VP8')]);} }
    });
    document.getElementById('call-local-video').srcObject=info.video?callStream:null;
    callPeer.onicecandidate=event=>{if(event.candidate&&currentCall)sendCallSignal('ice',event.candidate.toJSON()).catch(()=>{});};
    callPeer.ontrack=event=>{
        const stream=event.streams[0];if(!stream)return;
        // One playback element avoids duplicate remote audio in video calls.
        const media=document.getElementById(info.video?'call-remote-video':'call-remote-audio');media.srcObject=stream;media.play().catch(()=>document.getElementById('call-play-audio').classList.remove('hidden'));
        if(info.video)document.getElementById('call-video-waiting')?.classList.toggle('hidden',stream.getVideoTracks().some(track=>track.enabled&&track.readyState!=='ended'));
    };
    callPeer.onconnectionstatechange=()=>{
        if(!currentCall||!callPeer)return;
        if(callPeer.connectionState==='connected'){
            clearTimeout(callReconnectTimer);callRetryCount=0;callStatus('Connected');callAnswered=true;stopCallRinging();
            if(!callStartedAt){callStartedAt=Date.now();callClockTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-callStartedAt)/1000);document.getElementById('call-timer').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');},1000);}
            if(!callStatsTimer)callStatsTimer=setInterval(sampleCallQuality,3000);
        }
        if(['disconnected','failed'].includes(callPeer.connectionState)){
            callStatus('Reconnecting…');document.getElementById('call-quality').textContent='The connection dropped. We’re trying to reconnect.';
            scheduleCallRestart();
        }
    };
    callPeer.oniceconnectionstatechange=()=>{if(callPeer?.iceConnectionState==='failed')scheduleCallRestart();};
}
async function startChatCall(video=false) {
    if(currentCall||callPreparing){showToast('You already have a call open.');restoreCall();return;}
    if(!activeConversationId){showToast('Open a direct chat first.');return;}
    const row=document.querySelector(`.conv-item[data-id="${activeConversationId}"]`);
    if(row?.dataset.isGroup==='true'){showToast('Voice and video calls are available in direct chats.');return;}
    if(connection?.state!==signalR.HubConnectionState.Connected){showToast('Reconnect to chat before starting a call.');return;}
    callPreparing=true;
    try {
        callStream=await acquireCallMedia(video);
        const info=await connection.invoke('StartCall',activeConversationId,video);currentCall=info;showCall(info);
        await prepareCallPeer(info);if(currentCall.state === 'active') await makeCallOffer();ringCall();callRingtoneTimer=setInterval(ringCall,3500);
    }catch(error){if(currentCall)await connection.invoke('EndCall',currentCall.id,'failed').catch(()=>{});cleanupCall();showToast(error.message||'The call could not be started.');}
    finally{callPreparing=false;}
}
async function acceptIncomingCall() {
    if(!currentCall||callPreparing)return;callPreparing=true;
    const id=currentCall.id;document.querySelector('#call-incoming-actions button:last-child').disabled=true;callStatus('Connecting…');stopCallRinging();
    try {
        callStream=await acquireCallMedia(currentCall.video);
        if(!currentCall||currentCall.id!==id){callStream.getTracks().forEach(t=>t.stop());callStream=null;return;}
        await prepareCallPeer(currentCall);
        await connection.invoke('AcceptCall',id);callAnswered=true;
        document.getElementById('call-panel').classList.remove('is-incoming');
        document.getElementById('call-incoming-actions').classList.add('hidden');document.getElementById('call-active-actions').classList.remove('hidden');document.getElementById('call-video-stage').classList.toggle('hidden',!currentCall.video);
    }catch(error){await connection.invoke('EndCall',id,'failed').catch(()=>{});cleanupCall();showToast(error.message||'Couldn’t answer this call.');}
    finally{callPreparing=false;document.querySelector('#call-incoming-actions button:last-child').disabled=false;}
}
async function sendCallSignal(kind,payload){if(!currentCall)throw new Error('Call ended.');if(connection?.state!==signalR.HubConnectionState.Connected)throw new Error('Signalling is reconnecting.');await connection.invoke('CallSignal',currentCall.id,kind,JSON.stringify(payload));}
async function makeCallOffer(restart=false) {
    if(!currentCall||!callPeer||callOfferBusy||callPeer.signalingState!=='stable')return;
    callOfferBusy=true;
    try {await callPeer.setLocalDescription(await callPeer.createOffer({iceRestart:restart}));await sendCallSignal('offer',callPeer.localDescription.toJSON());}
    finally{callOfferBusy=false;}
}
async function handleCallSignal(signal) {
    if(!currentCall||signal.id!==currentCall.id||!callPeer)return;
    const payload=JSON.parse(signal.payload);
    if(signal.kind==='offer'){
        // The original caller alone creates/restarts offers, avoiding offer glare.
        if(currentCall.callerId===currentUserId)return;
        await callPeer.setRemoteDescription(payload);await flushCallIce();await callPeer.setLocalDescription(await callPeer.createAnswer());await sendCallSignal('answer',callPeer.localDescription.toJSON());
    }else if(signal.kind==='answer'){await callPeer.setRemoteDescription(payload);await flushCallIce();}
    else if(signal.kind==='ice'){if(callPeer.remoteDescription)await callPeer.addIceCandidate(payload).catch(()=>{});else if(callIceQueue.length<256)callIceQueue.push(payload);}
    else if(signal.kind==='video-state'){document.getElementById('call-remote-video').classList.toggle('camera-off',!payload.enabled);document.getElementById('call-video-waiting')?.classList.toggle('hidden',payload.enabled);}
}
async function flushCallIce(){for(const ice of callIceQueue.splice(0))await callPeer.addIceCandidate(ice).catch(()=>{});}
function scheduleCallRestart() {
    if(callReconnectTimer||!currentCall)return;
    callReconnectTimer=setTimeout(async()=>{
        callReconnectTimer=null;if(!currentCall||!callPeer||callPeer.connectionState==='connected')return;
        if(++callRetryCount>3){await endCurrentCall('failed');showToast('The call couldn’t reconnect. Check your connection and try again.');return;}
        try{if(currentCall.callerId===currentUserId&&connection?.state===signalR.HubConnectionState.Connected){callPeer.restartIce();await makeCallOffer(true);}}catch(_){}
        scheduleCallRestart();
    },8000);
}
async function sampleCallQuality() {
    if(!callPeer||callPeer.connectionState!=='connected')return;
    try{
        const stats=await callPeer.getStats();let loss=0,rtt=0,jitter=0;
        stats.forEach(report=>{
            if(report.type==='candidate-pair'&&report.state==='succeeded')rtt=Math.max(rtt,report.currentRoundTripTime||0);
            if(report.type==='inbound-rtp'&&!report.isRemote){const prior=callPreviousStats.get(report.id);if(prior){const received=Math.max(0,(report.packetsReceived||0)-prior.received);const lost=Math.max(0,(report.packetsLost||0)-prior.lost);if(received+lost>0)loss=Math.max(loss,lost/(received+lost));}jitter=Math.max(jitter,report.jitter||0);callPreviousStats.set(report.id,{received:report.packetsReceived||0,lost:report.packetsLost||0});}
            if(report.type==='remote-inbound-rtp'){rtt=Math.max(rtt,report.roundTripTime||0);loss=Math.max(loss,report.fractionLost||0);}
        });
        const poor=loss>.05||rtt>.6||jitter>.08;callBadSamples=poor?callBadSamples+1:0;callGoodSamples=poor?0:callGoodSamples+1;
        const desired=callBadSamples>=2?'poor':callGoodSamples>=4?'good':callQualityLevel;
        document.getElementById('call-quality').textContent=desired==='poor'?(currentCall?.video?'Connection is weak. Video quality is reduced to keep your voice clear.':'Connection is weak. Audio is adjusting to keep your voice clear.'):'Connection is good. Audio and video adjust automatically.';
        if(desired!==callQualityLevel){callQualityLevel=desired;await applyCallQuality(desired);}
    }catch(_){/* Browser congestion control still adapts if statistics are unavailable. */}
}
async function applyCallQuality(level) {
    if(!callPeer)return;
    for(const sender of callPeer.getSenders()){
        if(!sender.track)continue;const params=sender.getParameters();if(!params.encodings?.length)continue;
        if(sender.track.kind==='video'){params.encodings[0].maxBitrate=level==='poor'?180000:1800000;params.encodings[0].scaleResolutionDownBy=level==='poor'?3:1;params.encodings[0].maxFramerate=level==='poor'?15:30;params.degradationPreference='maintain-framerate';}
        else {params.encodings[0].maxBitrate=level==='poor'?32000:64000;params.encodings[0].priority='high';}
        await sender.setParameters(params).catch(()=>{});
    }
}
function toggleCallMute(){if(!callStream)return;const tracks=callStream.getAudioTracks();const mute=tracks.some(t=>t.enabled);tracks.forEach(t=>t.enabled=!mute);const button=document.getElementById('call-mute');button.setAttribute('aria-pressed',String(mute));button.innerHTML=`<i data-lucide="${mute?'mic-off':'mic'}"></i><span>${mute?'Unmute':'Mute'}</span>`;window.refreshIcons?.(button);}
function toggleCallCamera(){if(!callStream)return;const tracks=callStream.getVideoTracks();const off=tracks.some(t=>t.enabled);tracks.forEach(t=>t.enabled=!off);const button=document.getElementById('call-camera');button.setAttribute('aria-pressed',String(off));document.getElementById('call-local-video').classList.toggle('camera-off',off);sendCallSignal('video-state',{enabled:!off}).catch(()=>{});button.innerHTML=`<i data-lucide="${off?'video-off':'video'}"></i><span>${off?'Camera on':'Camera off'}</span>`;window.refreshIcons?.(button);}
function resumeCallAudio(){const audio=document.getElementById(currentCall?.video?'call-remote-video':'call-remote-audio');audio.play().then(()=>document.getElementById('call-play-audio').classList.add('hidden')).catch(()=>showToast('Use your browser’s media controls to allow audio.'));}
async function declineCall(){await endCurrentCall('declined');}
async function endCurrentCall(reason='completed'){
    const id=currentCall?.id;if(id&&connection?.state===signalR.HubConnectionState.Connected)await connection.invoke('EndCall',id,reason).catch(()=>{});cleanupCall();
}
function cleanupCall(){
    setCallOverlay(false);
    stopCallRinging();clearTimeout(callReconnectTimer);clearInterval(callStatsTimer);clearInterval(callClockTimer);callStatsTimer=null;callClockTimer=null;callReconnectTimer=null;callStartedAt=null;
    if(callPeer){callPeer.onconnectionstatechange=null;callPeer.oniceconnectionstatechange=null;callPeer.onicecandidate=null;callPeer.close();}
    callStream?.getTracks().forEach(t=>t.stop());callPeer=null;callStream=null;currentCall=null;callIceQueue=[];callOfferBusy=false;callAnswered=false;
    for(const id of ['call-local-video','call-remote-video','call-remote-audio']){const media=document.getElementById(id);media.pause();media.srcObject=null;media.classList.remove('camera-off');}
    document.getElementById('call-panel').classList.add('hidden');document.getElementById('call-mini').classList.add('hidden');document.getElementById('call-play-audio').classList.add('hidden');
    document.getElementById('call-mute').setAttribute('aria-pressed','false');document.getElementById('call-mute').innerHTML='<i data-lucide="mic"></i><span>Mute</span>';document.getElementById('call-camera').setAttribute('aria-pressed','false');document.getElementById('call-camera').innerHTML='<i data-lucide="video"></i><span>Camera</span>';callPreviousFocus?.focus?.();window.refreshIcons?.();
}
function setupCallEvents(hub){
    hub.on('IncomingCall',info=>{if(currentCall||callPreparing)return;currentCall=info;callAnswered=false;showCall(info,true);ringCall();callRingtoneTimer=setInterval(ringCall,3500);});
    hub.on('CallAccepted',async info=>{if(currentCall?.id!==info.id)return;stopCallRinging();callAnswered=true;currentCall.state='active';callStatus('Connecting…');try{await makeCallOffer();}catch(error){await endCurrentCall('failed');showToast(error.message);}});
    hub.on('CallSignal',signal=>{callSignalQueue=callSignalQueue.then(()=>handleCallSignal(signal)).catch(async error=>{if(currentCall){await endCurrentCall('failed');showToast('The call connection failed. Please try again.');}});});
    hub.on('CallAnsweredElsewhere',id=>{if(currentCall?.id===id){cleanupCall();showToast('Call answered in another browser.');}});
    hub.on('CallEnded',data=>{if(currentCall?.id===data.id){cleanupCall();showToast({declined:'Call declined.',missed:'No answer.',interrupted:'The call was interrupted.',cancelled:'Call cancelled.',failed:'Call connection failed.'}[data.state]||'Call ended.');}if(featureView==='calls')renderCallHistory().catch(()=>{});});
    hub.onreconnecting(()=>{if(currentCall){callStatus('Reconnecting…');scheduleCallRestart();}});
    hub.onreconnected(async()=>{if(currentCall){try{await hub.invoke('ResumeCall',currentCall.id);if(callAnswered&&currentCall.callerId===currentUserId)await makeCallOffer(true);}catch(_){cleanupCall();showToast('The call ended while reconnecting.');}}else await restorePendingCall();});
}
async function restorePendingCall(){if(currentCall||callPreparing)return;try{const pending=await connection.invoke('PendingCall');if(pending){currentCall=pending;showCall(pending,true);ringCall();callRingtoneTimer=setInterval(ringCall,3500);}}catch(_){} }
document.addEventListener('keydown',event=>{
    const panel=document.getElementById('call-panel');if(!panel||panel.classList.contains('hidden'))return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();minimizeCall();return;}
    if(event.key==='Tab'){const buttons=[...panel.querySelectorAll('button:not(:disabled)')].filter(b=>!b.closest('.hidden'));const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
},true);
window.addEventListener('pagehide',()=>{callStream?.getTracks().forEach(t=>t.stop());if(currentCall&&connection?.state===signalR.HubConnectionState.Connected)connection.invoke('EndCall',currentCall.id,'completed').catch(()=>{});});


