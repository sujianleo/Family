"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type DrawerSide = "left" | "right";

const blockedSwipeTargets = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='button']",
  "[role='dialog']",
  "[data-home-drawer-layer]",
  ".composer",
  ".record-action-wrap",
  ".record-row",
  ".task-swipe-shell",
  ".group-chat-row",
  ".resource-row",
  ".swipe-toast"
].join(",");

const homeSurfaceTargets = ".record-list,.workspace,.columns,.app-shell";
const activationDistance = 7;
// A deliberate short horizontal swipe should be enough on a phone. Requiring
// nearly half the screen made the hidden drawers feel unavailable.
const settleThreshold = 0.1;
const velocityThreshold = 0.2;

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  velocityX: number;
  startedOpen: boolean;
  activated: boolean;
};

export function useHomeDrawerSwipe({
  side,
  open,
  enabled = true,
  onOpen,
  onClose
}: {
  side: DrawerSide;
  open: boolean;
  enabled?: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [progress, setProgress] = useState(open ? 1 : 0);
  const [dragging, setDragging] = useState(false);
  const openRef = useRef(open);
  const draggingRef = useRef(false);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);

  openRef.current = open;
  onOpenRef.current = onOpen;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!draggingRef.current) setProgress(open ? 1 : 0);
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const root = document.documentElement;
    if (progress > 0) {
      const shift = (side === "left" ? 1 : -1) * progress * 100;
      root.dataset.homeDrawerSide = side;
      root.style.setProperty("--home-drawer-progress", progress.toFixed(4));
      root.style.setProperty("--home-drawer-shift", `${shift.toFixed(2)}vw`);
      root.style.setProperty("--home-drawer-sink", "0px");
      root.style.setProperty("--home-drawer-scale", "1");
    } else if (root.dataset.homeDrawerSide === side) {
      delete root.dataset.homeDrawerSide;
      root.style.removeProperty("--home-drawer-progress");
      root.style.removeProperty("--home-drawer-shift");
      root.style.removeProperty("--home-drawer-sink");
      root.style.removeProperty("--home-drawer-scale");
    }
  }, [progress, side]);

  useEffect(() => {
    if (!enabled) return;
    let gesture: Gesture | null = null;
    let suppressClickUntil = 0;

    const start = (event: PointerEvent) => {
      // iOS Safari touch gestures use the native Touch Events path below.
      // Keeping touch out of this Pointer Events branch prevents one physical
      // swipe from being tracked twice on browsers that emit both event sets.
      if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch") return;
      const startedOpen = openRef.current;
      if (startedOpen) {
        if (!isDrawerPanelTarget(event.target, side)) return;
      } else if (!isHomeSwipeStartTarget(event.target) && !isDrawerEdgeStart(event.clientX, side)) {
        return;
      }

      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocityX: 0,
        startedOpen,
        activated: false
      };
    };

    const move = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;

      if (!gesture.activated) {
        if (Math.abs(deltaY) > activationDistance && Math.abs(deltaY) > Math.abs(deltaX)) {
          gesture = null;
          return;
        }
        if (Math.abs(deltaX) < activationDistance || Math.abs(deltaX) <= Math.abs(deltaY) * 1.08) return;
        if (!movesTowardOpenState(deltaX, side, gesture.startedOpen)) {
          gesture = null;
          return;
        }
        gesture.activated = true;
        draggingRef.current = true;
        setDragging(true);
      }

      event.preventDefault();
      const elapsed = Math.max(1, event.timeStamp - gesture.lastTime);
      gesture.velocityX = (event.clientX - gesture.lastX) / elapsed;
      gesture.lastX = event.clientX;
      gesture.lastTime = event.timeStamp;
      setProgress(progressForDrag(deltaX, side, gesture.startedOpen, drawerTravel(side)));
    };

    const finish = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const completedGesture = gesture;
      gesture = null;
      if (!completedGesture.activated) return;
      const eventProgress = progressForDrag(event.clientX - completedGesture.startX, side, completedGesture.startedOpen, drawerTravel(side));
      const lastMoveProgress = progressForDrag(completedGesture.lastX - completedGesture.startX, side, completedGesture.startedOpen, drawerTravel(side));
      // WebKit automation and some fast real-device flicks report pointerup at
      // the original contact point. Preserve the furthest valid move instead
      // of erasing the gesture at release.
      const currentProgress = completedGesture.startedOpen
        ? Math.min(eventProgress, lastMoveProgress)
        : Math.max(eventProgress, lastMoveProgress);
      const openingVelocity = completedGesture.velocityX * (side === "left" ? 1 : -1);
      const shouldOpen = shouldSettleOpen(completedGesture.startedOpen, currentProgress, openingVelocity);

      event.preventDefault();
      suppressClickUntil = window.performance.now() + 500;
      draggingRef.current = false;
      setDragging(false);
      setProgress(shouldOpen ? 1 : 0);
      if (shouldOpen !== openRef.current) {
        openRef.current = shouldOpen;
        if (shouldOpen) onOpenRef.current(); else onCloseRef.current();
      }
    };

    const cancel = () => {
      if (!gesture?.activated) {
        gesture = null;
        return;
      }
      gesture = null;
      draggingRef.current = false;
      setDragging(false);
      setProgress(openRef.current ? 1 : 0);
    };

    const startNativeTouch = (event: globalThis.TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const startedOpen = openRef.current;
      if (startedOpen) {
        if (!isDrawerPanelTarget(event.target, side)) return;
      } else if (!isHomeSwipeStartTarget(event.target) && !isDrawerEdgeStart(touch.clientX, side)) {
        return;
      }

      gesture = {
        pointerId: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastTime: event.timeStamp,
        velocityX: 0,
        startedOpen,
        activated: false
      };
    };

    const moveNativeTouch = (event: globalThis.TouchEvent) => {
      const activeGesture = gesture;
      if (!activeGesture) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === activeGesture.pointerId);
      if (!touch) return;
      const deltaX = touch.clientX - activeGesture.startX;
      const deltaY = touch.clientY - activeGesture.startY;

      if (!activeGesture.activated) {
        if (Math.abs(deltaY) > activationDistance && Math.abs(deltaY) > Math.abs(deltaX)) {
          gesture = null;
          return;
        }
        if (Math.abs(deltaX) < activationDistance || Math.abs(deltaX) <= Math.abs(deltaY) * 1.08) return;
        if (!movesTowardOpenState(deltaX, side, activeGesture.startedOpen)) {
          gesture = null;
          return;
        }
        activeGesture.activated = true;
        draggingRef.current = true;
        setDragging(true);
      }

      event.preventDefault();
      const elapsed = Math.max(1, event.timeStamp - activeGesture.lastTime);
      activeGesture.velocityX = (touch.clientX - activeGesture.lastX) / elapsed;
      activeGesture.lastX = touch.clientX;
      activeGesture.lastTime = event.timeStamp;
      setProgress(progressForDrag(deltaX, side, activeGesture.startedOpen, drawerTravel(side)));
    };

    const finishNativeTouch = (event: globalThis.TouchEvent) => {
      const activeGesture = gesture;
      if (!activeGesture) return;
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === activeGesture.pointerId);
      gesture = null;
      const endX = touch?.clientX ?? activeGesture.lastX;
      const endY = touch?.clientY ?? activeGesture.startY;
      const deltaX = endX - activeGesture.startX;
      const deltaY = endY - activeGesture.startY;
      if (!activeGesture.activated) {
        // iOS/XCTest may coalesce a quick flick into touchstart + touchend
        // without observable touchmove samples. The final coordinates still
        // describe a valid deliberate horizontal gesture.
        if (
          Math.abs(deltaX) < activationDistance
          || Math.abs(deltaX) <= Math.abs(deltaY) * 1.08
          || !movesTowardOpenState(deltaX, side, activeGesture.startedOpen)
        ) {
          return;
        }
      }

      // XCTest-driven Safari and a few real WebKit transitions can finish an
      // already-active drag with an empty changedTouches list. The last move
      // coordinate is still authoritative and must not make the drawer snap
      // closed after the user completed the swipe.
      const currentProgress = progressForDrag(deltaX, side, activeGesture.startedOpen, drawerTravel(side));
      const openingVelocity = activeGesture.velocityX * (side === "left" ? 1 : -1);
      const shouldOpen = shouldSettleOpen(activeGesture.startedOpen, currentProgress, openingVelocity);

      event.preventDefault();
      suppressClickUntil = window.performance.now() + 500;
      draggingRef.current = false;
      setDragging(false);
      setProgress(shouldOpen ? 1 : 0);
      if (shouldOpen !== openRef.current) {
        openRef.current = shouldOpen;
        if (shouldOpen) onOpenRef.current(); else onCloseRef.current();
      }
    };

    const cancelNativeTouch = () => {
      const activeGesture = gesture;
      gesture = null;
      if (!activeGesture?.activated) return;

      const deltaX = activeGesture.lastX - activeGesture.startX;
      const currentProgress = progressForDrag(deltaX, side, activeGesture.startedOpen, drawerTravel(side));
      const openingVelocity = activeGesture.velocityX * (side === "left" ? 1 : -1);
      const shouldOpen = shouldSettleOpen(activeGesture.startedOpen, currentProgress, openingVelocity);
      suppressClickUntil = window.performance.now() + 500;
      draggingRef.current = false;
      setDragging(false);
      setProgress(shouldOpen ? 1 : 0);
      if (shouldOpen !== openRef.current) {
        openRef.current = shouldOpen;
        if (shouldOpen) onOpenRef.current(); else onCloseRef.current();
      }
    };

    window.addEventListener("pointerdown", start, true);
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("touchstart", startNativeTouch, { capture: true, passive: true });
    window.addEventListener("touchmove", moveNativeTouch, { capture: true, passive: false });
    window.addEventListener("touchend", finishNativeTouch, { capture: true, passive: false });
    window.addEventListener("touchcancel", cancelNativeTouch, true);
    const suppressSyntheticClick = (event: MouseEvent) => {
      if (window.performance.now() >= suppressClickUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("click", suppressSyntheticClick, true);
    return () => {
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("touchstart", startNativeTouch, true);
      window.removeEventListener("touchmove", moveNativeTouch, true);
      window.removeEventListener("touchend", finishNativeTouch, true);
      window.removeEventListener("touchcancel", cancelNativeTouch, true);
      window.removeEventListener("click", suppressSyntheticClick, true);
    };
  }, [enabled, side]);

  const layerStyle = useMemo(() => ({
    "--drawer-opacity": (0.72 + progress * 0.28).toFixed(4),
    "--drawer-progress": progress.toFixed(4),
    "--drawer-rise": `${((1 - progress) * 18).toFixed(2)}px`,
    "--drawer-scale": (0.985 + progress * 0.015).toFixed(4),
    "--drawer-translate": `${((1 - progress) * (side === "left" ? -104 : 104)).toFixed(3)}%`
  } as CSSProperties), [progress, side]);

  return {
    active: open || dragging || progress > 0,
    dragging,
    layerStyle,
    progress
  };
}

