import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = lang?.trim().split(/\s+/)[0] || "plaintext";
      const highlighted = language !== "plaintext" && hljs.getLanguage(language)
        ? hljs.highlight(text, { language }).value
        : DOMPurify.sanitize(text);
      const className = language === "plaintext" ? "hljs" : `hljs language-${language.replace(/[^a-z0-9_-]/gi, "")}`;
      return `<pre><code class="${className}">${highlighted}</code></pre>`;
    },
  },
});

export function renderMarkdown(value: string): string {
  const html = marked.parse(value, { gfm: true, breaks: true });
  return DOMPurify.sanitize(String(html));
}
