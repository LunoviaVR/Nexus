/**
 * Just enough Markdown for our release notes: headings, paragraphs, nested bullet lists, quotes,
 * rules, and **bold**, *italic*, `code` and [links](https://…) inside them. Parsed into plain data
 * so it renders as React elements, never as HTML.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export interface ListItem {
  c: Inline[];
  children: ListItem[];
}

export type Block =
  | { t: "h"; level: number; text: string; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "quote"; c: Inline[] }
  | { t: "ul"; items: ListItem[] }
  | { t: "hr" };

const CODE = /^`([^`]+)`/;
const BOLD = /^\*\*(.+?)\*\*/;
const ITALIC = /^\*([^*\s](?:[^*]*[^*\s])?)\*/;
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if (rest[0] === "`" && (m = CODE.exec(rest))) {
      flush();
      out.push({ t: "code", v: m[1] });
    } else if (rest.startsWith("**") && (m = BOLD.exec(rest))) {
      flush();
      out.push({ t: "b", c: parseInline(m[1]) });
    } else if (rest[0] === "*" && (m = ITALIC.exec(rest))) {
      flush();
      out.push({ t: "i", c: parseInline(m[1]) });
    } else if (rest[0] === "[" && (m = LINK.exec(rest))) {
      flush();
      out.push({ t: "link", href: m[2], c: parseInline(m[1]) });
    } else {
      text += s[i];
      i++;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

/** The plain text of some inline content, e.g. for comparing headings. */
export function inlineText(c: Inline[]): string {
  return c.map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineText(n.c))).join("");
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

interface RawItem {
  text: string;
  children: RawItem[];
}

const toItem = (r: RawItem): ListItem => ({ c: parseInline(r.text), children: r.children.map(toItem) });

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  // Open list: its items, plus the chain of items from the top level down to the last one added.
  let list: RawItem[] | null = null;
  let path: { indent: number; item: RawItem }[] = [];

  const endPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  const endQuote = () => {
    if (quote.length) blocks.push({ t: "quote", c: parseInline(quote.join(" ")) });
    quote = [];
  };
  const endList = () => {
    if (list) blocks.push({ t: "ul", items: list.map(toItem) });
    list = null;
    path = [];
  };
  const endAll = () => {
    endPara();
    endQuote();
    endList();
  };

  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      endPara();
      endQuote();
      continue;
    }
    if (RULE.test(line)) {
      endAll();
      blocks.push({ t: "hr" });
      continue;
    }
    let m = HEADING.exec(line);
    if (m) {
      endAll();
      const c = parseInline(m[2].trim());
      blocks.push({ t: "h", level: m[1].length, text: inlineText(c), c });
      continue;
    }
    m = BULLET.exec(line);
    if (m) {
      endPara();
      endQuote();
      const indent = m[1].replace(/\t/g, "  ").length;
      const item: RawItem = { text: m[2], children: [] };
      while (path.length && path[path.length - 1].indent >= indent) path.pop();
      if (!list) list = [];
      (path.length ? path[path.length - 1].item.children : list).push(item);
      path.push({ indent, item });
      continue;
    }
    if (line.startsWith(">")) {
      endPara();
      endList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    // An indented line right under a bullet carries on that bullet's text.
    if (list && path.length && /^\s/.test(line) && !para.length) {
      path[path.length - 1].item.text += ` ${line.trim()}`;
      continue;
    }
    endQuote();
    endList();
    para.push(line.trim());
  }
  endAll();
  return blocks;
}
