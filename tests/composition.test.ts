import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { HostContext } from '../src/host.ts'
import * as plugin from '../src/index.ts'

test('a real cordis composition mounts the bundled skill and disposes it', async () => {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)

  const fiber = await ctx.plugin({
    name: plugin.name,
    apply: (scope) => plugin.apply(scope as unknown as HostContext),
  })

  const summaries = await ctx.skills.list()
  assert.deepEqual(summaries.map((summary) => summary.name), ['cordis-review'])
  assert.match(summaries[0]?.description ?? '', /CORDIS/)

  const loaded = await ctx.skills.get('cordis-review')
  assert.ok(loaded)
  assert.match(loaded.content, /## Checklist/)
  assert.equal(loaded.provider, 'cordis-review')

  await fiber.dispose()
  assert.deepEqual(await ctx.skills.list(), [])
})
