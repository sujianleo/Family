import { Fragment } from "react";
import { extractTaskTimeMentions } from "../lib/taskIntent";

export function TimeHighlightedText({ className, text }: { className?: string; text: string }) {
  const mentions = [
    ...extractTaskTimeMentions(text),
    ...Array.from(text.matchAll(/邀请/g)).map((match) => ({
      end: (match.index || 0) + match[0].length,
      kind: "invite" as const,
      start: match.index || 0,
      text: match[0]
    })),
    ...Array.from(text.matchAll(/安装/g)).map((match) => ({
      end: (match.index || 0) + match[0].length,
      kind: "install" as const,
      start: match.index || 0,
      text: match[0]
    }))
  ].sort((left, right) => left.start - right.start).filter((mention, index, all) => index === 0 || mention.start >= all[index - 1].end);
  if (mentions.length === 0) return <span className={className}>{text}</span>;

  let cursor = 0;
  return (
    <span className={className}>
      {mentions.map((mention) => {
        const leading = text.slice(cursor, mention.start);
        const following = text.slice(mention.end);
        const separateFromFollowingText =
          mention.kind !== "invite" && mention.kind !== "install" &&
          Boolean(following) &&
          !/^[\s，,。.!！?？:：;；、）)\]】]/.test(following);
        cursor = mention.end;
        return (
          <Fragment key={`${mention.start}-${mention.end}`}>
            {leading}
            <mark className={`time-highlight ${mention.kind}${separateFromFollowingText ? " followed-by-text" : ""}`} data-time-kind={mention.kind}>{mention.text}</mark>
          </Fragment>
        );
      })}
      {text.slice(cursor)}
    </span>
  );
}
