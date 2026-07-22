"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

type SwipeAction = "complete" | "delete";

type TaskSwipeItemProps = {
  allowComplete?: boolean;
  commitDeleteOnSwipe?: boolean;
  commitOnSwipe?: boolean;
  children: ReactNode;
  className: string;
  completeLabel?: string;
  completeVariant?: "complete" | "restore";
  deleteLabel?: string;
  expandedSide: SwipeAction | null;
  itemId: string;
  onClick: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onExpandChange: (itemId: string | null, side?: SwipeAction) => void;
  onContextMenu?: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerCancelCapture: (event: PointerEvent<HTMLElement>) => void;
  onPointerDownCapture: (event: PointerEvent<HTMLElement>) => void;
  onPointerUpCapture: (event: PointerEvent<HTMLElement>) => void;
  onSwipeStart?: () => void;
  selectionMode: boolean;
  style?: CSSProperties;
};

type SwipePointerState = {
  active: boolean;
  baseOffset: number;
  currentOffset: number;
  pointerId: number;
  startX: number;
  startY: number;
};

const revealDistance = 84;
const actionThreshold = 62;
const tapIgnoreDistance = 14;
const preventScrollDistance = 10;
const swipeHorizontalIntentRatio = 1.4;
const settleTransitionMs = 300;

function clampSwipeOffset(offset: number) {
  return Math.max(-revealDistance, Math.min(revealDistance, offset));
}

function safelyCapturePointer(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic or interrupted pointer streams may not have an active pointer.
  }
}

function safelyReleasePointer(element: HTMLElement, pointerId: number) {
  try {
    element.releasePointerCapture?.(pointerId);
  } catch {
    // The pointer may already be released by the browser.
  }
}

