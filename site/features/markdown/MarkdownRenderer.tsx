import type { Root } from "mdast";
import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";
import MarkdownMermaid from "./MarkdownMermaid";
import MarkdownCodeCopyButton from "./MarkdownCodeCopyButton";
import MarkdownKatexStyles from "./MarkdownKatexStyles";

const calloutNames = new Set(["tip", "note", "warning", "quote"]);
const calloutLabels: Record<string, string> = { tip: "提示", note: "笔记", warning: "注意", quote: "摘录" };

function readNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(readNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return readNodeText(node.props.children);
  return "";
}

function codeLanguage(node: ReactNode): string {
  const first = Array.isArray(node) ? node.find(isValidElement) : node;
  if (!isValidElement<{ className?: string }>(first)) return "text";
  return /language-([\w+-]+)/.exec(first.props.className || "")?.[1]?.toLowerCase() || "text";
}

function languageFromPreNode(node: unknown): string {
  const child = (node as { children?: Array<{ properties?: { className?: string | string[] } }> })?.children?.[0];
  const classes = child?.properties?.className;
  const value = Array.isArray(classes) ? classes.join(" ") : classes || "";
  return /language-([\w+-]+)/.exec(value)?.[1]?.toLowerCase() || "";
}

function languageLabel(language: string): string {
  const names: Record<string, string> = {
    ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX", json: "JSON",
    sh: "Shell", shell: "Shell", bash: "Bash", zsh: "Zsh", ps1: "PowerShell", powershell: "PowerShell",
    py: "Python", python: "Python", html: "HTML", xml: "XML", css: "CSS", scss: "SCSS",
    sql: "SQL", yaml: "YAML", yml: "YAML", md: "Markdown", markdown: "Markdown",
    java: "Java", go: "Go", rust: "Rust", rs: "Rust", c: "C", cpp: "C++", csharp: "C#", cs: "C#",
    diff: "Diff", dockerfile: "Dockerfile", text: "Plain text",
  };
  return names[language] || language.toUpperCase();
}

function attachmentDetails(href: string | undefined, title: string | undefined, children: ReactNode) {
  if (!href || !/^\/api\/attachments\/att_[a-f0-9]{32}\//i.test(href)) return null;
  const name = readNodeText(children) || decodeURIComponent(href.split("/").pop() || "附件");
  const extension = name.includes(".") ? name.split(".").pop()!.toUpperCase() : "FILE";
  return { name, extension, metadata: title || "博客附件" };
}

function previewAuthorizedUrl(url: string | undefined, previewToken?: string) {
  if (!url || !previewToken || !/^\/api\/attachments\/att_[a-f0-9]{32}\//i.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}preview=${encodeURIComponent(previewToken)}`;
}

const responsiveImageWidths = [480, 768, 1200, 1600] as const;

function responsiveImageUrl(url: string, width: number) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}width=${width}`;
}

function isResizableLocalImage(url: string) {
  return /^\/api\/(?:attachments\/att_[a-f0-9]{32}\/|media\/)/i.test(url)
    && !/\.gif(?:\?|$)/i.test(url);
}

function remarkXingyuDirectives() {
  return (tree: Root) => {
    visit(tree, "containerDirective", (node) => {
      if (node.name === "details") {
        node.data = { hName: "details", hProperties: { className: ["md-details"], dataSummary: (node as { label?: string }).label || "展开补充" } };
      } else if (calloutNames.has(node.name)) {
        node.data = {
          hName: "aside",
          hProperties: { className: ["md-callout", `md-callout-${node.name}`], dataTitle: (node as { label?: string }).label || calloutLabels[node.name] },
        };
      }
    });
  };
}

const markdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "aside", "details", "summary", "figure", "figcaption", "mark", "kbd", "sub", "sup", "video", "audio", "source"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] || []), "className", "dataTitle", "dataSummary"],
    a: [...(defaultSchema.attributes?.a || []), "target", "rel"],
    img: [...(defaultSchema.attributes?.img || []), "width", "height", "loading"],
    video: ["src", "controls", "preload", "poster", "width", "height"],
    audio: ["src", "controls", "preload"],
    source: ["src", "type"],
  },
};

const MarkdownRenderer = memo(function MarkdownRenderer({ children, previewToken }: { children: string; previewToken?: string }) {
  const hasMath = /(^|[^\\])\$\$[\s\S]+?\$\$|(^|[^\\])\$(?!\s)(?:\\.|[^$\n])+\$/m.test(children);
  return <>
    {hasMath && <MarkdownKatexStyles />}
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkDirective, remarkXingyuDirectives]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, markdownSchema],
        [rehypeHighlight, { detect: true, plainText: ["mermaid", "plaintext", "text", "txt"] }],
        rehypeKatex,
      ]}
      components={{
      a({ href, title, children: linkChildren, ...props }) {
        const attachment = attachmentDetails(href, title, linkChildren);
        if (!attachment) return <a href={href} title={title} {...props}>{linkChildren}</a>;
        return <a className="md-attachment-card" href={previewAuthorizedUrl(href, previewToken)} title={`打开 ${attachment.name}`} target="_blank" rel="noreferrer" {...props}>
          <span className="md-attachment-kind" aria-hidden="true">{attachment.extension.slice(0, 5)}</span>
          <span className="md-attachment-copy"><strong>{attachment.name}</strong><small>{attachment.metadata}</small></span>
          <span className="md-attachment-action">{attachment.extension === "PDF" ? "预览" : "下载"} <i>↗</i></span>
        </a>;
      },
      img({ src, alt, ...props }) {
        const resolvedSrc = previewAuthorizedUrl(typeof src === "string" ? src : undefined, previewToken);
        const responsive = resolvedSrc && isResizableLocalImage(resolvedSrc) ? {
          src: responsiveImageUrl(resolvedSrc, 1200),
          srcSet: responsiveImageWidths.map((width) => `${responsiveImageUrl(resolvedSrc, width)} ${width}w`).join(", "),
          sizes: "(max-width: 760px) calc(100vw - 40px), 720px",
        } : { src: resolvedSrc };
        return <img {...props} {...responsive} loading={props.loading ?? "lazy"} decoding={props.decoding ?? "async"} alt={alt ?? ""} />;
      },
      pre({ children: preChildren, node, ...props }) {
        const source = readNodeText(preChildren).replace(/\n$/, "");
        const language = languageFromPreNode(node) || codeLanguage(preChildren);
        if (language === "mermaid") return <>{preChildren}</>;
        return <div className="md-code-block"><span className="md-code-language">{languageLabel(language)}</span><pre {...props}>{preChildren}</pre><MarkdownCodeCopyButton value={source} /></div>;
      },
      code({ className, children: codeChildren, ...props }) {
        const language = /language-(\S+)/.exec(className || "")?.[1];
        if (language === "mermaid") return <MarkdownMermaid chart={String(codeChildren).replace(/\n$/, "")} />;
        return <code className={className} {...props}>{codeChildren}</code>;
      },
      details({ children: detailChildren, ...props }) {
        const summary = String((props as Record<string, unknown>)["data-summary"] || (props as Record<string, unknown>).dataSummary || "展开补充");
        return <details {...props}><summary>{summary}</summary>{detailChildren}</details>;
      },
      aside({ children: asideChildren, ...props }) {
        const title = String((props as Record<string, unknown>)["data-title"] || (props as Record<string, unknown>).dataTitle || "说明");
        return <aside {...props}><strong>{title}</strong>{asideChildren}</aside>;
      },
      }}
    >{children}</ReactMarkdown>
  </>;
});

export default MarkdownRenderer;
