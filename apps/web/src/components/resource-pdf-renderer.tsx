"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs, type DocumentProps } from "react-pdf";
import { ResourceDocumentThumbnailFallback } from "./resource-document-thumbnail-fallback";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

function PdfState({ children, tone = "muted" }: { children: string; tone?: "error" | "muted" }) {
  return <p className={`resource-document-state ${tone}`}>{children}</p>;
}

export function ResourcePdfPreview({ fallbackThumbnailUrl, name, url }: { fallbackThumbnailUrl?: string; name: string; url: string }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(320);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateWidth = () => setFrameWidth(Math.max(240, Math.floor(frame.clientWidth - 24)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const file = useMemo<DocumentProps["file"]>(() => ({ url, withCredentials: true }), [url]);

  return (
    <div aria-label={`${name} PDF 预览`} className="resource-document-renderer resource-pdf-preview" ref={frameRef}>
      <Document
        error={<ResourceDocumentThumbnailFallback name={name} thumbnailUrl={fallbackThumbnailUrl} />}
        file={file}
        key={url}
        loading={<PdfState>正在打开 PDF…</PdfState>}
        onLoadError={() => setFailed(true)}
        onLoadSuccess={({ numPages }) => {
          setFailed(false);
          setPageCount(numPages);
          setPageNumber(1);
        }}
      >
        {!failed && pageCount > 0 ? (
          <Page
            pageNumber={pageNumber}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            width={frameWidth}
          />
        ) : null}
      </Document>
      {!failed && pageCount > 0 ? (
        <nav aria-label="PDF 翻页" className="resource-pdf-pagination">
          <button disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => Math.max(1, page - 1))} type="button">上一页</button>
          <span>{pageNumber} / {pageCount}</span>
          <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))} type="button">下一页</button>
        </nav>
      ) : null}
    </div>
  );
}
