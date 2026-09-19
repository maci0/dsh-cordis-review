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

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { createSkillProvider } from './skills.ts'

/** Plugin name as it appears in the loader. */
export const name = 'cordis-review'

/**
 * Mount the plugin.
 * @param ctx - the host context.
 */
export function apply(ctx: Context): void {
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
  const warn = (message: string): void => {
    console.warn(`[cordis-review] ${message}`)
  }

  ctx.inject(['skills'], (scope) => {
    scope.skills.registerProvider(() => createSkillProvider({ skillsDir, onWarn: warn }))
  })
}
