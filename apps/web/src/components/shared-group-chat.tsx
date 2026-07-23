import type { CSSProperties, ReactNode } from "react";

export function SharedGroupChatHeader({ leading, title, trailing }: { leading?: ReactNode; title: ReactNode; trailing?: ReactNode }) {
  return (
    <header className="chat-fullscreen-head">
      {leading ? <div className="chat-header-leading">{leading}</div> : null}
      <div className="chat-title-block">{title}</div>
      {trailing}
    </header>
  );
}

export function SharedGroupMemberStrip({ children, label }: { children: ReactNode; label: string }) {
  return <div className="chat-fullscreen-members" aria-label={label}>{children}</div>;
}

export function SharedGroupMessage({
  avatar,
  children,
  mine,
  senderName,
  sourceGroupId,
  style,
  timeLabel
}: {
  avatar: ReactNode;
  children: ReactNode;
  mine: boolean;
  senderName: string;
  sourceGroupId?: string;
  style?: CSSProperties;
  timeLabel?: string;
}) {
  return (
    <>
      {timeLabel ? <time className="chat-message-time">{timeLabel}</time> : null}
      <section className={mine ? "chat-message-group mine" : "chat-message-group"} data-source-group-id={sourceGroupId} style={style}>
        <span className="chat-message-group-avatar" aria-hidden="true">{avatar}</span>
        <div className="chat-message-group-body">
          <span className="chat-message-group-header">{senderName}</span>
          <div className="chat-message-group-items">{children}</div>
        </div>
      </section>
    </>
  );
}
