/**
 * YAML-frontmatter reader for the bundled `SKILL.md` files.
 *
 * Built on `yaml`, the parser the harness's own filesystem skill provider
 * uses, so `|`/`|-`/`>-` block scalars and nested maps behave exactly as the
 * registry expects instead of being hand-rolled. The delimiter scan stays
 * local: frontmatter with no closing `---` is not frontmatter, and the body is
 * then the whole source.
 *
 * @module dsh-cordis-review/frontmatter
 */

import { parse as parseYaml } from 'yaml'

/** Parsed frontmatter plus the markdown body that follows it. */
interface Frontmatter {
  /** Frontmatter mapping, values as the YAML parser produced them. */
  readonly data: Readonly<Record<string, unknown>>
  /** Everything after the closing delimiter, or the whole source when absent. */
  readonly body: string
}

const DELIMITER = /^---[ \t]*$/

/**
 * Parse leading YAML frontmatter from a markdown document.
 * @param source - full file contents.
 * @returns the parsed mapping and the remaining body.
 */
export function parseFrontmatter(source: string): Frontmatter {
  const text = source.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)

  if (lines[0] === undefined || !DELIMITER.test(lines[0])) {
    return { data: {}, body: text }
  }

  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (DELIMITER.test(lines[index] ?? '')) {
      closing = index
      break
    }
  }
  if (closing === -1) {
    return { data: {}, body: text }
  }

  const body = lines.slice(closing + 1).join('\n')
  const parsed: unknown = parseYaml(lines.slice(1, closing).join('\n'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    // Empty or non-mapping frontmatter: no keys, but the body still loads.
    return { data: {}, body }
  }

  return { data: parsed as Record<string, unknown>, body }
}
