import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { scratch } from './scratch.ts'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts')

function run(...args: string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('cli --help exits 0', () => {
  const result = run('--help')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /--help/)
})

test('cli rejects an unknown flag with one line and a non-zero exit', () => {
  const result = run('--bogus')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown flag "--bogus"/)
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('cli exits non-zero with one line for a root that does not exist', () => {
  const missing = join(scratch, 'dsh-cordis-review-missing-root')
  const result = run(missing)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /no such path:/)
  assert.doesNotMatch(result.stderr, /\n\s+at /)
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('cli rejects a second positional as an extra argument', async () => {
  const dir = await mkdtemp(join(scratch, 'dsh-cordis-review-cli-'))
  try {
    const result = run(dir, dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unexpected extra argument/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cli reports a failing ast-grep scan with its own stderr, exit 2', async () => {
  const dir = await mkdtemp(join(scratch, 'dsh-cordis-review-cli-'))
  try {
    const bin = join(dir, 'bin')
    await mkdir(bin)
    await writeFile(
      join(bin, 'ast-grep'),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ast-grep 0.0.0"; exit 0; fi\necho "rule parse error" >&2\nexit 3\n',
      { mode: 0o755 },
    )
    await writeFile(join(dir, 'index.ts'), 'export const x = 1\n')
    const result = spawnSync(process.execPath, [cli, dir], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` },
    })
    assert.equal(result.status, 2)
    assert.equal(result.stderr, 'cordis-check: ast-grep scan exited 3: rule parse error\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cli scans a root with one covered file and prints findings', async () => {
  const dir = await mkdtemp(join(scratch, 'dsh-cordis-review-cli-'))
  try {
    // No covered source file: a clean exit proves the root was parsed.
    await writeFile(join(dir, 'notes.txt'), 'plain text\n')
    const clean = run(dir)
    assert.equal(clean.stdout, 'cordis-check: clean\n')
    assert.equal(clean.status, 0)

    await writeFile(join(dir, 'index.ts'), 'export function apply(ctx) {\n  ctx.tools.register(() => {})\n}\n')
    const hit = run(dir)
    assert.equal(hit.status, 1)
    assert.match(hit.stdout, /inject:/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the checker step in the cordis-review skill runs on a shipped file with real flags', async () => {
  const packageRoot = join(dirname(cli), '..')
  const skill = await readFile(join(packageRoot, 'skills', 'cordis-review', 'SKILL.md'), 'utf8')
  const step = skill.slice(skill.indexOf('4. **Closed-form pass.**'), skill.indexOf('5. **Audit, then fix.**'))
  const command = /```\n\s*(node [^\n]+)\n\s*```/.exec(step)?.[1]
  assert.ok(command, 'step 4 shows the checker command')
  const [, ...args] = command.split(/\s+/)
  const script = args.find((arg) => !arg.startsWith('-'))
  assert.ok(script)
  // The installed package carries only `files`; `src/` is not among them.
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { files: string[] }
  assert.ok(manifest.files.includes('lib/**/*.js') && script.startsWith('lib/') && script.endsWith('.js'), `${script} ships`)

  const dir = await mkdtemp(join(scratch, 'dsh-cordis-review-cli-'))
  try {
    const run = spawnSync(process.execPath, args.map((arg) => (arg === '[scope]' ? dir : arg)), { cwd: packageRoot, encoding: 'utf8' })
    assert.equal(run.stdout, 'cordis-check: clean\n')
    for (const flag of new Set(step.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? [])) {
      const probe = spawnSync(process.execPath, [join(packageRoot, script), flag, dir], { encoding: 'utf8' })
      assert.doesNotMatch(probe.stderr, /unknown flag/, `${flag} is documented but the CLI rejects it`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