function isHomeSwipeStartTarget(target: EventTarget | null) {
  if (!(target instanceof Element) || target.closest(blockedSwipeTargets)) return false;
  return target === document.body || target === document.documentElement || Boolean(target.closest(homeSurfaceTargets));
}

function isDrawerEdgeStart(clientX: number, side: DrawerSide) {
  const edgeWidth = Math.min(40, Math.max(24, window.innerWidth * 0.08));
  return side === "left" ? clientX <= edgeWidth : clientX >= window.innerWidth - edgeWidth;
}

function isDrawerPanelTarget(target: EventTarget | null, side: DrawerSide) {
  return target instanceof Element && Boolean(target.closest(`[data-home-drawer-panel="${side}"]`));
}

function movesTowardOpenState(deltaX: number, side: DrawerSide, startedOpen: boolean) {
  const openingDelta = deltaX * (side === "left" ? 1 : -1);
  return startedOpen ? openingDelta < 0 : openingDelta > 0;
}

function drawerTravel(_side: DrawerSide) {
  return Math.max(1, window.innerWidth);
}

function progressForDrag(deltaX: number, side: DrawerSide, startedOpen: boolean, travel: number) {
  const openingDelta = deltaX * (side === "left" ? 1 : -1);
  return clamp((startedOpen ? 1 : 0) + openingDelta / travel, 0, 1);
}

function shouldSettleOpen(startedOpen: boolean, progress: number, openingVelocity: number) {
  if (startedOpen) {
    const shouldClose = openingVelocity < -velocityThreshold
      || (openingVelocity <= velocityThreshold && progress <= 1 - settleThreshold);
    return !shouldClose;
  }
  return openingVelocity > velocityThreshold
    || (openingVelocity >= -velocityThreshold && progress >= settleThreshold);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
