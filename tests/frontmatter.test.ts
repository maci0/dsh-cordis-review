/**
 * Regression table: the flat reader may only claim a frontmatter block whose
 * value is provably what `yaml` produces. Each case pins one divergence an
 * adversarial verifier found in the earlier fast path — a CRLF block that threw
 * and got the whole skill silently skipped, `+` keep chomping, duplicate keys,
 * typed plain scalars, `a: b`, quoted/flow/`__proto__` keys — with the real
 * `yaml` parser as the oracle for data and body.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parseFrontmatter, parseFrontmatterWithYaml } from '../src/frontmatter.ts'
import { createSkillProvider, discoverSkills } from '../src/skills.ts'

/**
 * The block the real parser would be handed for one source: BOM stripped, CRLF
 * normalized, delimiters located. `undefined` when the source has no delimited
 * frontmatter.
 */
const oracleBlock = (source: string): string | undefined => {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source
  const lines = text.split(/\r\n?|\n/).map((line) => line.endsWith('\r') ? line.slice(0, -1) : line)
  if (lines[0]?.trimEnd() !== '---') return undefined
  const close = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line))
  if (close === -1) return undefined
  return lines.slice(1, close).join('\n')
}

/** One adversarial case: a source and the divergence it used to expose. */
interface Case {
  readonly what: string
  /** The block without delimiters, for the duplicate-key and `a: b` throw checks. */
  readonly block: string
  readonly source: string
}

