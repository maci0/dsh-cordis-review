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
  assert.equal(parsed.data['description'], 'First line of the description continues on the next line.')
  assert.equal(parsed.data['argument-hint'], '[path]')
  assert.equal(parsed.data['license'], 'MIT')
  assert.equal(parsed.body, '\n# CORDIS review\n\nBody text.')
})

test('bundled skill is discoverable and user-invocable', async () => {
  const skills = await discoverSkills(skillsDir)
  assert.equal(skills.length, 1)
  const skill = skills[0]
  assert.ok(skill)
  assert.equal(skill.name, 'cordis-review')
  assert.match(skill.description, /CORDIS/)
  assert.match(skill.content, /arXiv:2608\.25512/)
  assert.equal(skill.metadata['argument-hint'], '[path]')

  const provider = createSkillProvider({ skillsDir })
  assert.equal(provider.name, 'cordis-review')
  const listed = await provider.list()
  assert.equal(listed[0]?.rank, BUNDLED_SKILL_RANK)
  assert.deepEqual(listed[0]?.invocation, { modelInvocable: true, userInvocable: true })
})

test('bundled skill carries its own rubric and names the one fetchable URL', async () => {
  const skills = await discoverSkills(skillsDir)
  const skill = skills[0]
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
      '---\nname: bad\ndescription: |\n  literal\n---\nbody\n',
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
