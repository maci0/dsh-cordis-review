import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, name } from '../src/index.ts'
import type { HostContext, SkillProviderLike } from '../src/host.ts'

interface Captured {
  readonly providers: SkillProviderLike[]
  readonly injects: string[][]
}

function createHost(): { ctx: HostContext; captured: Captured } {
  const captured: Captured = { providers: [], injects: [] }

  const ctx: HostContext = {
    inject: (dependencies, callback) => {
      captured.injects.push([...dependencies])
      const scope: HostContext = {
        ...ctx,
        skills: {
          registerProvider: (create) => {
            captured.providers.push(create())
            return () => {}
          },
        },
      }
      callback(scope)
      return () => {}
    },
  }

  return { ctx, captured }
}

test('plugin name is the loader id', () => {
  assert.equal(name, 'cordis-review')
})

test('apply registers one skills provider when skills is injected', async () => {
  const { ctx, captured } = createHost()
  apply(ctx)

  assert.deepEqual(captured.injects, [['skills']])
  assert.equal(captured.providers.length, 1)
  const provider = captured.providers[0]
  assert.ok(provider)
  assert.equal(provider.name, 'cordis-review')

  const listed = await provider.list()
  assert.equal(listed.length, 1)
  const skill = listed[0]
  assert.ok(skill)
  assert.equal(skill.name, 'cordis-review')
  assert.equal(skill.invocation.userInvocable, true)
  assert.equal(skill.invocation.modelInvocable, true)
  assert.match(skill.description, /arXiv:2608\.25512/)

  const loaded = await provider.get(skill)
  assert.ok(loaded)
  assert.match(loaded.content, /CORDIS review/)
  assert.match(loaded.content, /implement every applicable fix/)
  assert.match(loaded.content, /Temporal composability/)
  assert.match(loaded.content, /Spatial composability/)
})
