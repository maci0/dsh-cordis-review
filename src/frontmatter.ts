/**
 * Minimal YAML-frontmatter reader for the bundled `SKILL.md` files.
 *
 * The plugin deliberately carries no dependencies, and the only frontmatter it
 * must understand is the shape these files use: plain `key: value` pairs, the
 * folded (`>`) block scalar every one of them writes its `description` as, and
 * one optional double-quoted scalar. A block indicator it does not read is
 * refused rather than guessed at; anything richer is left to the skill
 * registry's validation.
 *
 * @module dsh-cordis-review/frontmatter
 */

/** Parsed frontmatter plus the markdown body that follows it. */
export interface Frontmatter {
  /** Scalar frontmatter keys, values already unquoted and folded. */
  readonly data: Readonly<Record<string, string>>
  /** Everything after the closing delimiter, or the whole source when absent. */
  readonly body: string
}

const DELIMITER = /^---[ \t]*$/
const KEY_VALUE = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/

/**
 * Parse leading YAML frontmatter from a markdown document.
 * @param source - full file contents.
 * @returns the scalar keys and the remaining body.
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

  const data: Record<string, string> = {}
  const block = lines.slice(1, closing)
  for (let index = 0; index < block.length; index += 1) {
    const match = KEY_VALUE.exec(block[index] ?? '')
    if (match?.[1] === undefined) continue

    const key = match[1]
    const rawValue = (match[2] ?? '').trim()

    // Only the folded block scalar every bundled `SKILL.md` writes. A literal
    // (`|`) or chomped (`>-`, `|-`) indicator is refused rather than read as a
    // literal string: a wrong description routes worse than a skipped file,
    // and `discoverSkills` reports the refusal and keeps the other skills.
    if (rawValue.startsWith('>') || rawValue.startsWith('|')) {
      if (rawValue !== '>') {
        throw new Error(`unsupported block scalar indicator ${JSON.stringify(rawValue)} for key "${key}"`)
      }
      const folded = readBlockScalar(block, index + 1)
      data[key] = folded.value
      index = folded.lastIndex
      continue
    }

    data[key] = unquote(rawValue)
  }

  return { data, body: lines.slice(closing + 1).join('\n') }
}

interface BlockScalar {
  readonly value: string
  /** Index of the last consumed continuation line. */
  readonly lastIndex: number
}

/**
 * Read one folded (`>`) block scalar starting after its key line.
 * @param lines - the frontmatter lines without delimiters.
 * @param start - index of the first line after the key.
 * @returns the scalar value and the index of its final line.
 */
function readBlockScalar(lines: readonly string[], start: number): BlockScalar {
  const collected: string[] = []
  let indent = -1
  let lastIndex = start - 1

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (trimmed === '') {
      collected.push('')
      lastIndex = index
      continue
    }

    const leading = line.length - line.trimStart().length
    if (indent === -1) {
      // A continuation must be indented past the key; a top-level key ends the block.
      if (leading === 0 && KEY_VALUE.test(line)) break
      indent = leading
    }
    if (leading < indent) break

    collected.push(line.slice(indent))
    lastIndex = index
  }

  // Drop trailing blank lines, then fold.
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()

  return { value: foldLines(collected), lastIndex }
}

/**
 * Fold block-scalar lines the YAML way: lines inside one paragraph join with a
 * single space, a blank line becomes a newline.
 * @param lines - indentation-stripped lines.
 * @returns the folded scalar.
 */
function foldLines(lines: readonly string[]): string {
  const paragraphs: string[] = []
  let current: string[] = []

  const flush = (): void => {
    if (current.length > 0) {
      paragraphs.push(current.join(' '))
      current = []
    }
  }

  for (const line of lines) {
    if (line === '') flush()
    else current.push(line)
  }
  flush()

  return paragraphs.join('\n')
}

/**
 * Remove one layer of matching quotes from a scalar.
 * @param value - raw scalar text.
 * @returns the unquoted value.
 */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}
