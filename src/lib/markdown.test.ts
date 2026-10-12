import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("reads bold, italic, code and links", () => {
    expect(parseInline("a **b** *c* `d` [e](https://x.y)")).toEqual([
      { t: "text", v: "a " },
      { t: "b", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "i", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "code", v: "d" },
      { t: "text", v: " " },
      { t: "link", href: "https://x.y", c: [{ t: "text", v: "e" }] },
    ]);
  });

  it("keeps code inside bold", () => {
    expect(parseInline("**crash (`a?.b`).**")).toEqual([
      { t: "b", c: [{ t: "text", v: "crash (" }, { t: "code", v: "a?.b" }, { t: "text", v: ")." }] },
    ]);
  });

  it("leaves stray asterisks and non-web links as text", () => {
    expect(parseInline("5 * 3 and [x](javascript:alert(1))")).toEqual([{ t: "text", v: "5 * 3 and [x](javascript:alert(1))" }]);
  });
});

describe("parseMarkdown", () => {
  it("builds headings, paragraphs and nested lists", () => {
    const blocks = parseMarkdown(["# Title", "", "Some", "text.", "", "## ✨ New", "", "- One", "  - Inner", "- Two", "", "---"].join("\n"));
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "h", "ul", "hr"]);
    expect(blocks[1]).toEqual({ t: "p", c: [{ t: "text", v: "Some text." }] });
    expect(blocks[2]).toMatchObject({ level: 2, text: "✨ New" });
    const ul = blocks[3];
    if (ul.t !== "ul") throw new Error("expected a list");
    expect(ul.items).toHaveLength(2);
    expect(ul.items[0].children[0].c).toEqual([{ t: "text", v: "Inner" }]);
  });

  it("joins quote lines and carries indented text on to its bullet", () => {
    const blocks = parseMarkdown("> **Download:** a\n> b\n\n- First\n  still **first**\n");
    expect(blocks[0]).toEqual({ t: "quote", c: [{ t: "b", c: [{ t: "text", v: "Download:" }] }, { t: "text", v: " a b" }] });
    const ul = blocks[1];
    if (ul.t !== "ul") throw new Error("expected a list");
    expect(ul.items[0].c).toEqual([{ t: "text", v: "First still " }, { t: "b", c: [{ t: "text", v: "first" }] }]);
  });

  it("handles Windows line endings", () => {
    expect(parseMarkdown("## A\r\n\r\n- b\r\n").map((b) => b.t)).toEqual(["h", "ul"]);
  });
});