const CASES: readonly Case[] = [
  { what: 'CRLF frontmatter', block: 'name: a\r\ndescription: b', source: '---\r\nname: a\r\ndescription: b\r\n---\r\nbody\r\n' },
  { what: 'keep-chomped literal block', block: 'description: |+\n  a\n\n\n', source: '---\ndescription: |+\n  a\n\n\n---\nbody\n' },
  { what: 'keep-chomped folded block', block: 'description: >+\n  a\n  b\n\n', source: '---\ndescription: >+\n  a\n  b\n\n---\nbody\n' },
  { what: 'duplicate key', block: 'name: a\nname: b', source: '---\nname: a\nname: b\n---\nbody\n' },
  { what: 'typed hex scalar', block: 'v: 0x10', source: '---\nv: 0x10\n---\nbody\n' },
  { what: 'typed octal scalar', block: 'v: 0o17', source: '---\nv: 0o17\n---\nbody\n' },
  { what: 'typed infinity scalar', block: 'v: .inf', source: '---\nv: .inf\n---\nbody\n' },
  { what: 'typed NaN scalar', block: 'v: .nan', source: '---\nv: .nan\n---\nbody\n' },
  { what: 'nested mapping in a value', block: 'description: a: b', source: '---\ndescription: a: b\n---\nbody\n' },
  { what: 'quoted key', block: "'qk': v", source: "---\n'qk': v\n---\nbody\n" },
  { what: 'unclosed flow mapping', block: '{a: 1}', source: '---\n{a: 1}\n---\nbody\n' },
  { what: '`__proto__` key', block: '__proto__: x', source: '---\n__proto__: x\n---\nbody\n' },
  { what: 'nested map', block: 'name: a\nprovider:\n  owner: cordis\n  tags:\n    - review', source: '---\nname: a\nprovider:\n  owner: cordis\n  tags:\n    - review\n---\nbody\n' },
  { what: 'list value', block: 'name: a\ntags:\n  - one\n  - two', source: '---\nname: a\ntags:\n  - one\n  - two\n---\nbody\n' },
  { what: 'tab-indented block body', block: 'description: |\n\ta', source: '---\ndescription: |\n\ta\n---\nbody\n' },
  { what: 'tab-indented block body after spaces', block: 'description: |\n\t  a', source: '---\ndescription: |\n\t  a\n---\nbody\n' },
  { what: 'at-sign indicator key', block: '@a: v', source: '---\n@a: v\n---\nbody\n' },
  { what: 'block indicator key', block: '|a: v', source: '---\n|a: v\n---\nbody\n' },
  { what: 'anchor indicator key', block: '&a: v', source: '---\n&a: v\n---\nbody\n' },
  { what: 'typed hex key', block: '0x10: v', source: '---\n0x10: v\n---\nbody\n' },
  { what: 'typed leading-zero key', block: '01: v', source: '---\n01: v\n---\nbody\n' },
  { what: 'flow-sequence key', block: '[a]: v', source: '---\n[a]: v\n---\nbody\n' },
  { what: 'keep chomp with indent digit', block: 'description: |+2\n  a\n\n\n', source: '---\ndescription: |+2\n  a\n\n\n---\nbody\n' },
  { what: 'indent digit with keep chomp', block: 'description: |2+\n  a\n\n\n', source: '---\ndescription: |2+\n  a\n\n\n---\nbody\n' },
  { what: 'zero indent indicator', block: 'description: |0\n  a', source: '---\ndescription: |0\n  a\n---\nbody\n' },
  { what: 'non-breaking space in a block scalar indent', block: 'description: |\n \u00A0x', source: '---\ndescription: |\n \u00A0x\n---\nbody\n' },
  { what: 'line separator in a block scalar indent', block: 'description: |\n\u2028x', source: '---\ndescription: |\n\u2028x\n---\nbody\n' },
  { what: 'vertical tab as separation', block: 'name: a\nv:\u000Bx', source: '---\nname: a\nv:\u000Bx\n---\nbody\n' },
  { what: 'form feed as separation', block: 'name: a\nv:\u000Cx', source: '---\nname: a\nv:\u000Cx\n---\nbody\n' },
  { what: 'leading blank lines', block: 'name: a\ndescription: b', source: '\n\n---\nname: a\ndescription: b\n---\nbody\n' },
  { what: '`---` inside a value', block: 'name: a\nwhenToUse: see --- above', source: '---\nname: a\nwhenToUse: see --- above\n---\nbody\n' },
  { what: 'empty block', block: '', source: '---\n---\nbody\n' },
  { what: 'blank block', block: '\n', source: '---\n\n---\nbody\n' },
  { what: 'BOM', block: 'name: a\ndescription: b', source: '\uFEFF---\nname: a\ndescription: b\n---\nbody\n' },
  { what: 'unclosed frontmatter', block: '---\nname: a\ndescription: b\n', source: '---\nname: a\ndescription: b\n' },
  { what: 'delimiter with no body break', block: 'name: a', source: '---\nname: a\n---' },
  { what: 'trailing space on the delimiter', block: 'name: a', source: '---\nname: a\n--- \nbody\n' },
  { what: 'no frontmatter at all', block: '---', source: 'body only\n' },
  {
    what: 'typed scalars table',
    block: 'a: 1\nb: -1\nc: 1.5\nd: 1e3\ne: 0\nf: 007\ng: +5\nh: 1_000\ni: .5\nj: 1.\nk: -0',
    source: '---\na: 1\nb: -1\nc: 1.5\nd: 1e3\ne: 0\nf: 007\ng: +5\nh: 1_000\ni: .5\nj: 1.\nk: -0\n---\nbody\n',
  },
]

for (const { what, source } of CASES) {
  test(`frontmatter regression: ${what}`, async () => {
    const block = oracleBlock(source)
    let expected: Record<string, unknown> = {}
    let threw = false
    try {
      const parsed: unknown = parseYaml(block ?? '')
      expected = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      threw = true
    }

    let fast
    try {
      fast = parseFrontmatter(source)
    } catch (error) {
      assert.fail(`${what}: the fast reader threw where yaml did not: ${(error as Error).message}`)
    }

    if (threw) {
      // `yaml` rejects this block; the fast reader must refuse it, and its
      // caller's fallback must raise the same error.
      assert.equal(fast, undefined, `${what}: fast reader claimed a block yaml rejects`)
      await assert.rejects(parseFrontmatterWithYaml(source), `${what}: the fallback swallowed yaml's error`)
      return
    }

    if (fast !== undefined) {
      assert.deepStrictEqual(fast.data, expected, `${what}: fast data diverged from yaml`)
      const withYaml = await parseFrontmatterWithYaml(source)
      assert.deepStrictEqual(withYaml.data, expected, `${what}: yaml fallback data diverged`)
      assert.deepStrictEqual(fast.body, withYaml.body, `${what}: fast body diverged from yaml`)
    } else {
      const withYaml = await parseFrontmatterWithYaml(source)
      assert.deepStrictEqual(withYaml.data, expected, `${what}: refused and the fallback diverged`)
    }
  })
}

