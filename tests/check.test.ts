import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('python inject via ast-grep when available', async () => {
  await withTree(
    {
      'src/plugin.py': "def apply(ctx):\n    ctx.jobs.run()\n",
    },
    async (root) => {
      const hits = await check(root, { astGrep: true })
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
      const hits = await check(root, { astGrep: true })
      assert.equal(hits.some((h) => h.tag === 'toplevel'), true)
      assert.equal(hits.some((h) => h.tag === 'inject' && h.message.includes('jobs')), true)
      assert.equal(hits.some((h) => h.message.includes('secrets')), false)
      assert.equal(hits.some((h) => h.message.includes('tools')), false)
    },
  )
})

test('astGrep false: covered file warns and takes the LLM fallback', async () => {
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
      try {
        const hits = await check(root, { astGrep: false })
        assert.equal(hits.length, 1)
        assert.equal(hits[0]?.tag, 'inject')
        assert.match(hits[0]?.message ?? '', /LLM fallback/)
        assert.ok(warnings.some((w) => w.includes('warning')))
      } finally {
        process.stderr.write = err
      }
    },
  )
})

test('astGrep true without the binary throws', async () => {
  await withTree({ 'src/a.py': 'x = 1\n' }, async (root) => {
    const path = process.env['PATH'] ?? ''
    process.env['PATH'] = '/nonexistent'
    try {
      await assert.rejects(check(root, { astGrep: true }))
    } finally {
      process.env['PATH'] = path
    }
  })
})

test('zig has no ast-grep grammar: warning plus LLM fallback', async () => {
  await withTree(
    {
      'src/a.zig': 'pub fn apply(ctx: Ctx) void { ctx.tools.register(); }\n',
    },
    async (root) => {
      const hits = await check(root, { astGrep: true })
      assert.equal(hits.length, 1)
      assert.match(hits[0]?.message ?? '', /LLM fallback/)
    },
  )
})

test('polyglot inject via ast-grep kinds and patterns', async () => {
  const files: Record<string, string> = {
    'src/a.go': 'package p\nfunc apply(ctx Ctx) { ctx.Tools.Register() }\n',
    'src/a.rs': 'fn apply(ctx: Ctx) { ctx.tools.register(); }\n',
    'src/a.c': 'void apply(Ctx ctx) { ctx.tools.register(); }\n',
    'src/a.cpp': 'void apply(Ctx* ctx) { ctx->jobs.run(); }\n',
    'src/A.java': 'class A { void apply(Ctx ctx) { ctx.tools.register(); } }\n',
    'src/a.lua': 'function apply(ctx) ctx.jobs.run() end\n',
    'src/a.swift': 'func apply(ctx: Ctx) { ctx.jobs.run() }\n',
    'src/a.scala': 'def apply(ctx: Ctx) = ctx.jobs.run()\n',
    'src/a.dart': 'void apply(Ctx ctx) { ctx.jobs.run(); }\n',
  }
  await withTree(files, async (root) => {
    const hits = await check(root, { astGrep: true })
    const langs = new Set(hits.filter((h) => h.tag === 'inject').map((h) => h.file.split('.').pop()))
    for (const ext of ['go', 'rs', 'c', 'cpp', 'java', 'lua', 'swift', 'scala', 'dart']) {
      assert.ok(langs.has(ext), ext)
    }
  })
})

test('non-TS: bare calls and underscore members are locals', async () => {
  const files: Record<string, string> = {
    'src/a.py': 'def apply(ctx):\n    ctx.snapshot()\n    ctx._undos.append(1)\n    ctx.do_thing()\n    ctx.jobs.run()\n',
    'src/a.c': 'void apply(Ctx ctx) {\n    ctx.snapshot();\n    ctx.jobs.run();\n}\n',
    'src/a.cpp': 'void apply(Ctx* ctx) {\n    ctx->snapshot();\n    ctx->jobs->run();\n}\n',
    'src/a.rs': 'fn apply(ctx: Ctx) {\n    ctx.snapshot();\n    ctx.jobs.run();\n}\n',
    'src/A.java': 'class A { void apply(Ctx ctx) { ctx.snapshot(); ctx.jobs.run(); } }\n',
    'src/a.lua': 'function lonely() ctx.snapshot() end\nfunction apply(ctx) ctx.jobs.run() end\n',
    'src/a.swift': 'func apply(ctx: Ctx) { ctx.jobs.run() }\n',
  }
  await withTree(files, async (root) => {
    const hits = await check(root, { astGrep: true })
    assert.equal(hits.filter((h) => h.tag === 'inject').length, 7)
    assert.ok(hits.every((h) => h.message.includes('jobs')))
  })
})

test('skips generated and vendored dirs', async () => {
  const files: Record<string, string> = {
    'src/real.ts': 'export function apply(ctx) {\n  ctx.effect(() => () => {})\n}\n',
    'node_modules/pkg/viol.ts': 'export default class S {}\nexport function apply() {}\n',
    '.next/cache/viol.ts': 'export default class S {}\nexport function apply() {}\n',
    '.venv/viol.py': 'ctx.effect()\n',
    'target/viol.rs': 'fn f(ctx: Ctx) { ctx.jobs.run(); }\n',
  }
  await withTree(files, async (root) => {
    const hits = await check(root, { astGrep: true })
    assert.deepEqual(hits, [])
  })
})

test('toplevel: braces in strings and comments do not corrupt depth', async () => {
  await withTree(
    {
      'src/a.py': 's = "{"\nctx.effect()\n',
      'src/b.ts': 'export function apply(ctx) {\n  ctx.tools.register(() => {})\n}\n// }\nctx.effect(() => () => {})\n',
      'src/c.lua': 'function apply(ctx) ctx.jobs.run() end\nctx.effect()\n',
    },
    async (root) => {
      const hits = await check(root, { astGrep: true })
      const tops = hits.filter((h) => h.tag === 'toplevel').map((h) => `${h.file}:${h.line}`)
      assert.deepEqual(tops, ['src/a.py:2', 'src/b.ts:5', 'src/c.lua:2'])
    },
  )
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
