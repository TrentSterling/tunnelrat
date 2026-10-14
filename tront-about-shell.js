// Page-level integration. Loaded before game input listeners so About stays a
// normal keyboard/touch disclosure even in games with window capture handlers.
(function () {
    'use strict';
    function about() { return document.getElementById('trontAbout'); }
    function close(panel) {
        panel.open = false;
        panel.querySelector('summary').focus({preventScroll: true});
    }
    function guard(event) {
        var panel = about();
        if (!panel) return;
        var inside = event.target instanceof Element && panel.contains(event.target);
        if (!inside) {
            if (panel.open && event.type === 'pointerdown') panel.open = false;
            return;
        }
        // Preserve native link navigation, summary toggling, selection and scroll.
        // Release events still reach games so held movement/grabs cannot stick.
        event.stopImmediatePropagation();
        if (event.type === 'keydown' && event.key === 'Escape' && panel.open) {
            event.preventDefault();
            close(panel);
        }
        if (event.type === 'click' && event.target.closest('[data-tront-about-close]')) close(panel);
    }
    ['pointerdown', 'mousedown', 'click', 'dblclick', 'touchstart', 'wheel', 'contextmenu', 'keydown'].forEach(function (name) {
        window.addEventListener(name, guard, {capture: true, passive: name === 'touchstart' || name === 'wheel'});
    });
    document.addEventListener('DOMContentLoaded', function () {
        var panel = about();
        if (!panel) return;
        // Some fixed-size games enlarge the layout viewport on phones. Keep the
        // disclosure in the visible viewport without resizing the game itself.
        function fitViewport() {
            var view = window.visualViewport;
            if (!view) return;
            panel.style.setProperty('--about-view-right', Math.max(0, innerWidth - view.width - view.offsetLeft) + 'px');
            panel.style.setProperty('--about-view-height', view.height + 'px');
            panel.style.setProperty('--about-view-width', view.width + 'px');
        }
        fitViewport();
        window.addEventListener('resize', fitViewport);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', fitViewport);
            window.visualViewport.addEventListener('scroll', fitViewport);
        }
        if (window.ResizeObserver) new ResizeObserver(fitViewport).observe(document.body);
        panel.addEventListener('toggle', function () {
            fitViewport();
            if (panel.open && window.BREAKMASS) window.BREAKMASS.stopForInterface();
            if (panel.open && document.pointerLockElement) document.exitPointerLock();
        });
        // Pointer lock is only reacquired by the game's original play gesture.
        document.addEventListener('pointerlockchange', function () {
            if (document.pointerLockElement) panel.open = false;
        });
    });
}());
