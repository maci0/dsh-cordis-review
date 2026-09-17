/**
 * dsh-cordis-review — `/cordis-review` as a DeepSeek Harness plugin.
 *
 * One capability: the bundled `cordis-review` skill becomes a `ctx.skills`
 * provider, so it appears as `/cordis-review` in the composer (DSH's command
 * surface for user-invocable skills). The skill body is the source of truth
 * for reviewing a codebase against the CORDIS context paradigm
 * (arXiv:2608.25512) and applying the applicable fixes.
 *
 * @module dsh-cordis-review
 */
import type { HostContext } from './host.ts';
/** Plugin name as it appears in the loader. */
export declare const name = "cordis-review";
/**
 * Mount the plugin.
 * @param ctx - the host context.
 */
export declare function apply(ctx: HostContext): void;
