// Voice notes use the existing authenticated upload and SignalR message paths.
// Recording drafts stay in this page's memory and are never sent automatically.
(() => {
    const drafts = new Map();
    window.hasUnsentVoiceMessages = () => requesting || Boolean(recording) || drafts.size > 0;
    const players = new WeakMap();
    const MAX_SECONDS = 600;
    const MAX_BYTES = 15 * 1024 * 1024;
    let recording = null;
    let requesting = false;
    let generation = 0;
    let activeAudio = null;

    const node = id => document.getElementById(id);
    const clock = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
    const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${name === 'pause' ? '<path d="M8 5v14M16 5v14"/>' : '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>'}</svg>`;

    function waveformPath(values, width = 192, live = false) {
        const count = Math.max(8, Math.floor(width / 4));
        const raw = Array.isArray(values) && values.length ? values : [0];
        const data = live ? raw.slice(-count) : raw;
        return Array.from({length:count}, (_, i) => {
            const index = live ? i - (count - data.length) : Math.floor(i * data.length / count);
            const amplitude = Math.sqrt(Math.min(1, Math.max(0, Number(data[index]) || 0)));
            const height = Math.max(2, amplitude * 28);
            return `M${i * 4 + 2} ${(16 - height / 2).toFixed(1)}v${height.toFixed(1)}`;
        }).join('');
    }

    function drawRecordingWaveform(values, live = false) {
        const path = node('voice-record-wave-path'); if (!path) return;
        const svg = path.ownerSVGElement;
        const width = Math.max(32, Math.min(1600, Math.round(svg?.getBoundingClientRect().width || 192)));
        svg?.setAttribute('viewBox', `0 0 ${width} 32`);
        path.setAttribute('d', waveformPath(values, width, live));
    }

    function metadata(content) {
        try {
            const value = JSON.parse(content);
            if (value.wa !== 'voice' || !Number.isFinite(value.duration) || value.duration < .5 || value.duration > MAX_SECONDS ||
                !Array.isArray(value.waveform) || !value.waveform.length || value.waveform.length > 64 ||
                value.waveform.some(n => !Number.isFinite(n) || n < 0 || n > 1)) return null;
            return value;
        } catch (_) { return null; }
    }

    window.renderVoiceMessage = message => {
        const url = safeAttachmentUrl(message.attachmentUrl);
        const data = metadata(message.content);
        if (!url || !data) return '<span class="deleted-msg">Voice message unavailable</span>';
        const path = waveformPath(data.waveform);
        // One SVG path for the whole waveform avoids dozens of DOM nodes per note.
        return `<div class="voice-note" data-voice-note data-duration="${data.duration}">
            <button type="button" class="voice-play" data-voice-action="play" aria-label="Play voice message">${icon('play')}</button>
            <div class="voice-track"><div class="voice-waveform">
                <svg viewBox="0 0 192 32" preserveAspectRatio="none" aria-hidden="true"><path class="voice-wave-base" d="${path}"/><path class="voice-wave-played" d="${path}"/></svg>
                <input class="voice-seek" type="range" min="0" max="${data.duration}" step="0.1" value="0" aria-label="Seek voice message" />
            </div><span class="voice-time">${clock(data.duration)}</span></div>
            <button type="button" class="voice-speed" data-voice-action="speed" aria-label="Playback speed, 1 times">1×</button>
            <span class="voice-avatar"><img src="${escapeHtml(message.senderAvatarUrl || '/images/avatars/avatar-default.svg')}" alt="" loading="lazy"/><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Zm-6-4v1a6 6 0 0 0 12 0v-1M12 18v4m-3 0h6"/></svg></span>
            <audio class="voice-audio" preload="none" src="${escapeHtml(url)}"></audio>
        </div>`;
    };

    function pausePlayback() {
        activeAudio?.pause();
        activeAudio = null;
    }
    window.pauseVoicePlayback = pausePlayback;
    window.stopVoiceMessagePlayback = id => {
        if (activeAudio?.closest?.('.msg')?.id === `msg-${id}`) pausePlayback();
    };

    function bindPlayer(root) {
        if (players.has(root)) return players.get(root);
        const audio = root.querySelector('audio');
        const play = root.querySelector('[data-voice-action="play"]');
        const seek = root.querySelector('.voice-seek');
        const time = root.querySelector('.voice-time');
        const duration = Number(root.dataset.duration);
        const update = () => {
            const elapsed = audio.ended ? duration : Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
            seek.value = Math.min(duration, elapsed);
            root.style.setProperty('--voice-progress', `${Math.min(100, elapsed / duration * 100)}%`);
            time.textContent = clock(audio.ended ? duration : elapsed);
        };
        audio.addEventListener('play', () => {
            if (activeAudio !== audio) pausePlayback();
            activeAudio = audio;
            play.innerHTML = icon('pause'); play.setAttribute('aria-label', 'Pause voice message');
            root.classList.add('is-playing');
        });
        const paused = () => {
            play.innerHTML = icon('play'); play.setAttribute('aria-label', 'Play voice message');
            root.classList.remove('is-playing');
        };
        audio.addEventListener('pause', paused);
        audio.addEventListener('ended', () => { paused(); update(); });
        audio.addEventListener('timeupdate', update);
        audio.addEventListener('error', () => { paused(); showToast('This voice message couldn’t play. Check your connection or try another browser.'); });
        seek.addEventListener('input', () => {
            try { audio.currentTime = Number(seek.value); update(); } catch (_) { /* Retry once the recording is loaded. */ }
        });
        players.set(root, audio);
        return audio;
    }

    document.addEventListener('click', async event => {
        const button = event.target.closest?.('[data-voice-action]');
        const root = button?.closest('[data-voice-note]');
        if (!root) return;
        const audio = bindPlayer(root);
        if (button.dataset.voiceAction === 'speed') {
            audio.playbackRate = audio.playbackRate === 1 ? 1.5 : audio.playbackRate === 1.5 ? 2 : 1;
            button.textContent = `${audio.playbackRate}×`;
            button.setAttribute('aria-label', `Playback speed, ${audio.playbackRate} times`);
        } else if (audio.paused) {
            if (recording) await window.stopVoiceRecording();
            if (audio.ended) audio.currentTime = 0;
            try { await audio.play(); } catch (_) { showToast('Couldn’t play this recording. Please try again.'); }
        } else audio.pause();
    });
    // A keyboard user can seek before clicking Play.
    document.addEventListener('focusin', event => {
        if (event.target.matches?.('.voice-seek')) bindPlayer(event.target.closest('[data-voice-note]'));
    });

    function releaseMicrophone(session) {
        clearInterval(session.timer);
        session.stream.getTracks().forEach(track => track.stop());
        session.context?.close().catch(() => {});
    }

    function sampleWaveform(samples) {
        return Array.from({length:48}, (_, i) => {
            const start = Math.floor(i * samples.length / 48);
            const end = Math.max(start + 1, Math.floor((i + 1) * samples.length / 48));
            return Math.round(Math.min(1, Math.max(0, ...samples.slice(start, end))) * 1000) / 1000;
        });
    }

    window.syncVoiceComposer = () => {
        if (!node('voice-recorder')) return;
        const draft = drafts.get(activeConversationId);
        const live = recording?.conversationId === activeConversationId;
        const busy = live || Boolean(draft) || requesting;
        node('message-composer-row').classList.toggle('hidden', busy);
        node('voice-recorder').classList.toggle('hidden', !busy);
        node('voice-recorder').classList.toggle('is-recording', live && !recording.stopping);
        const hasText = Boolean(node('composer-input')?.value.trim() || pendingAttachment);
        node('send-btn').classList.toggle('hidden', !hasText);
        node('voice-record-btn').classList.toggle('hidden', hasText);
        node('voice-record-btn').disabled = sendingMessage || uploadingAttachment;
        node('voice-record-dot').classList.toggle('hidden', !live && !requesting);
        node('voice-stop').classList.toggle('hidden', !live);
        node('voice-preview-play').classList.toggle('hidden', !draft || live);
        node('voice-send').disabled = requesting || Boolean(draft?.sending) || connection?.state !== signalR.HubConnectionState.Connected;
        node('voice-stop').disabled = Boolean(recording?.stopping);
        node('voice-recorder').querySelector('.voice-discard').disabled = Boolean(draft?.sending);
        node('voice-preview-play').disabled = Boolean(draft?.sending);
        if (draft && !live) {
            node('voice-record-time').textContent = clock(draft.duration);
            drawRecordingWaveform(draft.waveform);
        }
    };

    window.startVoiceRecording = async () => {
        if (recording || requesting || !activeConversationId || sendingMessage || uploadingAttachment) return;
        if (drafts.has(activeConversationId)) { window.syncVoiceComposer(); return; }
        if (typeof currentCall !== 'undefined' && currentCall) { showToast('Finish your call before recording a voice message.'); return; }
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            showToast('Voice recording needs HTTPS (or localhost) and a browser with microphone recording support.'); return;
        }
        const conversationId = activeConversationId;
        const request = ++generation;
        requesting = true; pausePlayback(); closeAttachMenu();
        node('emoji-picker-container')?.classList.add('hidden');
        node('voice-record-time').textContent = '0:00';
        drawRecordingWaveform([0], true);
        node('voice-record-status').textContent = 'Waiting for microphone access.';
        window.syncVoiceComposer();
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true}, video:false});
            if (request !== generation || conversationId !== activeConversationId) { stream.getTracks().forEach(track => track.stop()); return; }
            const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
                .find(value => MediaRecorder.isTypeSupported(value));
            const recorder = new MediaRecorder(stream, {...(type ? {mimeType:type} : {}), audioBitsPerSecond:64000});
            const session = recording = {conversationId, stream, recorder, chunks:[], samples:[], started:performance.now(), duration:0, bytes:0, stopping:false, cancelled:false};
            session.finished = new Promise(resolve => { session.resolve = resolve; });
            try {
                const Context = window.AudioContext || window.webkitAudioContext;
                if (Context) {
                    session.context = new Context();
                    session.analyser = session.context.createAnalyser(); session.analyser.fftSize = 256;
                    session.context.createMediaStreamSource(stream).connect(session.analyser);
                    session.values = new Float32Array(session.analyser.fftSize);
                    session.context.resume().catch(() => {});
                }
            } catch (_) { /* Recording still works without a live waveform analyser. */ }
            recorder.addEventListener('dataavailable', event => {
                if (event.data.size) { session.chunks.push(event.data); session.bytes += event.data.size; }
                if (session.bytes > MAX_BYTES && !session.stopping) window.stopVoiceRecording();
            });
            recorder.addEventListener('error', () => {
                session.cancelled = true; showToast('Recording stopped because the microphone became unavailable.');
                if (recording === session) window.stopVoiceRecording();
            });
            recorder.addEventListener('stop', () => finishRecording(session), {once:true});
            recorder.start(500);
            session.timer = setInterval(() => {
                session.duration = Math.min(MAX_SECONDS, (performance.now() - session.started) / 1000);
                let amplitude = 0;
                if (session.analyser) {
                    session.analyser.getFloatTimeDomainData(session.values);
                    amplitude = Math.min(1, Math.sqrt(session.values.reduce((sum, n) => sum + n * n, 0) / session.values.length) * 5);
                }
                session.samples.push(amplitude);
                if (activeConversationId === session.conversationId) {
                    node('voice-record-time').textContent = clock(session.duration);
                    drawRecordingWaveform(session.samples, true);
                }
                if (session.duration >= MAX_SECONDS) { showToast('Ten-minute limit reached. Your recording is ready to preview.'); window.stopVoiceRecording(); }
            }, 100);
            requesting = false;
            node('voice-record-status').textContent = 'Recording. Stop to preview, discard, or send.';
            window.syncVoiceComposer();
        } catch (error) {
            stream?.getTracks().forEach(track => track.stop());
            if (recording && recording.stream === stream) { releaseMicrophone(recording); recording = null; }
            if (request === generation) {
                const reason = error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser to record.' :
                    error.name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' :
                    'The microphone is unavailable. Close any app using it and try again.';
                showToast(reason);
            }
        } finally {
            if (request === generation) { requesting = false; window.syncVoiceComposer(); }
        }
    };

    function finishRecording(session) {
        if (session.finishedDone) return;
        session.finishedDone = true;
        releaseMicrophone(session);
        if (recording === session) recording = null;
        const blob = new Blob(session.chunks, {type:session.recorder.mimeType || session.chunks[0]?.type || 'audio/webm'});
        let draft = null;
        if (!session.cancelled && blob.size && blob.size <= MAX_BYTES && session.duration >= .5) {
            draft = {blob, duration:Math.round(session.duration * 10) / 10, waveform:sampleWaveform(session.samples), url:URL.createObjectURL(blob), sending:false};
            drafts.set(session.conversationId, draft);
        } else if (!session.cancelled) showToast(blob.size > MAX_BYTES ? 'Recording is too large. Try a shorter voice message.' : 'That recording was too short. Try again.');
        session.resolve(draft);
        if (session.conversationId === activeConversationId) {
            node('voice-record-status').textContent = draft ? 'Recording ready. Preview it or send.' : '';
            window.syncVoiceComposer();
        }
    }

    window.stopVoiceRecording = () => {
        const session = recording;
        if (!session) return Promise.resolve(drafts.get(activeConversationId));
        if (!session.stopping) {
            session.stopping = true;
            session.duration = Math.min(MAX_SECONDS, (performance.now() - session.started) / 1000);
            if (session.recorder.state !== 'inactive') session.recorder.stop();
            else finishRecording(session);
            releaseMicrophone(session);
            window.syncVoiceComposer();
        }
        return session.finished;
    };

    window.discardVoiceRecording = () => {
        const id = activeConversationId;
        if (drafts.get(id)?.sending) return;
        ++generation; requesting = false;
        if (recording?.conversationId === id) { recording.cancelled = true; window.stopVoiceRecording(); }
        const draft = drafts.get(id);
        if (draft) { draft.preview?.pause(); URL.revokeObjectURL(draft.url); drafts.delete(id); }
        pausePlayback(); window.syncVoiceComposer(); node('composer-input')?.focus();
    };

    window.previewVoiceRecording = async () => {
        const draft = drafts.get(activeConversationId);
        if (!draft || draft.sending) return;
        if (!draft.preview) {
            draft.preview = new Audio(draft.url);
            draft.preview.addEventListener('play', () => { if (activeAudio !== draft.preview) pausePlayback(); activeAudio = draft.preview; node('voice-preview-play').innerHTML = icon('pause'); node('voice-preview-play').setAttribute('aria-label','Pause recording'); });
            const reset = () => { if (drafts.get(activeConversationId) === draft) { node('voice-preview-play').innerHTML = icon('play'); node('voice-preview-play').setAttribute('aria-label','Play recording'); } };
            draft.preview.addEventListener('pause', reset); draft.preview.addEventListener('ended', reset);
            draft.preview.addEventListener('error', () => showToast('This browser couldn’t preview the recording. Try recording again.'));
        }
        if (!draft.preview.paused) { draft.preview.pause(); return; }
        if (draft.preview.ended) draft.preview.currentTime = 0;
        try { await draft.preview.play(); } catch (_) { showToast('Couldn’t preview the recording. Try again.'); }
    };

    window.sendVoiceRecording = async () => {
        const id = activeConversationId;
        if (!id || requesting) return;
        if (recording?.conversationId === id) await window.stopVoiceRecording();
        if (activeConversationId !== id) return;
        const draft = drafts.get(id);
        if (!draft || draft.sending) return;
        if (connection?.state !== signalR.HubConnectionState.Connected) { showToast('Waiting for a connection. Your recording is kept.'); return; }
        const replyId = pendingReply?.id || null;
        draft.sending = true; draft.preview?.pause(); window.syncVoiceComposer();
        node('voice-record-status').textContent = 'Sending voice message.';
        try {
            if (!draft.uploaded) {
                const mime = draft.blob.type;
                const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : null;
                if (!extension) throw new Error('This browser’s recording format is unsupported. Try another browser.');
                const data = new FormData(); data.append('file', draft.blob, `Voice message.${extension}`);
                if(window.uploadFile)draft.uploaded=await window.uploadFile(new File([draft.blob],`Voice message.${extension}`,{type:mime}),{onProgress:percent=>{if(activeConversationId===id)node('voice-record-status').textContent=`Uploading voice message · ${percent}%`;}});
                else {const response = await fetch('/api/upload', {method:'POST', headers:{RequestVerificationToken:document.querySelector('input[name="__RequestVerificationToken"]')?.value || ''}, body:data});
                if (!response.ok || response.redirected) throw new Error('Upload failed. Check your connection and try again.');draft.uploaded = await response.json();}
            }
            const file = draft.uploaded;
            await connection.invoke('SendMessage', id, JSON.stringify({wa:'voice',duration:draft.duration,waveform:draft.waveform}),
                'Voice', file.url, file.name, file.size, replyId);
            URL.revokeObjectURL(draft.url); drafts.delete(id);
            if (activeConversationId === id) {
                if (pendingReply?.id === replyId) cancelReply();
                node('voice-record-status').textContent = 'Voice message sent.';
            }
        } catch (_) { showToast('Voice message wasn’t confirmed. Your recording is kept. Check the chat before trying again.'); }
        finally { draft.sending = false; window.syncVoiceComposer(); }
    };

    window.stopVoiceForNavigation = () => {
        ++generation; requesting = false; pausePlayback();
        if (recording) window.stopVoiceRecording();
        window.syncVoiceComposer();
    };
    window.stopVoiceOnEscape = () => {
        if (requesting) { window.discardVoiceRecording(); return true; }
        if (recording && !recording.stopping) { window.stopVoiceRecording(); return true; }
        return false;
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) window.stopVoiceForNavigation(); });
    document.addEventListener('DOMContentLoaded', () => {
        const svg = node('voice-record-wave-path')?.ownerSVGElement;
        if (!svg || typeof ResizeObserver !== 'function') return;
        new ResizeObserver(() => {
            const draft = drafts.get(activeConversationId);
            if (recording?.conversationId === activeConversationId) drawRecordingWaveform(recording.samples, true);
            else if (draft) drawRecordingWaveform(draft.waveform);
        }).observe(svg);
    });
    window.addEventListener('pagehide', () => { if (recording) { recording.cancelled = true; window.stopVoiceRecording(); } ++generation; });
    document.addEventListener('DOMContentLoaded', () => window.syncVoiceComposer());
})();
