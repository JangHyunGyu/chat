/* Shared across ArcherLab games, Cupid and Nevergrad. Keep copies in sync. */
(function (root) {
  'use strict';
  if (root.ArcherImmersive) return;
  const doc = root.document;
  let pending = null;
  let attempted = false;

  const isFullscreen = () => Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
  const isStandalone = () => Boolean(root.navigator.standalone || root.matchMedia?.('(display-mode: standalone)').matches || root.matchMedia?.('(display-mode: fullscreen)').matches);
  const supported = () => Boolean(doc.documentElement.requestFullscreen || doc.documentElement.webkitRequestFullscreen || doc.documentElement.msRequestFullscreen);

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
      pending = Promise.resolve(result).then(() => true, () => false).finally(() => { pending = null; });
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
  root.addEventListener('pageshow', event => {
    if (event.persisted) attempted = false;
  });
  root.ArcherImmersive = Object.freeze({ enter, autoEnter, exit, isFullscreen, isStandalone, supported,
    toggle: () => isFullscreen() ? exit() : enter() });
})(window);
