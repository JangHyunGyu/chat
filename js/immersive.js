/* Shared across ArcherLab games, Cupid and Nevergrad. Keep copies in sync. */
(function (root) {
  'use strict';
  if (root.ArcherImmersive) return;
  const doc = root.document;
  const HINT_PX = 80;
  const HINT_MS = 2000;
  let pending = null;
  let attempted = false;
  let hintInset = 0;
  let hintTimer = null;
  let vvBound = false;
  let vkBound = false;

  const isFullscreen = () => Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
  const isStandalone = () => Boolean(root.navigator.standalone || root.matchMedia?.('(display-mode: standalone)').matches || root.matchMedia?.('(display-mode: fullscreen)').matches);
  const supported = () => Boolean(doc.documentElement.requestFullscreen || doc.documentElement.webkitRequestFullscreen || doc.documentElement.msRequestFullscreen);

  function isEditing() {
    const el = doc.activeElement;
    if (!el || el === doc.body || el === doc.documentElement) return false;
    if (el.matches?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
    return Boolean(el.closest?.('[contenteditable="true"]'));
  }

  function keyboardInset() {
    if (!isEditing()) return 0;
    const vk = Math.round(root.navigator?.virtualKeyboard?.boundingRect?.height || 0);
    const vv = root.visualViewport;
    const layout = Math.max(root.innerHeight || 0, doc.documentElement.clientHeight || 0);
    const vvOverlap = vv ? Math.max(0, Math.round(layout - vv.height - (vv.offsetTop || 0))) : 0;
    // Overlay keyboards (typical in fullscreen) do not shrink visualViewport.
    if (vk > 80 && vvOverlap <= 80) return vk;
    return vvOverlap > 80 ? vvOverlap : 0;
  }

  function bindKeyboard() {
    const vk = root.navigator?.virtualKeyboard;
    if (vk) {
      try { vk.overlaysContent = true; } catch (_) {}
      if (!vkBound && vk.addEventListener) {
        vkBound = true;
        vk.addEventListener('geometrychange', syncLayout);
      }
    }
    if (root.visualViewport && !vvBound) {
      vvBound = true;
      root.visualViewport.addEventListener('resize', syncLayout);
      root.visualViewport.addEventListener('scroll', syncLayout);
    }
  }

  function syncLayout() {
    const el = doc.documentElement;
    const fs = isFullscreen();
    const keyboard = fs ? keyboardInset() : 0;
    const hint = fs ? hintInset : 0;
    const inset = Math.max(keyboard, hint);
    el.classList?.toggle('archer-immersive-fs', fs);
    el.classList?.toggle('archer-immersive-hint', fs && hint > 0);
    el.classList?.toggle('archer-immersive-keyboard', fs && keyboard > 0);
    el.style.setProperty?.('--immersive-bottom-inset', `${inset}px`);
    el.style.transform = inset ? `translate3d(0,-${inset}px,0)` : '';
  }

  function startHint() {
    hintInset = HINT_PX;
    if (hintTimer != null && root.clearTimeout) root.clearTimeout(hintTimer);
    hintTimer = root.setTimeout ? root.setTimeout(() => {
      hintInset = 0;
      hintTimer = null;
      syncLayout();
    }, HINT_MS) : null;
    syncLayout();
  }

  function onFullscreenChange() {
    if (isFullscreen()) {
      bindKeyboard();
      startHint();
    } else {
      hintInset = 0;
      if (hintTimer != null && root.clearTimeout) root.clearTimeout(hintTimer);
      hintTimer = null;
      syncLayout();
    }
  }

  function enter() {
    if (pending) return pending;
    if (isFullscreen() || isStandalone()) return Promise.resolve(true);
    if (!supported() || root.navigator.userActivation?.isActive === false) return Promise.resolve(false);
    const element = doc.documentElement;
    try {
      const result = element.requestFullscreen
        ? element.requestFullscreen({ navigationUI: 'hide' })
        : (element.webkitRequestFullscreen || element.msRequestFullscreen).call(element);
      // Older WebKit returns void; denial must never interrupt game startup.
      pending = Promise.resolve(result).then(() => {
        onFullscreenChange();
        return true;
      }, () => false).finally(() => { pending = null; });
      return pending;
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  function autoEnter() {
    if (attempted || root.navigator.userActivation?.isActive === false) return Promise.resolve(false);
    attempted = true;
    return enter();
  }

  function exit() {
    if (!isFullscreen()) return Promise.resolve(false);
    try {
      const leave = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      return Promise.resolve(leave?.call(doc)).then(() => true, () => false);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  function onGesture(event) {
    const target = event.target;
    if (!event.isTrusted || !target?.closest || target.closest('a, input, textarea, select, [contenteditable], [data-ranking-scroll], [data-no-fullscreen]')) return;
    // Phone, tablet, and desktop: any trusted play gesture forces immersive entry.
    if (target.closest('[data-fullscreen-start], canvas, [data-fullscreen-play], [data-fullscreen-force], button, [role="button"]')) autoEnter();
  }

  // Click retains activation for touch, mouse and native keyboard buttons.
  // Never preventDefault: navigation, focus, audio and game input keep working.
  doc.addEventListener('click', onGesture, true);
  // Canvas engines can cancel compatibility clicks after a touch. Pointer-up
  // still carries touch activation; Enter covers their keyboard-only menus.
  doc.addEventListener('pointerup', event => {
    if (event.target?.closest?.('canvas, [data-fullscreen-start], [data-fullscreen-play], button, [role="button"]')) onGesture(event);
  }, true);
  doc.addEventListener('keydown', event => {
    if (event.isTrusted && event.key === 'Enter' && !event.repeat &&
        ['BODY', 'CANVAS', 'BUTTON'].includes(event.target?.tagName)) autoEnter();
  }, true);
  // First trusted interaction anywhere that is not an excluded control.
  doc.addEventListener('pointerdown', event => {
    const target = event.target;
    if (!event.isTrusted || !target?.closest || target.closest('a, input, textarea, select, [contenteditable], [data-ranking-scroll], [data-no-fullscreen]')) return;
    autoEnter();
  }, true);
  doc.addEventListener('fullscreenchange', onFullscreenChange);
  doc.addEventListener('webkitfullscreenchange', onFullscreenChange);
  doc.addEventListener('MSFullscreenChange', onFullscreenChange);
  doc.addEventListener('focusin', syncLayout, true);
  doc.addEventListener('focusout', () => {
    if (root.setTimeout) root.setTimeout(syncLayout, 60);
    else syncLayout();
  }, true);
  root.addEventListener('resize', syncLayout);
  root.addEventListener('pageshow', event => {
    if (event.persisted) attempted = false;
  });
  root.ArcherImmersive = Object.freeze({ enter, autoEnter, exit, isFullscreen, isStandalone, supported,
    toggle: () => isFullscreen() ? exit() : enter() });
})(window);
