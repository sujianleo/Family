import type { FanmiliSticker } from "@/lib/fanmiliStickers";
import { findFanmiliSticker, searchFanmiliStickers } from "@/lib/fanmiliStickers";

export function FanmiliStickerSuggestions({
  onSelect,
  query
}: {
  onSelect: (sticker: FanmiliSticker) => void;
  query: string;
}) {
  const stickers = searchFanmiliStickers(query);
  if (stickers.length === 0) return null;

  return (
    <div aria-label="中文贴纸联想" className="chat-sticker-suggestions" data-sticker-count={stickers.length} role="listbox">
      {stickers.map((sticker) => (
        <button
          aria-label={`发送贴纸：${sticker.text}`}
          key={sticker.id}
          onClick={() => onSelect(sticker)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
        >
          <img alt="" loading="eager" src={sticker.src} />
          <span>{sticker.text}</span>
        </button>
      ))}
    </div>
  );
}

export function FanmiliStickerMessage({ fallbackText, stickerId }: { fallbackText: string; stickerId?: string }) {
  const sticker = findFanmiliSticker(stickerId);
  if (!sticker) return <p>{fallbackText}</p>;

  return (
    <figure aria-label={`贴纸：${sticker.text}`} className="chat-sticker-message">
      <img alt={sticker.text} loading="lazy" src={sticker.src} />
    </figure>
  );
}
