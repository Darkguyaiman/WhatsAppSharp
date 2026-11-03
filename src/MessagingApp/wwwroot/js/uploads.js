// Progress is network transfer progress; the server may still be finishing at 100%.
window.uploadFile = (file,{onProgress,signal}={}) => new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest(), data=new FormData();data.append('file',file);
    request.open('POST','/api/upload');request.responseType='json';
    request.setRequestHeader('RequestVerificationToken',document.querySelector('input[name="__RequestVerificationToken"]')?.value||'');
    const abort=()=>request.abort();
    const finish=()=>signal?.removeEventListener('abort',abort);
    request.upload.onprogress=event=>{if(event.lengthComputable)onProgress?.(Math.min(100,Math.round(event.loaded/event.total*100)));};
    request.onload=()=>{finish();if(request.status>=200&&request.status<300&&request.response?.url)resolve(request.response);else reject(new Error(request.response?.error||`Upload failed (${request.status}).`));};
    request.onerror=()=>{finish();reject(new Error('Connection lost. Please try again.'));};
    request.onabort=()=>{finish();reject(new DOMException('Upload cancelled.','AbortError'));};
    if(signal?.aborted){reject(new DOMException('Upload cancelled.','AbortError'));return;}
    signal?.addEventListener('abort',abort,{once:true});request.send(data);
});
