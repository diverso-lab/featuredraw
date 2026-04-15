"use client";
import { useMemo } from "react";

/**
 * Lightweight UVL syntax highlighter + line numbers.
 * Zero deps, tokenizes per-line with a small regex sweep. Works great for
 * the amount of UVL our app generates (hundreds of lines max).
 */

const KEYWORDS = new Set([
  "features", "constraints", "include", "imports", "as",
  "mandatory", "optional", "or", "alternative", "cardinality",
]);
const TYPES = new Set(["Boolean", "Integer", "Float", "String"]);
const FUNCS = new Set(["sum", "avg", "len"]);

type Tok = { cls: string; text: string };

function tokenizeLine(raw: string): Tok[] {
  const toks: Tok[] = [];

  // Leading indent (kept as-is but with a muted color for the guides)
  const lead = /^[ \t]+/.exec(raw)?.[0] ?? "";
  if (lead) toks.push({ cls: "u-ind", text: lead });
  let s = raw.slice(lead.length);

  // Line comment
  const commentIdx = s.indexOf("//");
  let comment = "";
  if (commentIdx >= 0) {
    comment = s.slice(commentIdx);
    s = s.slice(0, commentIdx);
  }

  // Pattern: strings, numbers, keywords, operators, brackets, identifiers.
  // Order matters; we scan greedily.
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[\s*\d+\s*\.\.\s*(?:\d+|\*)\s*\]|\d+(?:\.\d+)?|=>|<=>|<=|>=|==|!=|[A-Za-z_][A-Za-z0-9_]*|[{}(),.*+\-/<>=&|!]|\s+)/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const t = m[0];
    if (!t) continue;

    if (/^\s+$/.test(t)) {
      toks.push({ cls: "u-ws", text: t });
    } else if (t.startsWith('"')) {
      toks.push({ cls: "u-str", text: t });
    } else if (t.startsWith("'")) {
      toks.push({ cls: "u-str", text: t });
    } else if (/^\[/.test(t)) {
      toks.push({ cls: "u-card", text: t });
    } else if (/^\d/.test(t)) {
      toks.push({ cls: "u-num", text: t });
    } else if (/^[A-Za-z_]/.test(t)) {
      if (KEYWORDS.has(t)) toks.push({ cls: "u-kw", text: t });
      else if (TYPES.has(t)) toks.push({ cls: "u-type", text: t });
      else if (FUNCS.has(t)) toks.push({ cls: "u-fn", text: t });
      else if (t === "true" || t === "false") toks.push({ cls: "u-bool", text: t });
      else toks.push({ cls: "u-id", text: t });
    } else if (/^(=>|<=>|<=|>=|==|!=|&|\||!|<|>|\+|-|\*|\/)$/.test(t)) {
      toks.push({ cls: "u-op", text: t });
    } else if (/^[{}(),.]$/.test(t)) {
      toks.push({ cls: "u-punct", text: t });
    } else {
      toks.push({ cls: "", text: t });
    }
  }

  if (comment) toks.push({ cls: "u-comment", text: comment });
  return toks;
}

export default function UvlCodeView({ code }: { code: string }) {
  const lines = useMemo(() => {
    const arr = code.split("\n");
    // strip any trailing whitespace-only / empty lines so the gutter doesn't
    // over-count past the last real line of UVL.
    while (arr.length > 0 && arr[arr.length - 1].trim() === "") arr.pop();
    return arr;
  }, [code]);
  const gutterW = Math.max(2, String(lines.length).length);

  return (
    <div className="relative w-full rounded-md border border-black/10 bg-[#fafbfc] overflow-hidden">
      <style>{`
        .uvl-view { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                    font-size: 11.5px; line-height: 1.55;
                    tab-size: 2; -moz-tab-size: 2; }
        .uvl-scroll { max-height: 18rem; overflow: auto; }
        .uvl-row { display: flex; align-items: flex-start; min-width: max-content; }
        .uvl-gutter {
          position: sticky; left: 0;
          flex: 0 0 auto;
          user-select: none; text-align: right;
          padding: 1px 8px 1px 10px;
          color: #9aa0a6;
          background: #f1f3f5; border-right: 1px solid #e5e7eb;
          z-index: 1;
        }
        .uvl-line { padding: 1px 10px; white-space: pre; }
        .u-kw   { color: #b45309; font-weight: 600; }
        .u-type { color: #0f766e; font-weight: 600; }
        .u-fn   { color: #6d28d9; }
        .u-str  { color: #065f46; }
        .u-num  { color: #b91c1c; }
        .u-card { color: #9333ea; }
        .u-bool { color: #b91c1c; font-weight: 600; }
        .u-op   { color: #374151; }
        .u-punct{ color: #6b7280; }
        .u-id   { color: #111827; }
        .u-ind  { color: #d1d5db; }
        .u-comment { color: #6b7280; font-style: italic; }
      `}</style>
      <div className="uvl-view uvl-scroll">
        {lines.map((line, i) => {
          const toks = tokenizeLine(line);
          return (
            <div key={i} className="uvl-row">
              <span className="uvl-gutter" style={{ minWidth: `${gutterW + 2}ch` }}>
                {i + 1}
              </span>
              <span className="uvl-line">
                {toks.length === 0 ? "\u00A0" : toks.map((t, j) => (
                  <span key={j} className={t.cls}>{t.text}</span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
