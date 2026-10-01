import { candidatesOf } from './scratch.ts'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import { apply, name } from '../src/index.ts'
import type { createSkillProvider } from '../src/skills.ts'
import { scratch } from './scratch.ts'

/** The provider `apply` registers, at the concrete type this package builds. */
type Provider = ReturnType<typeof createSkillProvider>

interface Captured {
  readonly providers: Provider[]
  readonly injects: string[][]
  dispose: () => void
}

function createHost(): { ctx: Context; captured: Captured } {
  const captured: Captured = { providers: [], injects: [], dispose: () => {} }

  // The mock covers the two calls `apply` makes; the fiber the real
  // `ctx.inject` returns is not part of the behavior under test.
  const inject = ((dependencies: readonly string[], callback: (scope: Context) => void) => {
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
    } as unknown as Context
    callback(scope)
    const dispose = (): void => {
      for (const inner of nested.reverse()) inner()
    }
    captured.dispose = dispose
    return dispose
  }) as unknown as Context['inject']

  // The mock covers the one call `apply` makes; the rest of `Context` is not
  // part of the behavior under test.
  return { ctx: { inject } as unknown as Context, captured }
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

  const listed = candidatesOf(await provider.list())
  assert.deepEqual(
    listed.map((skill) => skill.name),
    ['cordis-doc-review', 'cordis-review'],
  )
  const skill = listed.find((candidate) => candidate.name === 'cordis-review')
  assert.ok(skill)
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

test('a skill discovery warning reaches the host logger, not the console', async () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = await mkdtemp(join(scratch, 'cordis-review-pkg-'))
  const original = console.warn
  const consoleLines: string[] = []
  console.warn = (...args: unknown[]) => { consoleLines.push(args.join(' ')) }
  try {
    await cp(join(packageRoot, 'src'), join(pkg, 'src'), { recursive: true })
    await cp(join(packageRoot, 'skills'), join(pkg, 'skills'), { recursive: true })
    await mkdir(join(pkg, 'skills', 'broken'))
    await symlink(join(packageRoot, 'node_modules'), join(pkg, 'node_modules'), 'dir')
    const copy = await import(pathToFileURL(join(pkg, 'src', 'index.ts')).href) as typeof import('../src/index.ts')

    const logged: string[] = []
    let provider: SkillProvider | undefined
    const scope = {
      logger: { warn: (message: string) => { logged.push(message) } },
      skills: { registerProvider: (create: () => SkillProvider) => { provider = create(); return () => {} } },
    }
    copy.apply({ inject: (_: readonly string[], callback: (inner: unknown) => void) => callback(scope) } as unknown as Context)
    assert.ok(provider)
    candidatesOf(await provider.list({}))

    assert.equal(logged.length, 1)
    assert.match(logged[0] ?? '', /^\[cordis-review\] cannot read .*broken\/SKILL\.md/)
    assert.deepEqual(consoleLines, [])
  } finally {
    console.warn = original
    await rm(pkg, { recursive: true, force: true })
  }
})
