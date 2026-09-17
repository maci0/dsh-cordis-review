import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import { apply, name } from '../src/index.ts'
import type { HostContext } from '../src/host.ts'
import type { createSkillProvider } from '../src/skills.ts'

/** The provider `apply` registers, at the concrete type this package builds. */
type Provider = ReturnType<typeof createSkillProvider>

interface Captured {
  readonly providers: Provider[]
  readonly injects: string[][]
  dispose: () => void
}

function createHost(): { ctx: HostContext; captured: Captured } {
  const captured: Captured = { providers: [], injects: [], dispose: () => {} }

  // The mock covers the two calls `apply` makes; the fiber the real
  // `ctx.inject` returns is not part of the behavior under test.
  const inject = ((dependencies: readonly string[], callback: (scope: HostContext) => void) => {
    captured.injects.push([...dependencies])
    const nested: Array<() => void> = []
    const scope = {
      inject,
      skills: {
        registerProvider: (create: () => SkillProvider) => {
          const provider = create() as Provider
          captured.providers.push(provider)
          const dispose = (): void => {
            const index = captured.providers.indexOf(provider)
            if (index >= 0) captured.providers.splice(index, 1)
          }
          nested.push(dispose)
          return dispose
        },
      },
    } as unknown as HostContext
    callback(scope)
    const dispose = (): void => {
      for (const inner of nested.reverse()) inner()
    }
    captured.dispose = dispose
    return dispose
  }) as unknown as Context['inject']

  return { ctx: { inject }, captured }
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
  assert.match(loaded.content, /Closed-form pass/)

  const stale = await provider.get({ ...skill, name: 'other-skill' })
  assert.equal(stale, undefined)
})

test('dispose of inject removes the skills provider', () => {
  const { ctx, captured } = createHost()
  apply(ctx)
  assert.equal(captured.providers.length, 1)
  captured.dispose()
  assert.equal(captured.providers.length, 0)
})
