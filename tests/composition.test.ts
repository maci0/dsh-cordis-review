import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scratch } from './scratch.ts'
import { createSkillProvider } from '../src/skills.ts'
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


test('a partial skill discovery is retried by the real registry after the file is repaired', async () => {
  const root = await mkdtemp(join(scratch, 'skill-retry-'))
  const ctx = new Context()
  const registry = await ctx.plugin(SkillRegistry as never, {} as never)
  try {
    await mkdir(join(root, 'good'))
    await mkdir(join(root, 'repaired'))
    await writeFile(join(root, 'good', 'SKILL.md'), '---\ndescription: usable\n---\nbody\n')
    ctx.skills.registerProvider(() => createSkillProvider({ skillsDir: root }))
    const first = await ctx.skills.snapshot()
    assert.deepEqual(first.skills.map((skill) => skill.name), ['good'])
    assert.equal(first.complete, false, 'a missing file must not become a complete cached catalog')
    await writeFile(join(root, 'repaired', 'SKILL.md'), '---\ndescription: repaired\n---\nbody\n')
    const second = await ctx.skills.snapshot()
    assert.equal(second.complete, true)
    assert.deepEqual(second.skills.map((skill) => skill.name), ['good', 'repaired'])
  } finally {
    await registry.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
