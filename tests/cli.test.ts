import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
  const missing = join(tmpdir(), 'dsh-cordis-review-missing-root')
  const result = run(missing)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /no such path:/)
  assert.doesNotMatch(result.stderr, /\n\s+at /)
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('cli rejects a second positional as an extra argument', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cordis-review-cli-'))
  try {
    const result = run(dir, dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unexpected extra argument/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cli scans a root with one covered file and prints findings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cordis-review-cli-'))
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
