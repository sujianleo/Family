"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type SharedComposerInputRowProps = {
  attachmentButtonProps: ButtonHTMLAttributes<HTMLButtonElement>;
  beforeInput?: ReactNode;
  inputClassName?: string;
  inputControl: ReactNode;
  inputLeadingContent?: ReactNode;
  sendButtonProps: ButtonHTMLAttributes<HTMLButtonElement>;
};

export function SharedComposerInputRow({
  attachmentButtonProps,
  beforeInput,
  inputClassName,
  inputControl,
  inputLeadingContent,
  sendButtonProps
}: SharedComposerInputRowProps) {
  const { className: attachmentClassName, ...attachmentProps } = attachmentButtonProps;
  const { className: sendClassName, ...sendProps } = sendButtonProps;

  return (
    <div className="composer-input-row home-composer-input-row shared-composer-input-row">
      {beforeInput}
      <label className={["composer-input-wrap", inputClassName].filter(Boolean).join(" ")}>
        {inputLeadingContent}
        {inputControl}
      </label>
      <button {...attachmentProps} className={["composer-attach-button", attachmentClassName].filter(Boolean).join(" ")}>
        <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
          <path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
        </svg>
      </button>
      <button {...sendProps} className={["composer-send-button", sendClassName].filter(Boolean).join(" ")}>
        <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