export function TaskSwipeItem({
  allowComplete = true,
  commitDeleteOnSwipe = false,
  commitOnSwipe = false,
  children,
  className,
  completeLabel = "完成",
  completeVariant = "complete",
  deleteLabel = "删除",
  expandedSide,
  itemId,
  onClick,
  onComplete,
  onDelete,
  onExpandChange,
  onContextMenu,
  onKeyDown,
  onPointerCancelCapture,
  onPointerDownCapture,
  onPointerUpCapture,
  onSwipeStart,
  selectionMode,
  style
}: TaskSwipeItemProps) {
  const didSwipeRef = useRef(false);
  const swipePointerRef = useRef<SwipePointerState | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const expandedOffset = expandedSide === "complete" && allowComplete ? revealDistance : expandedSide === "delete" ? -revealDistance : 0;
  const visibleSide = offset > 0 ? "complete" : offset < 0 ? "delete" : expandedSide;

  useEffect(() => {
    setOffset(expandedOffset);
    setShowActions(Boolean(expandedSide));
  }, [expandedOffset]);

  function settle(offset: number) {
    setDragging(false);
    if (Math.abs(offset) >= actionThreshold) {
      const action: SwipeAction | null = offset > 0 && allowComplete ? "complete" : offset < 0 ? "delete" : null;
      if (!action) {
        setShowActions(false);
        onExpandChange(null);
        setOffset(0);
        return;
      }
      didSwipeRef.current = true;
      if (commitOnSwipe || (commitDeleteOnSwipe && action === "delete")) {
        setShowActions(false);
        onExpandChange(null);
        setOffset(0);
        if (action === "complete") onComplete(); else onDelete();
        return;
      }
      setShowActions(true);
      onExpandChange(itemId, action);
      return;
    }

    setShowActions(false);
    didSwipeRef.current = Math.abs(offset) > tapIgnoreDistance;
    onExpandChange(null);
    setOffset(0);
  }

  function readBoundedOffset(movementX: number) {
    const pointerState = swipePointerRef.current;
    const baseOffset = pointerState?.baseOffset ?? expandedOffset;
    return clampSwipeOffset(allowComplete ? baseOffset + movementX : Math.min(0, baseOffset + movementX));
  }

  function activateSwipe(event: PointerEvent<HTMLElement>, pointerState: SwipePointerState) {
    if (pointerState.active) {
      return;
    }

    pointerState.active = true;
    setDragging(true);
    setShowActions(true);
    onSwipeStart?.();
    safelyCapturePointer(event.currentTarget, event.pointerId);
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (selectionMode || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    didSwipeRef.current = false;
    swipePointerRef.current = {
      active: false,
      baseOffset: expandedOffset,
      currentOffset: expandedOffset,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const pointerState = swipePointerRef.current;
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    const movementX = event.clientX - pointerState.startX;
    if (!pointerState.active) {
      const movementY = event.clientY - pointerState.startY;
      const distanceX = Math.abs(movementX);
      const distanceY = Math.abs(movementY);
      if (distanceY > preventScrollDistance && distanceY * swipeHorizontalIntentRatio >= distanceX) {
        swipePointerRef.current = null;
        return;
      }
      if (distanceX <= preventScrollDistance || distanceX <= distanceY * swipeHorizontalIntentRatio) {
        return;
      }
    }

    activateSwipe(event, pointerState);
    const boundedOffset = readBoundedOffset(movementX);
    pointerState.currentOffset = boundedOffset;
    if (Math.abs(boundedOffset - pointerState.baseOffset) > preventScrollDistance) {
      event.preventDefault();
    }
    setOffset(boundedOffset);
  }

  function finishPointerSwipe(event: PointerEvent<HTMLElement>) {
    const pointerState = swipePointerRef.current;
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      return;
    }

    swipePointerRef.current = null;
    if (!pointerState.active) {
      return;
    }

    safelyReleasePointer(event.currentTarget, event.pointerId);
    settle(pointerState.currentOffset);
  }

  function cancelPointerSwipe(event: PointerEvent<HTMLElement>) {
    const pointerState = swipePointerRef.current;
    if (pointerState?.pointerId === event.pointerId) {
      safelyReleasePointer(event.currentTarget, event.pointerId);
    }
    swipePointerRef.current = null;
    setDragging(false);
    setShowActions(Boolean(expandedSide));
    setOffset(expandedOffset);
    didSwipeRef.current = true;
  }

  return (
    <div className={["task-swipe-shell", showActions ? "show-actions" : "", showActions && visibleSide ? `${visibleSide}-open` : ""].filter(Boolean).join(" ")}>
      {allowComplete ? (
        <button
          className="task-swipe-action task-swipe-action-complete"
          onClick={() => {
            onExpandChange(null);
            setShowActions(false);
            setOffset(0);
            onComplete();
          }}
          type="button"
        >
          <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 24 24">
            {completeVariant === "restore" ? (
              <><path d="M9 7H5v-4" /><path d="M5 7a8 8 0 1 1-1 8" /></>
            ) : <path d="m5 12 4 4L19 6" />}
          </svg>
          {completeLabel}
        </button>
      ) : null}
      <button
        className="task-swipe-action task-swipe-action-delete"
        onClick={() => {
          onExpandChange(null);
          setShowActions(false);
          setOffset(0);
          onDelete();
        }}
        type="button"
      >
        <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="m19 6-1 14H6L5 6" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
        </svg>
        {deleteLabel}
      </button>
      <article
        className={className}
        onClick={() => {
          if (didSwipeRef.current) {
            didSwipeRef.current = false;
            return;
          }
          onClick();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu?.();
        }}
        onKeyDown={onKeyDown}
        onPointerCancelCapture={onPointerCancelCapture}
        onPointerCancel={cancelPointerSwipe}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUpCapture={onPointerUpCapture}
        onPointerUp={finishPointerSwipe}
        role="button"
        style={
          {
            ...style,
            touchAction: "pan-y",
            transform: `translate3d(${offset}px, 0, 0)`,
            transition: dragging ? "none" : `transform ${settleTransitionMs}ms cubic-bezier(.22, .72, .2, 1)`
          } as CSSProperties
        }
        tabIndex={0}
      >
        {children}
      </article>
    </div>
  );
}
