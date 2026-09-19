import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check } from '../src/check.ts'

async function withTree(files: Record<string, string>, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cordis-check-'))
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel)
      await mkdir(join(abs, '..'), { recursive: true })
      await writeFile(abs, body)
    }
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('mix-export: default plus named apply', async () => {
  await withTree(
    {
      'src/index.ts': "export default class S {}\nexport function apply() {}\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.equal(hits.some((h) => h.tag === 'mix-export'), true)
    },
  )
})

test('inject: ctx.foo without inject declaration', async () => {
  await withTree(
    {
      'src/index.ts': "export function apply(ctx) {\n  ctx.tools.register(() => {})\n}\n",
    },
    async (root) => {
      const hits = await check(root)
      const hit = hits.find((h) => h.tag === 'inject')
      assert.ok(hit)
      assert.match(hit.message, /tools/)
    },
  )
})

test('inject: declared inject and ctx.get are clean', async () => {
  await withTree(
    {
      'src/index.ts':
        "export const inject = ['tools']\nexport function apply(ctx) {\n  ctx.tools.register(() => {})\n  ctx.get('sessions')\n  ctx.effect(() => () => {})\n}\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.deepEqual(hits, [])
    },
  )
})

test('inject: slots.inject is not Cordis inject', async () => {
  await withTree(
    {
      'src/index.ts':
        "export const inject = ['slots']\nexport function apply(ctx) {\n  ctx.slots.inject('x', () => {})\n  ctx.slots.register(() => {})\n}\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.deepEqual(hits, [])
    },
  )
})

test('inject: ctx.inject widens keys for the callback', async () => {
  await withTree(
    {
      'src/index.ts':
        "export function apply(ctx) {\n  ctx.inject(['skills'], (scope) => {\n    scope.skills.registerProvider(() => ({}))\n  })\n}\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.equal(hits.some((h) => h.tag === 'inject'), false)
    },
  )
})

test('toplevel: ctx.effect at module load', async () => {
  await withTree(
    {
      'src/index.ts': "ctx.effect(() => () => {})\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.equal(hits.some((h) => h.tag === 'toplevel'), true)
    },
  )
})

test('toplevel: a bare register(…) at module load is caught, not inside apply', async () => {
  await withTree(
    {
      'src/bare.ts': 'register("thing", handler)\n',
      'src/scoped.ts': 'export function apply(ctx) {\n  register("thing", handler)\n}\n',
    },
    async (root) => {
      const hits = await check(root)
      const bare = hits.filter((h) => h.tag === 'toplevel')
      assert.equal(bare.length, 1)
      assert.equal(bare[0]?.file, 'src/bare.ts')
    },
  )
})

test('id: duplicate Loader ids across yaml files', async () => {
  await withTree(
    {
      'a/cordis.patch.yml': '- insert:\n    - id: foo\n      name: a\n',
      'b/cordis.local.yml': '- insert:\n    - id: foo\n      name: b\n',
    },
    async (root) => {
      const hits = await check(root)
      const hit = hits.find((h) => h.tag === 'id' && h.message.includes('foo'))
      assert.ok(hit)
      assert.match(hit.message, /first at/)
    },
  )
})

test('skips browser __ModuleLoader__ factories', async () => {
  await withTree(
    {
      'lib/client.js':
        "window.__ModuleLoader__.load({ factory() { function apply(ctx) { ctx.slots.register() } } })\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.deepEqual(hits, [])
    },
  )
})

test('skips node_modules', async () => {
  await withTree(
    {
      'node_modules/x/index.ts': "export default class S {}\nexport function apply() {}\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.deepEqual(hits, [])
    },
  )
})

test('python inject when ast-grep is available', async () => {
  await withTree(
    {
      'src/plugin.py': "def apply(ctx):\n    ctx.jobs.run()\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.equal(hits.some((h) => h.tag === 'inject' && h.message.includes('jobs')), true)
    },
  )
})

test('python inject, comment ignored, declared keys clean', async () => {
  await withTree(
    {
      'src/plugin.py':
        "inject = ['tools']\nctx.effect()\ndef apply(ctx):\n    ctx.tools.register()\n    # ctx.secrets.register()\n    ctx.jobs.run()\n",
    },
    async (root) => {
      const hits = await check(root)
      assert.equal(hits.some((h) => h.tag === 'toplevel'), true)
      assert.equal(hits.some((h) => h.tag === 'inject' && h.message.includes('jobs')), true)
      assert.equal(hits.some((h) => h.message.includes('secrets')), false)
      assert.equal(hits.some((h) => h.message.includes('tools')), false)
    },
  )
})

