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

export type RelKind = "mandatory" | "optional" | "or" | "alternative" | "cardinality";

export default function UvlCodeView({
  code,
  selectedName,
  featureNames,
  onPickName,
  onPickRel,
  highlightedRel,
}: {
  code: string;
  /** Name of the currently selected feature — highlighted in the UVL. */
  selectedName?: string | null;
  /** Valid feature names; a token is clickable only if it matches one. */
  featureNames?: Set<string>;
  /** Called when the user clicks a feature name in the UVL. */
  onPickName?: (name: string) => void;
  /** Called when the user clicks a relation keyword (mandatory/optional/or/...).
   *  `childNames` is the list of features that literally appear under that
   *  specific keyword line — needed to disambiguate when a parent has two
   *  `mandatory` blocks (e.g. one for loose mandatory children, one for an
   *  `and`-group). */
  onPickRel?: (parentName: string, kind: RelKind, childNames: string[]) => void;
  /** Keyword line to highlight — reverse (visual → UVL) sync. */
  highlightedRel?: { parentName: string; kind: RelKind; childNames: string[] } | null;
}) {
  const lines = useMemo(() => {
    const arr = code.split("\n");
    // strip any trailing whitespace-only / empty lines so the gutter doesn't
    // over-count past the last real line of UVL.
    while (arr.length > 0 && arr[arr.length - 1].trim() === "") arr.pop();
    return arr;
  }, [code]);

  // Per-line context: the enclosing feature name + (for keyword lines) the
  // explicit list of child features that appear under THAT line. The child
  // list disambiguates two `mandatory` blocks that share the same parent.
  const lineMeta = useMemo(() => {
    const featNameRe = /^(Boolean |Integer |Float |String )?(?:"([^"]+)"|([A-Za-z_][\w]*))/;
    const relKws = new Set<string>(["mandatory", "optional", "or", "alternative"]);

    const indents = lines.map((raw) => (/^(\s*)/.exec(raw)?.[1].length ?? 0));
    const trimmed = lines.map((raw) => raw.trimStart());
    const isKw = trimmed.map((t) => {
      const first = t.split(/\s|\[/, 1)[0];
      return relKws.has(first) || /^\[\s*\d+\s*\.\.\s*(?:\d+|\*)\s*\]/.test(t);
    });
    const nameOf = (i: number): string | null => {
      if (isKw[i]) return null;
      const m = featNameRe.exec(trimmed[i]);
      if (!m) return null;
      const nm = m[2] ?? m[3];
      if (!nm || nm === "features" || nm === "constraints" || nm === "include" || nm === "imports") return null;
      return nm;
    };

    // Parent of each line via an indent stack of *feature* lines only.
    const parents: (string | null)[] = [];
    const stack: { indent: number; name: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      while (stack.length && stack[stack.length - 1].indent >= indents[i]) stack.pop();
      parents.push(stack.length ? stack[stack.length - 1].name : null);
      const n = nameOf(i);
      if (n) stack.push({ indent: indents[i], name: n });
    }

    // For each keyword line, collect the child feature names that appear
    // directly beneath it (strictly greater indent, stopping when the indent
    // drops back to <= the keyword's indent).
    const children: (string[] | null)[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!isKw[i]) { children.push(null); continue; }
      const own = indents[i];
      const kids: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (indents[j] <= own) break;
        if (!isKw[j]) {
          // direct child feature: its indent is the first feature-indent
          // encountered after the keyword
          const n = nameOf(j);
          if (n) {
            // accept only the shallowest feature indent (direct children)
            const childIndent = indents[j];
            if (kids.length === 0 || childIndent === indents[i + 1] || childIndent === (kids.length ? indents[i + 1] : childIndent)) {
              // only push if this feature sits at the shallowest indent seen
              if (kids.length === 0) kids.push(n);
              else {
                // find the indent of the first collected child
                // by scanning back; simplest: track directChildIndent
              }
            }
          }
        }
      }
      // Simpler approach: track first-child indent explicitly.
      const kids2: string[] = [];
      let childIndent: number | null = null;
      for (let j = i + 1; j < lines.length; j++) {
        if (indents[j] <= own) break;
        if (isKw[j]) continue;
        const n = nameOf(j);
        if (!n) continue;
        if (childIndent === null) childIndent = indents[j];
        if (indents[j] === childIndent) kids2.push(n);
      }
      children.push(kids2);
    }

    return { parents, children, isKw };
  }, [lines]);
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
        .u-feat { cursor: pointer; border-radius: 3px; padding: 0 2px; }
        .u-feat:hover { background: #dbeafe; }
        .u-feat.u-sel { background: #2b6cff; color: #ffffff; }
        .u-rel { cursor: pointer; border-radius: 3px; padding: 0 2px; }
        .u-rel:hover { background: #fef3c7; }
        .u-rel.u-rel-sel { background: #f59e0b; color: #1f2937; }
      `}</style>
      <div className="uvl-view uvl-scroll">
        {lines.map((line, i) => {
          const toks = tokenizeLine(line);
          const parent = lineMeta.parents[i];
          const childrenForLine = lineMeta.children[i];
          return (
            <div key={i} className="uvl-row">
              <span className="uvl-gutter" style={{ minWidth: `${gutterW + 2}ch` }}>
                {i + 1}
              </span>
              <span className="uvl-line">
                {toks.length === 0 ? "\u00A0" : toks.map((t, j) => {
                  // Expose identifiers and quoted strings as clickable feature
                  // names so the UVL view can cross-select with the diagram.
                  const raw =
                    t.cls === "u-id" ? t.text :
                    t.cls === "u-str" && /^"[^"]*"$/.test(t.text) ? t.text.slice(1, -1) :
                    null;
                  const isFeat = raw && featureNames?.has(raw);
                  if (isFeat) {
                    const isSel = !!selectedName && raw === selectedName;
                    return (
                      <span
                        key={j}
                        className={`${t.cls} u-feat${isSel ? " u-sel" : ""}`}
                        onClick={(ev) => { ev.stopPropagation(); onPickName?.(raw!); }}
                        title={`Select "${raw}" in the diagram`}
                      >{t.text}</span>
                    );
                  }
                  // Relation keywords: mandatory / optional / or / alternative
                  // and cardinality bracket like [1..3].
                  const kind: RelKind | null =
                    t.cls === "u-kw" && (t.text === "mandatory" || t.text === "optional" || t.text === "or" || t.text === "alternative")
                      ? (t.text as RelKind)
                      : t.cls === "u-card" && /^\[\s*\d+\s*\.\.\s*(?:\d+|\*)\s*\]$/.test(t.text)
                      ? "cardinality"
                      : null;
                  if (kind && parent && onPickRel) {
                    const kids = childrenForLine ?? [];
                    const isHL =
                      !!highlightedRel &&
                      highlightedRel.parentName === parent &&
                      highlightedRel.kind === kind &&
                      // Match this specific block by its child set — two
                      // `mandatory` blocks under the same parent collapse to
                      // different kids arrays.
                      highlightedRel.childNames.length === kids.length &&
                      highlightedRel.childNames.every((n) => kids.includes(n));
                    return (
                      <span
                        key={j}
                        className={`${t.cls} u-rel${isHL ? " u-rel-sel" : ""}`}
                        onClick={(ev) => { ev.stopPropagation(); onPickRel(parent, kind, kids); }}
                        title={`Select ${kind} edges: ${kids.join(", ") || "(none)"}`}
                      >{t.text}</span>
                    );
                  }
                  return <span key={j} className={t.cls}>{t.text}</span>;
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
