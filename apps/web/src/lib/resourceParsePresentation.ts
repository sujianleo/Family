export type ResourceParsePresentation = {
  content: string;
  preview: string;
  title: string;
  typeLabel: string;
};

const parsedResourcePattern = /^已解析《([^》]+)》，识别为([^，。]+)，并加入 AI 分析记录。\s*([\s\S]+)$/;

export function parseResourceParsePresentation(text: string): ResourceParsePresentation | null {
  if (text.includes("\n\n已解析《")) return null;
  const match = text.trim().match(parsedResourcePattern);
  if (!match) return null;

  const title = match[1].trim();
  const typeLabel = match[2].trim();
  const content = match[3].trim();
  if (!title || !typeLabel || !content) return null;

  const compactContent = content
    .replace(new RegExp(`^资料：${escapeRegExp(title)}[。．]?\\s*`), "")
    .replace(/\s+/g, " ")
    .trim();
  const previewSource = compactContent || content.replace(/\s+/g, " ").trim();
  const preview = previewSource.length > 92 ? `${previewSource.slice(0, 92).trimEnd()}…` : previewSource;

  return { content, preview, title, typeLabel };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
