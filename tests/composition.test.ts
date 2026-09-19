import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as plugin from '../src/index.ts'

test('a real cordis composition mounts the bundled skill and disposes it', async () => {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)

  const fiber = await ctx.plugin({
    name: plugin.name,
    apply: (scope) => plugin.apply(scope),
  })

  const summaries = await ctx.skills.list()
  assert.deepEqual(summaries.map((summary) => summary.name), ['cordis-doc-review', 'cordis-review'])
  assert.match(summaries.find((summary) => summary.name === 'cordis-review')?.description ?? '', /CORDIS/)

  const review = await ctx.skills.get('cordis-review')
  assert.ok(review)
  assert.match(review.content, /## Checklist/)
  assert.equal(review.provider, 'cordis-review')

  const docs = await ctx.skills.get('cordis-doc-review')
  assert.ok(docs)
  assert.match(docs.content, /## Review checklist/)
  assert.equal(docs.provider, 'cordis-review')

  await fiber.dispose()
  assert.deepEqual(await ctx.skills.list(), [])
})
