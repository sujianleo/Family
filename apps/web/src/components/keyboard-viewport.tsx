"use client";

import { useEffect } from "react";

type VirtualKeyboardController = EventTarget & {
  boundingRect: DOMRectReadOnly;
  overlaysContent: boolean;
};

type NavigatorWithVirtualKeyboard = Navigator & {
  virtualKeyboard?: VirtualKeyboardController;
};

function isTextEntryElement(element: Element | null) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || element.getAttribute("contenteditable") === "true";
}

export function KeyboardViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const visualViewport = window.visualViewport;
    const mobileViewportQuery = window.matchMedia("(pointer: coarse)");
    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
    const iOSWebKit = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standaloneDisplay = window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const readOrientation = () => window.screen.orientation?.type?.startsWith("landscape") ? "landscape" : "portrait";
    let animationFrame = 0;
    let settleFrame = 0;
    let layoutViewportHeight = Math.max(window.innerHeight, document.documentElement.clientHeight, visualViewport?.height || 0);
    let orientation = readOrientation();
    const settleTimers = new Set<number>();
    const cssEnvProbe = document.createElement("div");
    cssEnvProbe.setAttribute("aria-hidden", "true");
    cssEnvProbe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden;pointer-events:none;";
    document.body.appendChild(cssEnvProbe);

    // Chromium can expose the keyboard geometry directly. Opting in avoids
    // mixing Chrome's automatic resize with our own fixed-composer geometry.
    if (virtualKeyboard) {
      virtualKeyboard.overlaysContent = true;
    }

    function setRootProperty(name: string, value: string) {
      if (root.style.getPropertyValue(name) !== value) {
        root.style.setProperty(name, value);
      }
    }

    function readCssEnvPx(name: string) {
      cssEnvProbe.style.height = `env(${name}, 0px)`;
      const value = Number.parseFloat(window.getComputedStyle(cssEnvProbe).height);
      cssEnvProbe.style.height = "0";
      return Number.isFinite(value) ? value : 0;
    }

    function clearKeyboardVars() {
      root.style.removeProperty("--keyboard-overlay-inset-bottom");
      root.style.removeProperty("--keyboard-resize-inset-bottom");
      root.style.removeProperty("--keyboard-viewport-bottom");
      root.style.removeProperty("--visual-viewport-offset-top");
      root.style.removeProperty("--visual-viewport-height");
      delete root.dataset.keyboard;
      delete root.dataset.visualViewportInset;
    }

    function updateKeyboardViewport() {
      const activeTextEntry = isTextEntryElement(document.activeElement);
      const mobileViewport = mobileViewportQuery.matches || window.innerWidth <= 768;
      const mobileInput = activeTextEntry && mobileViewport;

      if (!mobileViewport) {
        clearKeyboardVars();
        return;
      }

      const currentOrientation = readOrientation();
      const currentViewportHeight = Math.max(window.innerHeight, document.documentElement.clientHeight, visualViewport?.height || 0);
      if (currentOrientation !== orientation) {
        orientation = currentOrientation;
        layoutViewportHeight = currentViewportHeight;
      } else if (!mobileInput) {
        // WebKit shrinks innerHeight as the keyboard appears. Keep the last
        // keyboard-free layout height so the visual viewport delta remains
        // measurable while the focused element is active.
        layoutViewportHeight = Math.max(layoutViewportHeight, currentViewportHeight);
      }

      const rawViewportHeight = visualViewport?.height || currentViewportHeight;
      // During iOS keyboard/tool-bar transitions WebKit can briefly report a
      // near-zero visual viewport. Never let that transient value collapse a
      // full-screen chat before the next stable viewport sample arrives.
      const minimumViableViewportHeight = Math.min(220, Math.max(120, layoutViewportHeight * 0.28));
      const viewportHeight = rawViewportHeight >= minimumViableViewportHeight ? Math.min(rawViewportHeight, layoutViewportHeight) : layoutViewportHeight;
      const rawViewportOffsetTop = visualViewport?.offsetTop || 0;
      const viewportOffsetTop = Math.min(Math.max(0, rawViewportOffsetTop), Math.max(0, layoutViewportHeight - viewportHeight));
      const viewportBottom = Math.min(layoutViewportHeight, viewportOffsetTop + viewportHeight);
      const visualViewportBottomInset = Math.max(0, Math.ceil(layoutViewportHeight - viewportBottom));
      const virtualKeyboardInset = Math.max(Math.round(virtualKeyboard?.boundingRect.height || 0), Math.round(readCssEnvPx("keyboard-inset-height")));
      const keyboardOverlayInset = virtualKeyboardInset > 0 ? virtualKeyboardInset : 0;
      const keyboardResizeInset = iOSWebKit ? visualViewportBottomInset : 0;
      const keyboardVisible = visualViewportBottomInset > 0 || keyboardOverlayInset > 0;
      // In standalone iOS mode the layout viewport can be panned farther than
      // visualViewport.offsetTop while the keyboard opens. That live delta is
      // the composer's actual drift from the native form-assistant boundary;
      // derive it from geometry instead of assuming a device-specific height.
      const layoutViewportDrift = Math.max(0, window.scrollY - viewportOffsetTop);
      const keyboardAccessoryBridge = iOSWebKit && standaloneDisplay && keyboardVisible ? layoutViewportDrift : 0;
      // This is the one coordinate every mobile composer can trust: its
      // bottom edge is the keyboard's top edge, whether the browser shrinks
      // the visual viewport (iOS) or overlays the keyboard (Android Chrome).
      const keyboardViewportBottom = keyboardOverlayInset > 0
        ? Math.max(0, layoutViewportHeight - keyboardOverlayInset)
        : viewportBottom + keyboardAccessoryBridge;

      setRootProperty("--visual-viewport-height", `${Math.round(viewportHeight)}px`);
      setRootProperty("--visual-viewport-offset-top", `${Math.round(viewportOffsetTop)}px`);
      setRootProperty("--keyboard-viewport-bottom", `${Math.round(keyboardViewportBottom)}px`);

      if (keyboardVisible) {
        setRootProperty("--keyboard-overlay-inset-bottom", `${keyboardOverlayInset}px`);
        setRootProperty("--keyboard-resize-inset-bottom", `${Math.round(keyboardResizeInset)}px`);
        root.dataset.visualViewportInset = "visible";
      } else {
        root.style.removeProperty("--keyboard-overlay-inset-bottom");
        root.style.removeProperty("--keyboard-resize-inset-bottom");
        delete root.dataset.visualViewportInset;
      }

      // Focus is only an observation trigger, never proof that the keyboard is
      // still visible. iOS can keep a textarea focused after the user dismisses
      // the software keyboard; geometry is the single source of truth so the
      // composer cannot remain stranded in its keyboard-open position.
      if (keyboardVisible) {
        root.dataset.keyboard = "open";
        return;
      }

      root.style.removeProperty("--keyboard-overlay-inset-bottom");
      root.style.removeProperty("--keyboard-resize-inset-bottom");
      delete root.dataset.keyboard;
    }

    function scheduleKeyboardViewportUpdate() {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateKeyboardViewport);
    }

    function scheduleSettledKeyboardViewportUpdate() {
      if (!mobileViewportQuery.matches && window.innerWidth > 768) {
        scheduleKeyboardViewportUpdate();
        return;
      }

      scheduleKeyboardViewportUpdate();
      window.cancelAnimationFrame(settleFrame);
      for (const timer of settleTimers) {
        window.clearTimeout(timer);
      }
      settleTimers.clear();

      let frameCount = 0;
      const runFrame = () => {
        updateKeyboardViewport();
        frameCount += 1;
        if (frameCount < 8) {
          settleFrame = window.requestAnimationFrame(runFrame);
        }
      };
      settleFrame = window.requestAnimationFrame(runFrame);

      for (const delay of [80, 160, 320]) {
        const timer = window.setTimeout(() => {
          settleTimers.delete(timer);
          updateKeyboardViewport();
        }, delay);
        settleTimers.add(timer);
      }
    }

    function schedulePointerKeyboardViewportUpdate() {
      const mobileViewport = mobileViewportQuery.matches || window.innerWidth <= 768;
      if (!mobileViewport) {
        return;
      }

      if (!isTextEntryElement(document.activeElement) && !root.dataset.keyboard && !root.dataset.visualViewportInset) {
        return;
      }

      scheduleKeyboardViewportUpdate();
    }

    function handlePageVisibilityChange() {
      if (document.visibilityState === "visible") {
        scheduleSettledKeyboardViewportUpdate();
      }
    }

    scheduleKeyboardViewportUpdate();
    window.addEventListener("resize", scheduleKeyboardViewportUpdate);
    window.addEventListener("scroll", scheduleKeyboardViewportUpdate, { passive: true });
    window.addEventListener("orientationchange", scheduleKeyboardViewportUpdate);
    window.addEventListener("pageshow", scheduleSettledKeyboardViewportUpdate);
    document.addEventListener("visibilitychange", handlePageVisibilityChange);
    mobileViewportQuery.addEventListener("change", scheduleSettledKeyboardViewportUpdate);
    document.addEventListener("focusin", scheduleSettledKeyboardViewportUpdate);
    document.addEventListener("focusout", scheduleSettledKeyboardViewportUpdate);
    document.addEventListener("input", scheduleKeyboardViewportUpdate);
    document.addEventListener("pointerup", schedulePointerKeyboardViewportUpdate);
    document.addEventListener("keyup", scheduleKeyboardViewportUpdate);
    visualViewport?.addEventListener("resize", scheduleKeyboardViewportUpdate);
    visualViewport?.addEventListener("scroll", scheduleKeyboardViewportUpdate);
    virtualKeyboard?.addEventListener("geometrychange", scheduleSettledKeyboardViewportUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(settleFrame);
      for (const timer of settleTimers) {
        window.clearTimeout(timer);
      }
      settleTimers.clear();
      window.removeEventListener("resize", scheduleKeyboardViewportUpdate);
      window.removeEventListener("scroll", scheduleKeyboardViewportUpdate);
      window.removeEventListener("orientationchange", scheduleKeyboardViewportUpdate);
      window.removeEventListener("pageshow", scheduleSettledKeyboardViewportUpdate);
      document.removeEventListener("visibilitychange", handlePageVisibilityChange);
      mobileViewportQuery.removeEventListener("change", scheduleSettledKeyboardViewportUpdate);
      document.removeEventListener("focusin", scheduleSettledKeyboardViewportUpdate);
      document.removeEventListener("focusout", scheduleSettledKeyboardViewportUpdate);
      document.removeEventListener("input", scheduleKeyboardViewportUpdate);
      document.removeEventListener("pointerup", schedulePointerKeyboardViewportUpdate);
      document.removeEventListener("keyup", scheduleKeyboardViewportUpdate);
      visualViewport?.removeEventListener("resize", scheduleKeyboardViewportUpdate);
      visualViewport?.removeEventListener("scroll", scheduleKeyboardViewportUpdate);
      virtualKeyboard?.removeEventListener("geometrychange", scheduleSettledKeyboardViewportUpdate);
      cssEnvProbe.remove();
      clearKeyboardVars();
    };
  }, []);

  return null;
}
