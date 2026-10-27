/**
 * Syntax-highlighting colour themes for the first-party `highlightLanguage`
 * feature. Colours are applied inline (`style={{ color }}`) on token spans, so
 * they never collide with host-page CSS and require no stylesheet import —
 * matching the way the rest of the diff viewer pins its own presentation.
 *
 * Keys are Prism token types (the class Prism emits after the leading `token`,
 * e.g. `keyword`, `attr-name`). The special `default` key colours text that
 * carries no token type. Unknown token types fall back to `default`.
 */
export type HighlightTheme = Record<string, string>;
/**
 * Light palette, harmonised with the GitHub-light diff theme used by
 * `defaultLightThemeVariables` in `styles.ts`.
 */
export declare const defaultLightHighlightTheme: HighlightTheme;
/**
 * Dark palette, tuned to the Dracula-family colours the diff viewer's dark
 * theme already leans on (and what consumers previously paired with
 * `useDarkTheme`).
 */
export declare const defaultDarkHighlightTheme: HighlightTheme;
/**
 * Resolve the colour for a token whose Prism class list is `classNames`
 * (e.g. `["token", "attr-value"]` or `["token", "punctuation", "attr-equals"]`).
 * Picks the most specific class present in the theme, walking from the most
 * specific class back toward the generic ones; falls back to `default`.
 */
export declare const resolveTokenColor: (theme: HighlightTheme, classNames: readonly string[]) => string;
