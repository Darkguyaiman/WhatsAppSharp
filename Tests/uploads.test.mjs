import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

function uploader(){
    let request;
    class Xhr {
        constructor(){request=this;this.upload={};this.headers={};}
        open(method,url){this.method=method;this.url=url;}setRequestHeader(k,v){this.headers[k]=v;}
        send(data){this.data=data;}abort(){this.onabort();}
    }
    const context=vm.createContext({XMLHttpRequest:Xhr,FormData,DOMException,window:{},document:{querySelector:()=>({value:'csrf-test'})}});
    vm.runInContext(readFileSync(new URL('../src/MessagingApp/wwwroot/js/uploads.js',import.meta.url),'utf8'),context);
    return {upload:context.window.uploadFile,get request(){return request;}};
}
test('Uploads send verification tokens, expose real progress, and wait for a valid response',async()=>{
    const h=uploader(),progress=[];const promise=h.upload(new Blob(['payload']),{onProgress:n=>progress.push(n)});
    assert.equal(h.request.headers.RequestVerificationToken,'csrf-test');
    h.request.upload.onprogress({lengthComputable:true,loaded:50,total:100});assert.deepEqual(progress,[50]);
    h.request.status=200;h.request.response={url:'/uploads/test.txt',name:'test.txt',size:7};h.request.onload();
    assert.equal((await promise).size,7);
});
test('Cancelled or rejected uploads do not become attachments',async()=>{
    const h=uploader(),controller=new AbortController();const promise=h.upload(new Blob(['payload']),{signal:controller.signal});controller.abort();await assert.rejects(promise,{name:'AbortError'});
    const rejected=h.upload(new Blob(['payload']));h.request.status=413;h.request.response={error:'File too large'};h.request.onload();await assert.rejects(rejected,/File too large/);
});
