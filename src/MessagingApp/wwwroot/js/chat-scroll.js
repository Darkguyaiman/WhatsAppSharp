// Keep the latest message visible through late images, fonts, pins, and reflow.
(() => {
    let following = true, frame = null, observer = null, touchY = null;
    const container = () => document.getElementById('messages-container');
    function align() {
        frame=null;
        const box=container();if(following && box)box.scrollTop=box.scrollHeight;
    }
    function schedule() { if(following && frame===null)frame=requestAnimationFrame(align); }
    window.pauseMessageFollowing = () => {following=false;if(container())container().style.overflowAnchor='auto';};
    window.followLatestMessages = () => {
        following=true;const box=container();if(box){box.style.overflowAnchor='none';box.scrollTop=box.scrollHeight;}schedule();
    };
    window.watchMessageLayout = element => {
        const box=container();if(!box||!observer)return;
        if(element){observer.observe(element);return;}
        observer.disconnect();observer.observe(box);[...box.children].forEach(child=>observer.observe(child));schedule();
    };
    document.addEventListener('DOMContentLoaded',()=>{
        const box=container();if(!box)return;
        if(typeof ResizeObserver==='function'){observer=new ResizeObserver(schedule);window.watchMessageLayout();}
        box.addEventListener('load',schedule,true);
        box.addEventListener('wheel',event=>{if(event.deltaY<0)window.pauseMessageFollowing();},{passive:true});
        box.addEventListener('pointerdown',event=>{touchY=event.pointerType==='touch'?event.clientY:null;if(event.pointerType==='mouse'&&event.target===box)window.pauseMessageFollowing();},{passive:true});
        box.addEventListener('pointermove',event=>{if(touchY!==null&&event.clientY-touchY>8)window.pauseMessageFollowing();},{passive:true});
        box.addEventListener('pointerup',()=>touchY=null,{passive:true});box.addEventListener('pointercancel',()=>touchY=null,{passive:true});
        box.addEventListener('keydown',event=>{if(['ArrowUp','PageUp','Home'].includes(event.key)||event.key===' '&&event.shiftKey)window.pauseMessageFollowing();});
        box.addEventListener('scroll',()=>{if(box.scrollHeight-box.scrollTop-box.clientHeight<=2){following=true;box.style.overflowAnchor='none';}},{passive:true});
        window.addEventListener('resize',schedule);document.fonts?.ready.then(schedule);
    });
})();