test('engine missing: covered file warns and takes the LLM fallback', async () => {
  await withTree(
    {
      'src/plugin.py': 'def apply(ctx):\n    ctx.jobs.run()\n',
    },
    async (root) => {
      const warnings: string[] = []
      const err = process.stderr.write
      process.stderr.write = ((chunk: unknown) => {
        warnings.push(String(chunk))
        return true
      }) as typeof process.stderr.write
      const path = process.env['PATH'] ?? ''
      process.env['PATH'] = '/nonexistent'
      try {
        const hits = await check(root)
        assert.equal(hits.length, 1)
        assert.equal(hits[0]?.tag, 'inject')
        assert.match(hits[0]?.message ?? '', /LLM fallback/)
        assert.ok(warnings.some((w) => w.includes('warning')))
      } finally {
        process.stderr.write = err
        process.env['PATH'] = path
      }
    },
  )
})

test('non-TS: bare calls and underscore members are locals', async () => {
  await withTree(
    {
      'src/a.py': 'def apply(ctx):\n    ctx.snapshot()\n    ctx._undos.append(1)\n    ctx.do_thing()\n    ctx.jobs.run()\n',
    },
    async (root) => {
      const hits = await check(root)
      assert.equal(hits.filter((h) => h.tag === 'inject').length, 1)
      assert.ok(hits.every((h) => h.message.includes('jobs')))
    },
  )
})

test('skips generated and vendored dirs', async () => {
  const files: Record<string, string> = {
    'src/real.ts': 'export function apply(ctx) {\n  ctx.effect(() => () => {})\n}\n',
    'node_modules/pkg/viol.ts': 'export default class S {}\nexport function apply() {}\n',
    '.next/cache/viol.ts': 'export default class S {}\nexport function apply() {}\n',
    '.venv/viol.py': 'ctx.effect()\n',
    'target/viol.py': 'ctx.effect()\n',
  }
  await withTree(files, async (root) => {
    const hits = await check(root)
    assert.deepEqual(hits, [])
  })
})

test('toplevel: braces in strings and comments do not corrupt depth', async () => {
  await withTree(
    {
      'src/a.py': 's = "{"\nctx.effect()\n',
      'src/b.ts': 'export function apply(ctx) {\n  ctx.tools.register(() => {})\n}\n// }\nctx.effect(() => () => {})\n',
    },
    async (root) => {
      const hits = await check(root)
      const tops = hits.filter((h) => h.tag === 'toplevel').map((h) => `${h.file}:${h.line}`)
      assert.deepEqual(tops, ['src/a.py:2', 'src/b.ts:5'])
    },
  )
})

/**
 * Work counter for the scan: how many `ast-grep scan` processes one `check()`
 * starts. Deterministic (a count, not a clock) and engine-independent — a
 * shell shim on PATH logs each spawn, so this holds on a machine without
 * ast-grep and on a loaded CI runner alike.
 *
 * The scan groups files by language *before* chunking. Chunking first paid
 * `ceil(files / chunk) × languages` spawns on a mixed tree; this tree has
 * three languages and 300 files, so the pre-fix order cost 18 spawns and the
 * language-first order costs 3. Every spawn re-parses a rule doc and starts a
 * process, and it was ~95% of the scan's retired instructions.
 */
test('shells out once per language, not once per chunk per language', async () => {
  const files: Record<string, string> = {}
  for (let i = 0; i < 120; i += 1) files[`src/t${i}.ts`] = 'export const x = 1\n'
  for (let i = 0; i < 120; i += 1) files[`src/j${i}.js`] = 'export const x = 1\n'
  for (let i = 0; i < 60; i += 1) files[`src/p${i}.py`] = 'inject = []\n'

  await withTree(files, async (root) => {
    const bin = await mkdtemp(join(tmpdir(), 'dsh-cordis-shim-'))
    const log = join(bin, 'spawns.log')
    try {
      await writeFile(
        join(bin, 'ast-grep'),
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ast-grep 0.0.0"; exit 0; fi\nprintf 'scan\\n' >> "${log}"\necho '[]'\n`,
        { mode: 0o755 },
      )
      const path = process.env['PATH'] ?? ''
      process.env['PATH'] = `${bin}:${path}`
      try {
        await check(root)
      } finally {
        process.env['PATH'] = path
      }
      const spawned = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).length
      assert.equal(spawned, 3)
    } finally {
      await rm(bin, { recursive: true, force: true })
    }
  })
})

test('this plugin is clean apart from its two alternative install rows', async () => {
  const { dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const hits = await check(root)
  // cordis.patch.yml vs cordis.local.yml carry the same id by design
  // (alternative installs, never applied together); everything else is clean.
  assert.deepEqual(
    hits.filter((h) => !(h.tag === 'id' && h.message.includes('cordis-review'))),
    [],
  )
})
