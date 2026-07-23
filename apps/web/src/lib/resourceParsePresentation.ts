export type ResourceParsePresentation = {
  content: string;
  items: Array<{
    label: string;
    tone: "attention" | "default" | "note";
    value: string;
  }>;
  preview: string;
  title: string;
  typeLabel: string;
};

const parsedResourcePattern = /^已解析《([^》]+)》，识别为([^，。]+)，(?:并加入 AI 分析记录|归属待确认)。\s*([\s\S]+)$/;

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
  const items = buildPresentationItems(content, title, typeLabel);

  return { content, items, preview, title, typeLabel };
}

function buildPresentationItems(content: string, title: string, typeLabel: string) {
  const fragments = content
    .replace(new RegExp(`^资料：${escapeRegExp(title)}[。．]?\s*`), "")
    .split(/[。．]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  const items = fragments.flatMap((fragment, index) => {
    const separator = fragment.indexOf("：");
    const label = separator > 0 ? fragment.slice(0, separator).trim() : index === 0 ? "识别类型" : "关键信息";
    const value = separator > 0 ? fragment.slice(separator + 1).trim() : fragment;
    if (!value || (label === "识别类型" && value === typeLabel)) return [];
    const tone = /异常|需关注|超出|偏高|偏低/.test(label)
      ? "attention" as const
      : /声明|虚构|测试/.test(label) || /虚构|不具备|非医学诊断/.test(value)
        ? "note" as const
        : "default" as const;
    return [{ label: label.slice(0, 18), tone, value }];
  });
  return items.slice(0, 8);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
