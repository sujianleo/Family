"use client";

import { useEffect, useState } from "react";

export function ResourceDocumentThumbnailFallback({
  name,
  thumbnailUrl
}: {
  name: string;
  thumbnailUrl?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [thumbnailUrl]);

  return (
    <div aria-label={`${name} 缩略图预览`} className="resource-document-thumbnail-fallback">
      {thumbnailUrl && !failed ? (
        <img alt="" loading="lazy" onError={() => setFailed(true)} src={thumbnailUrl} />
      ) : (
        <span>
          <strong>{name}</strong>
          <small>暂无可用缩略图</small>
        </span>
      )}
    </div>
  );
}
