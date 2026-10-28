/** What a Coder message is asking for. */
export type Mode = 'ask' | 'fix' | 'improve';

// "Fix ...", "Repair ..." is always a fix request.
const FIX_START_RE = /^\s*(fix|repair|patch|debug)\b/i;
// Questions ("How are errors handled?", "Explain the data flow") are asked, even when they mention errors.
const QUESTION_RE = /(\?\s*$)|^\s*(how|what|where|why|which|who|when|explain|describe|show|list|find|tell|summari[sz]e|give|is|are|does|do|can|could|should)\b/i;
// Words that describe broken or wrong behaviour: a statement with these is a bug report.
const BUG_RE = /\b(fix(es|ed)?|bugs?|broken|breaks?|crash(es|ed|ing)?|errors?|exceptions?|traceback|fail(s|ed|ing)?|failures?|wrong|incorrect|regression|not working|doesn'?t work|does not work|instead of|expected|should(n'?t| not)?|never|always|missing|ignored?|ignores|treated as|reported as|off[ -]by[ -]one|hangs?|leaks?|duplicated?)\b/i;
// Requests to make working code better: no test can fail for these, so they are not repairs.
const IMPROVE_RE = /\b(optimi[sz](e|ed|es|ing|ation)|refactor(ing)?|clean(ing)? ?up|speed ?up|faster|performance|improve|simplif(y|ies)|rewrite|tidy|readab(le|ility))\b/i;

/** Guess what the user wants from what they typed. */
export function detectMode(text: string): Mode {
  if (FIX_START_RE.test(text)) return 'fix';
  if (QUESTION_RE.test(text)) return 'ask';
  if (BUG_RE.test(text)) return 'fix';
  if (IMPROVE_RE.test(text)) return 'improve';
  return 'ask';
}

const IMPROVE_FILLER_RE = /\b(please|can you|could you|optimi[sz]e|refactor|clean ?up|speed ?up|improve|simplify|rewrite|tidy( up)?|make|it|faster|quicker|better|cleaner|the code|code|in|of)\b/gi;

/**
 * What the Ask agents are sent for an improve request (shown to the user as "asked as").
 * The agents answer questions about the code, so the request becomes a plain question:
 * "optimise library/loans.py" -> "How could the code in library/loans.py be optimised or improved?"
 */
export function improveQuestion(text: string): string {
  const files = [...new Set(text.match(FILE_TOKEN_RE) ?? [])];
  if (files.length) return `How could the code in ${files.join(' and ')} be optimised or improved?`;
  const target = text.replace(IMPROVE_FILLER_RE, ' ').replace(/[.?!]+$/, '').replace(/\s+/g, ' ').trim();
  return target ? `How could ${target} be optimised or improved?` : 'How could this codebase be optimised or improved?';
}

/** Edit distance between two short strings. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

const FILE_TOKEN_RE = /[\w./\\-]+\.py\b/g;
const baseName = (p: string) => p.split(/[/\\]/).pop()!.toLowerCase();

/**
 * Point file names in the message at real repo files: "loans.py" becomes "library/loans.py",
 * and a small typo ("loam.py", "loan.py") becomes the closest file name, when there is exactly one.
 * Returns the new text and a note for each name that was changed.
 */
export function resolveFiles(text: string, paths: string[]): { text: string; notes: string[] } {
  if (paths.length === 0) return { text, notes: [] };
  const notes: string[] = [];
  const out = text.replace(FILE_TOKEN_RE, (token) => {
    const wanted = token.replace(/\\/g, '/');
    if (paths.includes(wanted)) return token;
    const name = baseName(wanted);
    let matches = paths.filter((p) => baseName(p) === name);
    if (matches.length === 0) {
      const scored = paths.map((p) => ({ p, d: distance(baseName(p), name) })).filter((s) => s.d <= 2);
      const best = Math.min(...scored.map((s) => s.d));
      matches = scored.filter((s) => s.d === best).map((s) => s.p);
    }
    if (matches.length !== 1) return token;
    notes.push(`using ${matches[0]} for ${token}`);
    return matches[0];
  });
  return { text: out, notes };
}
