/**
 * First-party syntax highlighting for the diff viewer.
 *
 * The problem this solves: highlighting a diff line-by-line loses lexer state
 * across line boundaries (a tag or string that wraps onto the next line is
 * mis-tokenised), and highlighting that runs *after* the diff can't be merged
 * with the word-level change marks on a changed line. So instead we highlight
 * each whole side once — lexer state carries across every line — then express
 * both the highlight tokens and the diff chunks as `[start, end)` intervals over
 * the same line string and intersect them. Every resulting atom carries one
 * colour (from the grammar) and one diff status (default / added / removed).
 *
 * Grammars are loaded lazily per language via `ensureLanguage`, tokenisation is
 * synchronous (`refractor.highlight`), and colours are applied inline
 * (`style={{ color }}`) so they never collide with host-page CSS.
 */
import type { ReactElement } from "react";
import { type DiffInformation } from "./compute-lines.js";
import { type HighlightTheme } from "./highlight-theme.js";
/** A coloured run over a single line, in that line's character coordinate space. */
export interface HighlightToken {
    start: number;
    end: number;
    color: string;
}
/** Contiguous coloured runs for one line (covers the whole line, no gaps). */
export type LineTokens = HighlightToken[];
/**
 * Ensures the grammar for `language` is registered, loading it lazily if needed.
 * Resolves with the canonical language name to hand to `highlightSide`, or
 * `null` if the language is unknown or failed to load (caller falls back to no
 * highlighting). Safe to call repeatedly — registered/negative/in-flight are
 * all cached.
 */
export declare const ensureLanguage: (language: string) => Promise<string | null>;
/**
 * Highlights an entire side and returns per-line token arrays (index `i` is the
 * `i`-th line of `text`). Lexer state carries across lines because the whole
 * string is tokenised in one pass. `language` must be a canonical name from
 * `ensureLanguage`; returns `null` if tokenisation fails.
 */
export declare const highlightSide: (text: string, language: string, theme: HighlightTheme) => LineTokens[] | null;
/**
 * Re-bases a line's tokens to a sub-range starting at `from` (used to drop the
 * peeled leading-whitespace indent so body tokens align with the diff body).
 */
export declare const sliceLineTokens: (tokens: LineTokens, from: number) => LineTokens;
interface MergeStyles {
    wordDiff: string;
    wordAdded: string;
    wordRemoved: string;
}
interface MergeOptions {
    styles: MergeStyles;
    showHighlight: boolean;
}
/**
 * Intersects a changed line's highlight tokens with its word-diff chunks. Both
 * are contiguous partitions of the same body string, so a two-pointer walk over
 * their union of boundaries yields atoms that each carry one colour and one diff
 * status — preserving syntax colour *and* the `<ins>`/`<del>` word marks.
 */
export declare const mergeHighlightWithDiff: (bodyText: string, bodyTokens: LineTokens, diffArray: readonly DiffInformation[], options: MergeOptions) => ReactElement[];
/**
 * Renders a non-changed (context / fully-added / fully-removed) line as coloured
 * spans, with no word-diff wrapping.
 */
export declare const renderHighlightedPlain: (bodyText: string, bodyTokens: LineTokens) => ReactElement[];
export {};
