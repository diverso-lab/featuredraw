import type { Constraint } from "./types";

export type VisualConstraint =
  | { id: string; kind: "requires"; from: string; to: string }
  | { id: string; kind: "excludes"; a: string; b: string };

const stripQuotes = (s: string) => s.trim().replace(/^"(.*)"$/, "$1");

/**
 * Parse constraints to their FODA-style visual notation when they match a
 * simple shape. Anything more complex (e.g. `(A & B) => C | D`) is left to
 * the text block below the diagram.
 */
export function parseVisualConstraints(constraints: Constraint[]): VisualConstraint[] {
  const out: VisualConstraint[] = [];
  for (const c of constraints) {
    const e = c.expr.trim();

    // A => !B   (logically equivalent to excludes)
    const excImpl = e.match(/^"?([^"=!&|()]+?)"?\s*=>\s*!\s*"?([^"=!&|()]+?)"?$/);
    if (excImpl) {
      out.push({ id: c.id, kind: "excludes", a: stripQuotes(excImpl[1]), b: stripQuotes(excImpl[2]) });
      continue;
    }

    // A => B   (requires)
    const req = e.match(/^"?([^"=!&|()]+?)"?\s*=>\s*"?([^"=!&|()]+?)"?$/);
    if (req) {
      out.push({ id: c.id, kind: "requires", from: stripQuotes(req[1]), to: stripQuotes(req[2]) });
      continue;
    }

    // !(A & B)   (canonical excludes)
    const exc = e.match(/^!\s*\(\s*"?([^"&()]+?)"?\s*&\s*"?([^"&()]+?)"?\s*\)$/);
    if (exc) {
      out.push({ id: c.id, kind: "excludes", a: stripQuotes(exc[1]), b: stripQuotes(exc[2]) });
      continue;
    }
  }
  return out;
}
