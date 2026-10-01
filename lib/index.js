/**
 * dsh-cordis-review: CORDIS review skills as a DeepSeek Harness plugin.
 *
 * One capability: every bundled `skills/<name>/SKILL.md` becomes a
 * `ctx.skills` provider entry, so each appears as `/<name>` in the composer
 * (DSH's command surface for user-invocable skills). `cordis-review` reviews
 * a codebase against the CORDIS context paradigm (arXiv:2608.25512) and
 * applies the fixes; `cordis-doc-review` writes and repairs the docs.
 *
 * @module dsh-cordis-review
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillProvider } from './skills.js';
/** Plugin name as it appears in the loader. */
export const name = 'cordis-review';
/**
 * Mount the plugin.
 * @param ctx - the host context.
 */
export function apply(ctx) {
    const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
    const warn = (message) => {
        console.warn(`[cordis-review] ${message}`);
    };
    ctx.inject(['skills'], (scope) => {
        scope.skills.registerProvider(() => createSkillProvider({ skillsDir, onWarn: warn }));
    });
}
