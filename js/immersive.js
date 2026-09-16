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

  function keyboardOverlapFrom(metrics) {
    if (!metrics?.editing) return 0;
    const layout = Math.max(metrics.innerHeight || 0, metrics.clientHeight || 0);
    const vvOverlap = metrics.vvHeight == null
      ? 0
      : Math.max(0, Math.round(layout - metrics.vvHeight - (metrics.vvOffsetTop || 0)));
    const vk = Math.round(metrics.vkHeight || 0);
    return Math.max(vk > 80 ? vk : 0, vvOverlap > 80 ? vvOverlap : 0);
  }

  function keyboardOverlap() {
    const vv = root.visualViewport;
    return keyboardOverlapFrom({
      editing: isEditing(),
      innerHeight: root.innerHeight || 0,
      clientHeight: doc.documentElement.clientHeight || 0,
      vvHeight: vv ? vv.height : null,
      vvOffsetTop: vv ? vv.offsetTop || 0 : 0,
      vkHeight: root.navigator?.virtualKeyboard?.boundingRect?.height || 0
    });
  }

  function bindKeyboard() {
    const vk = root.navigator?.virtualKeyboard;
    if (vk && !vkBound && vk.addEventListener) {
      vkBound = true;
      vk.addEventListener('geometrychange', syncLayout);
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
    const keyboard = keyboardOverlap();
    const hint = fs && keyboard === 0 ? hintInset : 0;
    el.classList?.toggle('archer-immersive-fs', fs);
    el.classList?.toggle('archer-immersive-hint', fs && hint > 0);
    el.style.setProperty?.('--immersive-bottom-inset', `${hint}px`);
    el.style.setProperty?.('--immersive-keyboard-inset', `${keyboard}px`);
    // Hint only: a short lift so the browser exit toast does not cover controls.
    // Keyboard inset is left to each app so fullscreen and windowed layouts stay independent.
    el.style.transform = hint ? `translate3d(0,-${hint}px,0)` : '';
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
    if (target.closest('[data-fullscreen-start], canvas, [data-fullscreen-play], [data-fullscreen-force], button, [role="button"]')) autoEnter();
  }

  doc.addEventListener('click', onGesture, true);
  doc.addEventListener('pointerup', event => {
    if (event.target?.closest?.('canvas, [data-fullscreen-start], [data-fullscreen-play], button, [role="button"]')) onGesture(event);
  }, true);
  doc.addEventListener('keydown', event => {
    if (event.isTrusted && event.key === 'Enter' && !event.repeat &&
        ['BODY', 'CANVAS', 'BUTTON'].includes(event.target?.tagName)) autoEnter();
  }, true);
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
  bindKeyboard();
  root.ArcherImmersive = Object.freeze({
    enter, autoEnter, exit, isFullscreen, isStandalone, supported,
    keyboardOverlap, keyboardOverlapFrom,
    toggle: () => isFullscreen() ? exit() : enter()
  });
})(window);
