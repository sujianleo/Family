"use client";

import { forwardRef, useCallback, useLayoutEffect, useRef, type InputEvent, type KeyboardEvent, type TextareaHTMLAttributes, type UIEvent } from "react";
import { TimeHighlightedText } from "./time-highlight";

type ComposerAutosizeTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  highlightTime?: boolean;
  maxRows?: number;
  minRows?: number;
};

type TextareaMetrics = {
  chromeHeight: number;
  lineHeight: number;
};

function readLineHeight(element: HTMLTextAreaElement) {
  const style = window.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) {
    return lineHeight;
  }

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.45 : 22;
}

export const ComposerAutosizeTextarea = forwardRef<HTMLTextAreaElement, ComposerAutosizeTextareaProps>(function ComposerAutosizeTextarea(props, ref) {
  const { highlightTime = false, maxRows = 4, minRows = 1, onInput, onKeyDown, onScroll, value, ...restProps } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightContentRef = useRef<HTMLSpanElement | null>(null);
  const metricsRef = useRef<TextareaMetrics | null>(null);

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (typeof ref === "function") {
        ref(node);
        return;
      }
      if (ref) {
        ref.current = node;
      }
    },
    [ref]
  );

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    if (!metricsRef.current) {
      const computed = window.getComputedStyle(textarea);
      const borderHeight = Number.parseFloat(computed.borderTopWidth) + Number.parseFloat(computed.borderBottomWidth);
      const paddingHeight = Number.parseFloat(computed.paddingTop) + Number.parseFloat(computed.paddingBottom);
      metricsRef.current = {
        chromeHeight: borderHeight + paddingHeight,
        lineHeight: readLineHeight(textarea)
      };
    }

    const { chromeHeight, lineHeight } = metricsRef.current;
    const minHeight = Math.max(0, lineHeight * minRows + chromeHeight);
    const maxHeight = Math.max(minHeight, lineHeight * maxRows + chromeHeight);

    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${Math.ceil(nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight + 1 ? "auto" : "hidden";
  }, [maxRows, minRows]);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleInput(event: InputEvent<HTMLTextAreaElement>) {
    onInput?.(event);
    resizeTextarea();
  }

  function handleScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (highlightContentRef.current) {
      highlightContentRef.current.style.transform = `translate(${-event.currentTarget.scrollLeft}px, ${-event.currentTarget.scrollTop}px)`;
    }
    onScroll?.(event);
  }

  const textarea = <textarea {...restProps} className={highlightTime ? [restProps.className, "time-highlight-input"].filter(Boolean).join(" ") : restProps.className} onInput={handleInput} onKeyDown={handleKeyDown} onScroll={handleScroll} ref={setRefs} rows={minRows} value={value} />;
  if (!highlightTime) return textarea;

  return (
    <span className="composer-textarea-stack">
      <span aria-hidden="true" className="composer-time-highlight-layer">
        <span className="composer-time-highlight-content" ref={highlightContentRef}>
          <TimeHighlightedText text={String(value || "")} />
        </span>
      </span>
      {textarea}
    </span>
  );
});
