import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter } from '../src/frontmatter.ts'
import { createSkillProvider, discoverSkills, BUNDLED_SKILL_RANK } from '../src/skills.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = join(packageRoot, 'skills')

test('parseFrontmatter folds block descriptions and keeps the body', () => {
  const parsed = parseFrontmatter(
    [
      '---',
      'name: cordis-review',
      'description: >',
      '  First line of the description',
      '  continues on the next line.',
      'argument-hint: "[path]"',
      'license: MIT',
      '---',
      '',
      '# CORDIS review',
      '',
      'Body text.',
    ].join('\n'),
  )

  assert.equal(parsed.data['name'], 'cordis-review')
  // YAML clip chomping keeps the folded block's final newline; callers trim.
  assert.equal(parsed.data['description'], 'First line of the description continues on the next line.\n')
  assert.equal(parsed.data['argument-hint'], '[path]')
  assert.equal(parsed.data['license'], 'MIT')
  assert.equal(parsed.body, '\n# CORDIS review\n\nBody text.')
})

test('parseFrontmatter reads a literal block scalar and a nested map', () => {
  const parsed = parseFrontmatter(
    [
      '---',
      'name: cordis-review',
      'description: |-',
      '  First line.',
      '  Second line.',
      'provider:',
      '  owner: cordis',
      '  tags:',
      '    - review',
      '    - cordis',
      '---',
      'body',
    ].join('\n'),
  )

  // `|-` keeps the newlines and strips the final one.
  assert.equal(parsed.data['description'], 'First line.\nSecond line.')
  assert.deepEqual(parsed.data['provider'], { owner: 'cordis', tags: ['review', 'cordis'] })
  assert.equal(parsed.body, 'body')
})

test('parseFrontmatter reads a chomped folded scalar', () => {
  const parsed = parseFrontmatter('---\ndescription: >-\n  one\n  two\n---\nbody\n')
  assert.equal(parsed.data['description'], 'one two')
})

test('bundled skills are discoverable and user-invocable', async () => {
  const skills = await discoverSkills(skillsDir)
  assert.deepEqual(
    skills.map((skill) => skill.name),
    ['cordis-doc-review', 'cordis-review'],
  )

  const review = skills.find((skill) => skill.name === 'cordis-review')
  assert.ok(review)
  assert.match(review.description, /CORDIS/)
  assert.match(review.content, /arXiv:2608\.25512/)
  assert.deepEqual(review.metadata, {})
  assert.deepEqual(review.invocation, { modelInvocable: true, userInvocable: true })

  const docs = skills.find((skill) => skill.name === 'cordis-doc-review')
  assert.ok(docs)
  assert.match(docs.description, /documentation/i)
  assert.match(docs.content, /## Review checklist/)
  assert.deepEqual(docs.metadata, {})
  assert.deepEqual(docs.invocation, { modelInvocable: true, userInvocable: true })

  const provider = createSkillProvider({ skillsDir })
  assert.equal(provider.name, 'cordis-review')
  const listed = await provider.list()
  assert.deepEqual(
    listed.map((skill) => skill.name),
    ['cordis-doc-review', 'cordis-review'],
  )
  assert.ok(listed.every((skill) => skill.rank === BUNDLED_SKILL_RANK))
  assert.ok(listed.every((skill) => skill.invocation.modelInvocable && skill.invocation.userInvocable))
})

test('cordis-review carries its own rubric and names the one fetchable URL', async () => {
  const skills = await discoverSkills(skillsDir)
  const skill = skills.find((candidate) => candidate.name === 'cordis-review')
  assert.ok(skill)
  // The rubric must be present locally: it is the source of rules.
  assert.match(skill.content, /## Checklist/)
  assert.match(skill.content, /## What the paper requires/)
  const protocol = skill.content.slice(
    skill.content.indexOf('## Protocol'),
    skill.content.indexOf('## What the paper requires'),
  )
  // If a URL is offered, it must be the abs page — /pdf is rejected by the
  // harness and /html 404s for this submission.
  assert.match(protocol, /https:\/\/arxiv\.org\/abs\/2608\.25512/)
  assert.doesNotMatch(protocol, /arxiv\.org\/(pdf|html)\//)
})

test('frontmatter invocation controls project into the policy booleans', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cordis-review-'))
  try {
    await mkdir(join(dir, 'model-only'))
    await writeFile(
      join(dir, 'model-only', 'SKILL.md'),
      '---\nname: model-only\ndescription: >\n  A usable description.\nuser-invocable: false\n---\nbody\n',
    )
    await mkdir(join(dir, 'user-only'))
    await writeFile(
      join(dir, 'user-only', 'SKILL.md'),
      '---\nname: user-only\ndescription: >\n  A usable description.\nwhenToUse: when the runtime leaks ctx\ndisable-model-invocation: true\n---\nbody\n',
    )
    const provider = createSkillProvider({ skillsDir: dir })
    const listed = await provider.list()
    const modelOnly = listed.find((entry) => entry.name === 'model-only')
    const userOnly = listed.find((entry) => entry.name === 'user-only')
    assert.deepEqual(modelOnly?.invocation, { modelInvocable: true, userInvocable: false })
    assert.deepEqual(userOnly?.invocation, { modelInvocable: false, userInvocable: true })
    assert.equal(userOnly?.whenToUse, 'when the runtime leaks ctx')
    assert.equal(modelOnly?.whenToUse, undefined)
    // Documented keys project into named fields, never into metadata.
    assert.deepEqual(userOnly?.metadata, {})
    assert.ok(userOnly)
    const loaded = await provider.get(userOnly)
    assert.equal(loaded?.whenToUse, 'when the runtime leaks ctx')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('discoverSkills skips a broken sibling and keeps the rest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cordis-review-'))
  try {
    await mkdir(join(dir, 'ok'))
    await writeFile(
      join(dir, 'ok', 'SKILL.md'),
      '---\nname: ok\ndescription: fine\n---\nbody\n',
    )
    await mkdir(join(dir, 'bad'))
    await writeFile(
      join(dir, 'bad', 'SKILL.md'),
      '---\nname: [unterminated\ndescription: fine\n---\nbody\n',
    )
    const warnings: string[] = []
    const skills = await discoverSkills(dir, (message) => warnings.push(message))
    assert.equal(skills.length, 1)
    assert.equal(skills[0]?.name, 'ok')
    assert.equal(warnings.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('list and get settle promptly when the lookup signal is aborted', async () => {
  const provider = createSkillProvider({ skillsDir })
  const controller = new AbortController()
  controller.abort()

  const listed = await provider.list({ signal: controller.signal })
  assert.deepEqual(listed, [])

  const live = await provider.list()
  const candidate = live[0]
  assert.ok(candidate)
  assert.equal(await provider.get(candidate, { signal: controller.signal }), undefined)
})
