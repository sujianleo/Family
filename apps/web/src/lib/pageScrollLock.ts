"use client";

import { useEffect } from "react";

let lockCount = 0;
let restorePage: (() => void) | null = null;

export function usePageScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    if (lockCount === 1) restorePage = lockPage();
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        restorePage?.();
        restorePage = null;
      }
    };
  }, [active]);
}

function lockPage() {
  const root = document.documentElement;
  const body = document.body;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const rootOverflow = root.style.overflow;
  const rootOverscroll = root.style.overscrollBehavior;
  const bodyOverflow = body.style.overflow;
  const bodyOverscroll = body.style.overscrollBehavior;
  const bodyPosition = body.style.position;
  const bodyTop = body.style.top;
  const bodyLeft = body.style.left;
  const bodyRight = body.style.right;
  const bodyWidth = body.style.width;

  root.style.overflow = "hidden";
  root.style.overscrollBehavior = "none";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  body.style.position = "fixed";
  body.style.top = `${-scrollY}px`;
  body.style.left = `${-scrollX}px`;
  body.style.right = "0";
  body.style.width = "100%";

  return () => {
    root.style.overflow = rootOverflow;
    root.style.overscrollBehavior = rootOverscroll;
    body.style.overflow = bodyOverflow;
    body.style.overscrollBehavior = bodyOverscroll;
    body.style.position = bodyPosition;
    body.style.top = bodyTop;
    body.style.left = bodyLeft;
    body.style.right = bodyRight;
    body.style.width = bodyWidth;
    window.scrollTo(scrollX, scrollY);
  };
}
