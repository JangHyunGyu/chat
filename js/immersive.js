/* Fullscreen immersive disabled for this app. Keep a no-op API for any leftover callers. */
(function (root) {
  'use strict';
  if (root.ArcherImmersive) return;
  const noop = () => Promise.resolve(false);
  root.ArcherImmersive = Object.freeze({
    enter: noop,
    autoEnter: noop,
    exit: noop,
    isFullscreen: () => false,
    isStandalone: () => false,
    supported: () => false,
    keyboardOverlap: () => 0,
    keyboardOverlapFrom: () => 0,
    toggle: noop
  });
})(window);
