/**
 * Deterministic CORDIS tags, converged on one engine: ast-grep.
 *
 * Every tag (`mix-export`, `inject`, `toplevel`, `id`) is an ast-grep query.
 * `CheckOptions.astGrep` forces the engine on (`true`: throw when the binary
 * is missing) or off (`false`: every covered file takes the fallback path);
 * omit to auto-detect. The ast-grep binary ships no Zig grammar, so `.zig`
 * files take the fallback path unless `grammarConfig` registers one: a
 * warning on stderr plus an LLM-fallback handoff in
 * the message (the review agent reads the message and judges the file).
 *
 * @module dsh-cordis-review/check
 */
/** One closed-form hit. */
export interface Finding {
    /** Checklist tag. */
    readonly tag: 'mix-export' | 'inject' | 'toplevel' | 'id';
    /** Path relative to the scan root. */
    readonly file: string;
    /** 1-based line. */
    readonly line: number;
    /** What to change. */
    readonly message: string;
}
/** Options for {@link check}. */
export interface CheckOptions {
    /**
     * Force the engine on (throw when `ast-grep` is missing) or off (every
     * covered file takes the warning + LLM-fallback path). Omit to auto-detect.
     */
    readonly astGrep?: boolean;
    /**
     * Path to an `sgconfig.yml` registering custom grammars (e.g. Zig, C3,
     * Hare — see ast-grep-grammars). Forwarded as `ast-grep scan --config`,
     * enabling `language:` rows the binary does not ship. `.zig` files take
     * the LLM-fallback path unless a config providing a `zig` language is given.
     */
    readonly grammarConfig?: string;
}
/**
 * Scan `root` for the closed-form tags.
 * @param root - workspace (or subdirectory) to walk.
 * @param options - ast-grep on/off/detect.
 */
export declare function check(root: string, options?: CheckOptions): Promise<readonly Finding[]>;