test('a lone CR is not a delimiter, as before the fast path', async () => {
  const source = '---\rname: a\r---\rbody\r'
  assert.equal(parseFrontmatter(source), undefined, 'lone CR must not be read as frontmatter')
  const withYaml = await parseFrontmatterWithYaml(source)
  assert.deepStrictEqual(withYaml.data, {})
  assert.equal(withYaml.body, source)
})

test('yaml throws where the fast reader used to guess: duplicate key, `a: b`, tab indent', () => {
  const throwing = CASES.filter((entry) => /duplicate key|nested mapping in a value|tab-indented block body$/.test(entry.what))
  assert.equal(throwing.length, 3)
  for (const { what, block } of throwing) {
    assert.throws(() => parseYaml(block), `${what}: oracle did not throw`)
    assert.equal(parseFrontmatter(`---\n${block}\n---\nbody\n`), undefined, `${what}: fast reader claimed it`)
  }
})

test('unclosed flow mapping parses to the map yaml builds, not to two strings', async () => {
  const source = '---\n{a: 1}\n---\nbody\n'
  assert.deepStrictEqual(parseYaml('{a: 1}'), { a: 1 })
  const fast = parseFrontmatter(source)
  if (fast !== undefined) assert.deepStrictEqual(fast.data, { a: 1 })
  // Whether claimed or refused, the read path must produce yaml's map.
  const read = fast ?? await parseFrontmatterWithYaml(source)
  assert.deepStrictEqual(read.data, { a: 1 })
  assert.equal(read.body, 'body\n')
})

test('a CRLF skill still loads instead of being skipped', async () => {
  const source = '---\r\nname: crlf-skill\r\ndescription: A usable description.\r\n---\r\nbody\r\n'
  const expected = { name: 'crlf-skill', description: 'A usable description.' }
  assert.deepStrictEqual(parseYaml(oracleBlock(source) as string), expected)

  const fast = parseFrontmatter(source)
  if (fast !== undefined) assert.deepStrictEqual(fast.data, expected)
  // The fixed delimiter scan reads CRLF too, so the fallback never throws.
  const withYaml = await parseFrontmatterWithYaml(source)
  assert.deepStrictEqual(withYaml.data, expected)
  // The pre-change reader split on `\r?\n` and joined with `\n`, so a CRLF
  // body arrives LF-normalized.
  assert.equal(withYaml.body, 'body\n')

  const dir = await mkdtemp(join(tmpdir(), 'dsh-cordis-frontmatter-'))
  try {
    await mkdir(join(dir, 'crlf-skill'))
    await writeFile(join(dir, 'crlf-skill', 'SKILL.md'), source)
    const warnings: string[] = []
    const skills = await discoverSkills(dir, (message) => warnings.push(message))
    assert.deepEqual(skills.map((skill) => skill.name), ['crlf-skill'])
    assert.deepEqual(warnings, [])

    const provider = createSkillProvider({ skillsDir: dir })
    const listed = await provider.list()
    assert.deepEqual(listed.map((skill) => skill.name), ['crlf-skill'])
    const loaded = await provider.get(listed[0] as never)
    assert.ok(loaded, 'the CRLF skill was skipped end-to-end')
    assert.equal(loaded.name, 'crlf-skill')
    assert.equal(loaded.description, 'A usable description.')
    assert.equal(loaded.content, 'body')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
