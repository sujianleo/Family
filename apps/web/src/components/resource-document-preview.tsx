"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ResourceDocumentThumbnailFallback } from "./resource-document-thumbnail-fallback";

const PdfPreview = dynamic(
  () => import("./resource-pdf-renderer").then((module) => module.ResourcePdfPreview),
  { loading: () => <p className="resource-document-state muted">正在打开 PDF…</p>, ssr: false }
);

export type ResourceDocumentKind = "docx" | "excel" | "pdf";

type ResourceDocumentPreviewProps = {
  fallbackThumbnailUrl?: string;
  kind: ResourceDocumentKind;
  name: string;
  url: string;
};

export function ResourceDocumentPreview({ fallbackThumbnailUrl, kind, name, url }: ResourceDocumentPreviewProps) {
  if (kind === "docx") return <DocxPreview fallbackThumbnailUrl={fallbackThumbnailUrl} name={name} url={url} />;
  if (kind === "excel") return <ExcelPreview fallbackThumbnailUrl={fallbackThumbnailUrl} name={name} url={url} />;
  return <PdfPreview fallbackThumbnailUrl={fallbackThumbnailUrl} name={name} url={url} />;
}

function PreviewState({ children, tone = "muted" }: { children: string; tone?: "error" | "muted" }) {
  return <p className={`resource-document-state ${tone}`}>{children}</p>;
}

function DocxPreview({ fallbackThumbnailUrl, name, url }: { fallbackThumbnailUrl?: string; name: string; url: string }) {
  const [pdfUrl, setPdfUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const previewUrl = new URL(url, window.location.origin);
    previewUrl.searchParams.set("variant", "document");
    const resolvedUrl = `${previewUrl.pathname}${previewUrl.search}${previewUrl.hash}`;
    setPdfUrl(undefined);
    fetch(resolvedUrl, { method: "HEAD", signal: controller.signal })
      .then((response) => setPdfUrl(response.ok && response.headers.get("content-type")?.includes("application/pdf") ? resolvedUrl : null))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setPdfUrl(null);
      });
    return () => controller.abort();
  }, [url]);

  if (pdfUrl === undefined) {
    return <div className="resource-document-renderer"><PreviewState>正在生成高保真 Word 预览…</PreviewState></div>;
  }
  if (pdfUrl) return <PdfPreview name={name} url={pdfUrl} />;
  return <DocxHtmlPreview fallbackThumbnailUrl={fallbackThumbnailUrl} name={name} url={url} />;
}

function DocxHtmlPreview({ fallbackThumbnailUrl, name, url }: { fallbackThumbnailUrl?: string; name: string; url: string }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const styleRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");

  useEffect(() => {
    const controller = new AbortController();
    const body = bodyRef.current;
    const style = styleRef.current;
    if (!body || !style) return;

    const fitPage = () => {
      const page = body.querySelector<HTMLElement>("section.resource-docx");
      if (!page) return;
      page.style.zoom = "1";
      const pageWidth = page.scrollWidth || page.offsetWidth;
      const availableWidth = Math.max(240, body.clientWidth - 32);
      page.style.zoom = String(Math.min(1, availableWidth / pageWidth));
    };
    window.addEventListener("resize", fitPage);

    body.replaceChildren();
    style.replaceChildren();
    setStatus("loading");

    void Promise.all([
      fetch(url, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("docx_preview_fetch_failed");
        return response.arrayBuffer();
      }),
      import("docx-preview")
    ])
      .then(([buffer, { renderAsync }]) => renderAsync(buffer, body, style, {
        breakPages: true,
        className: "resource-docx",
        ignoreFonts: false,
        inWrapper: true,
        renderChanges: false,
        renderComments: false,
        renderEndnotes: true,
        renderFootnotes: true,
        useBase64URL: true
      }))
      .then(() => {
        fitPage();
        setStatus("ready");
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setStatus("error");
      });

    return () => {
      controller.abort();
      window.removeEventListener("resize", fitPage);
    };
  }, [url]);

  return (
    <div aria-label={`${name} Word 预览`} className="resource-document-renderer resource-docx-preview">
      {status === "loading" ? <PreviewState>正在排版 Word 文档…</PreviewState> : null}
      {status === "error" ? <ResourceDocumentThumbnailFallback name={name} thumbnailUrl={fallbackThumbnailUrl} /> : null}
      <div className="resource-docx-styles" ref={styleRef} />
      <div className={status === "ready" ? "resource-docx-body ready" : "resource-docx-body"} ref={bodyRef} />
    </div>
  );
}

function ExcelPreview({ fallbackThumbnailUrl, name, url }: { fallbackThumbnailUrl?: string; name: string; url: string }) {
  const [sheets, setSheets] = useState<{ html: string; name: string }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");

  useEffect(() => {
    const controller = new AbortController();
    setSheets([]);
    setActiveSheet(0);
    setStatus("loading");

    void Promise.all([
      fetch(url, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error("excel_preview_fetch_failed");
        return response.arrayBuffer();
      }),
      import("xlsx")
    ])
      .then(([buffer, XLSX]) => {
        const workbook = XLSX.read(buffer, { cellDates: true, sheetRows: 201 });
        const nextSheets = workbook.SheetNames.map((sheetName) => ({
          html: XLSX.utils.sheet_to_html(workbook.Sheets[sheetName], { editable: false }),
          name: sheetName
        }));
        if (!nextSheets.length) throw new Error("excel_preview_empty");
        setSheets(nextSheets);
        setStatus("ready");
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setStatus("error");
      });

    return () => controller.abort();
  }, [url]);

  return (
    <div aria-label={`${name} Excel 预览`} className="resource-document-renderer resource-excel-preview">
      {status === "loading" ? <PreviewState>正在读取工作簿…</PreviewState> : null}
      {status === "error" ? <ResourceDocumentThumbnailFallback name={name} thumbnailUrl={fallbackThumbnailUrl} /> : null}
      {status === "ready" ? (
        <>
          {sheets.length > 1 ? (
            <div aria-label="工作表" className="resource-excel-tabs" role="tablist">
              {sheets.map((sheet, index) => (
                <button
                  aria-selected={activeSheet === index}
                  key={sheet.name}
                  onClick={() => setActiveSheet(index)}
                  role="tab"
                  type="button"
                >
                  {sheet.name}
                </button>
              ))}
            </div>
          ) : null}
          <div
            className="resource-excel-table"
            dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html || "" }}
            role="tabpanel"
          />
          <small className="resource-excel-limit">预览最多显示前 200 行</small>
        </>
      ) : null}
    </div>
  );
}
