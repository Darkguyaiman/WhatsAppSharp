// CSS owns the motion. Alternating names restarts it on rapid navigation without
// timers, forced layout, intercepted links, or delaying any application work.
(() => {
    window.animateScreenSwap = (element, backwards = false) => {
        if (!element) return;
        element.dataset.swapDirection = backwards ? 'back' : 'forward';
        element.dataset.screenSwap = element.dataset.screenSwap === 'a' ? 'b' : 'a';
    };
})();
