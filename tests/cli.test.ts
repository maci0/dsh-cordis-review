import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts')

function run(...args: string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('cli --help lists the checker flags and exits 0', () => {
  const result = run('--help')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /--grammar-config <path>/)
  assert.match(result.stdout, /--ast-grep/)
  assert.match(result.stdout, /--no-ast-grep/)
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

test('cli consumes --grammar-config and --no-ast-grep instead of treating them as the root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cordis-review-cli-'))
  try {
    // No covered source file: the fallback path has nothing to judge, so a
    // clean exit proves both flags were parsed and consumed their values.
    await writeFile(join(dir, 'notes.txt'), 'plain text\n')
    const clean = run('--no-ast-grep', '--grammar-config', join(dir, 'sgconfig.yml'), dir)
    assert.equal(clean.stdout, 'cordis-check: clean\n')
    assert.equal(clean.status, 0)

    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'index.ts'), 'export function apply(ctx) {\n  ctx.tools.register(() => {})\n}\n')
    const hit = run('--no-ast-grep', dir)
    assert.equal(hit.status, 1)
    assert.match(hit.stdout, /inject:/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
