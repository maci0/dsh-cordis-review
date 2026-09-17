#!/usr/bin/env node
/**
 * `cordis-review-check [options] [root]` — print closed-form CORDIS tags.
 *
 * One engine (ast-grep) for every tag; without the binary (or for Zig, which
 * has no grammar) each file warns on stderr and yields an LLM-fallback hit.
 * The flags reach the two `CheckOptions` knobs the review protocol names:
 * `--grammar-config <path>` forwards an `sgconfig.yml` registering custom
 * grammars, and `--ast-grep` / `--no-ast-grep` force the engine on or off.
 *
 * @module dsh-cordis-review/cli
 */
export {};
