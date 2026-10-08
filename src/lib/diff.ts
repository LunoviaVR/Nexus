/** Minimal LCS diff, enough for bios and statuses (a few hundred characters). */

export type Op<T> = { type: "same" | "add" | "del"; value: T };

export function diff<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Op<T>[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = eq(a[i], b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      out.push({ type: "same", value: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: "del", value: a[i++] });
    else out.push({ type: "add", value: b[j++] });
  }
  while (i < n) out.push({ type: "del", value: a[i++] });
  while (j < m) out.push({ type: "add", value: b[j++] });
  return out;
}

export interface DiffLine {
  type: "same" | "add" | "del";
  oldNo?: number;
  newNo?: number;
  /** Word-level segments; `changed` marks the parts that differ from the paired line. */
  parts: { text: string; changed: boolean }[];
}

const words = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** GitHub-style line diff with intra-line word highlights for modified lines. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const ops = diff(before.split("\n"), after.split("\n"));
  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === "same") {
      lines.push({ type: "same", oldNo: oldNo++, newNo: newNo++, parts: [{ text: op.value, changed: false }] });
      continue;
    }
    // Pair a run of deletions with the following run of additions for word-level highlighting.
    const dels: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k].type === "del") dels.push(ops[k++].value);
    while (k < ops.length && ops[k].type === "add") adds.push(ops[k++].value);
    k--;
    const pairs = Math.min(dels.length, adds.length);
    const delLines: DiffLine[] = [];
    const addLines: DiffLine[] = [];
    dels.forEach((d, idx) => {
      if (idx < pairs) {
        const w = diff(words(d), words(adds[idx]));
        delLines.push({ type: "del", oldNo: oldNo++, parts: w.filter((x) => x.type !== "add").map((x) => ({ text: x.value, changed: x.type === "del" })) });
      } else delLines.push({ type: "del", oldNo: oldNo++, parts: [{ text: d, changed: false }] });
    });
    adds.forEach((a, idx) => {
      if (idx < pairs) {
        const w = diff(words(dels[idx]), words(a));
        addLines.push({ type: "add", newNo: newNo++, parts: w.filter((x) => x.type !== "del").map((x) => ({ text: x.value, changed: x.type === "add" })) });
      } else addLines.push({ type: "add", newNo: newNo++, parts: [{ text: a, changed: false }] });
    });
    lines.push(...delLines, ...addLines);
  }
  return lines;
}

export function diffStats(lines: DiffLine[]) {
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "del").length,
  };
}
