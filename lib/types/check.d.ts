/**
 * Deterministic CORDIS tags, converged on one engine: ast-grep.
 *
 * Every tag (`mix-export`, `inject`, `toplevel`, `id`) is an ast-grep query.
 * The engine is auto-detected: when the binary is missing, every covered file
 * warns on stderr and yields an LLM-fallback handoff in the message (the
 * review agent reads the message and judges the file).
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
/**
 * Scan `root` for the closed-form tags.
 * @param root - workspace (or subdirectory) to walk.
 */
export declare function check(root: string): Promise<readonly Finding[]>;
