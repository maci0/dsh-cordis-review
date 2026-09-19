/**
 * Frontmatter reader for the bundled `SKILL.md` files.
 *
 * Almost every skill header is flat: `key: value`, a quoted scalar, or a
 * `|`/`>` block of same-indent lines. A local reader handles that subset and
 * changes nothing; it returns `undefined` the moment the block contains
 * anything it cannot prove it understood — a nested map, a list, a quoted
 * scalar with an escape, a more-indented or empty line inside a block scalar,
 * a flow collection, a YAML-tag indicator. The caller then loads `yaml`
 * dynamically and re-parses that one file, so the fallback stays the contract
 * and a static `import('yaml')` no longer costs every boot ~11ms of CPU for a
 * mapping it never needed.
 *
 * The fast path may only claim a block whose value is *provably* what `yaml`
 * produces. Anything it cannot prove — a `\r` anywhere in the source, a quoted
 * key, a duplicate key, a `#` in a value, a scalar that has a typed YAML form
 * (`0x10`, `0o17`, `.inf`, `.nan`, `1_000`, `+5`, `-0`, leading zeros), a
 * `+` keep-chomped block scalar — is refused and re-parsed by `yaml`. A false
 * refusal costs one dynamic import; a false claim silently diverges.
 *
 * The delimiter scan stays local: frontmatter with no closing `---` is not
 * frontmatter, and the body is then the whole source.
 *
 * @module dsh-cordis-review/frontmatter
 */
/** `key: value` at column zero, with nothing but horizontal space around the colon. */
const ENTRY = /^([^\s:#][^\s:#]*?)[ \t]*:([ \t]+[^\r\n]*|)$/;
/** A plain scalar with no leading indicator, no `#`, no `: ` mapping, no reserved start. */
const PLAIN = /^[^\s!&*\-?{}[\],#|>@`"'%:][^#:]*$/;
/** A double-quoted scalar with no backslash escape in it. */
const SIMPLE_DOUBLE = /^[^\\]*$/;
/** A single-quoted scalar with no `''` escape in it. */
const SIMPLE_SINGLE = /^[^']*$/;
/** The block scalar header this reader reads: style plus an optional strip flag. */
const BLOCK_HEADER = /^([|>])(-)?$/;
/** A plain scalar YAML types as an integer: `0x10`, `0o17`, `+5`, `-0`, `007`, `1_000`. */
const TYPED_INT = /^[-+]?(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|[0-9][0-9_]*)$/;
/** A plain scalar YAML types as a special float: `.inf`, `.nan`, either sign, any case. */
const TYPED_SPECIAL = /^[-+]?\.(?:inf|nan)$/i;
/** A plain scalar YAML types as a float: a leading `+`, leading zeros, a `.5`/`1.` body. */
const TYPED_FLOAT = /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*|[-+]?\.[0-9][0-9_]*)$/i;
/** The decimal scalars this reader converts itself, with no YAML-only spelling. */
const SAFE_INT = /^-?(?:0|[1-9]\d*)$/;
const SAFE_FLOAT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
/** A key this reader can prove `yaml` resolves to the same string. */
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
/** Code points JS `trim` strips but YAML counts as content: indentation is unprovable. */
const JS_ONLY_SPACE = /[\u000B\u000C\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/;
/** Keys YAML resolves to a non-string: `null` becomes `''` and `True` becomes `'true'`. */
const RESOLVED_KEY = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE)$/;
/** Keys that would not survive `data[key] = value` on an object literal. */
const UNSAFE_KEY = new Set(['__proto__']);
/**
 * Count the spaces a line starts with. YAML indentation is spaces; a tab or a
 * code point JS treats as blank is not this reader's to interpret.
 * @param line - one line of the block.
 * @returns the number of leading spaces.
 */
function leadingSpaces(line) {
    let count = 0;
    while (count < line.length && line.charCodeAt(count) === 32)
        count += 1;
    return count;
}
/**
 * Split a data block into lines.
 * @param text - the data block, already newline-normalized.
 * @returns the lines, `\n`-separated.
 */
function toLines(text) {
    return text.split('\n');
}
/** The closing (and opening) delimiter line, exactly as the pre-change reader tested it. */
const DELIMITER = /^---[ \t]*$/;
/**
 * Split one document into its leading frontmatter block and the body, the way
 * the pre-change reader did: line by line, so the string handed to `yaml` is
 * byte-identical to what it parsed before the fast path existed.
 * @param source - the file's contents.
 * @returns the block, the body, and whether a delimited block was present.
 */
function splitDocument(source) {
    const text = source.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    if (lines[0] === undefined || !DELIMITER.test(lines[0]))
        return { block: '', body: text, present: false };
    let closing = -1;
    for (let index = 1; index < lines.length; index += 1) {
        if (DELIMITER.test(lines[index] ?? '')) {
            closing = index;
            break;
        }
    }
    if (closing === -1)
        return { block: '', body: text, present: false };
    return { block: lines.slice(1, closing).join('\n'), body: lines.slice(closing + 1).join('\n'), present: true };
}
/**
 * Read one block scalar: same-indent lines only, chomping as YAML defines it.
 * @param lines - the block's lines.
 * @param header - index of the `key: >` line.
 * @param headerValue - the `>` / `|-` / `>2+` indicator.
 * @returns the scalar and the index one past the block, or `undefined` when the
 *   block has an explicit or deeper indent, an interior blank line, or no content.
 */
function readBlockScalar(lines, header, headerValue) {
    const style = headerValue[0];
    const modifier = headerValue.slice(1);
    let indent = 0;
    for (const char of modifier) {
        if (char !== '+' && char !== '-')
            indent = char.charCodeAt(0) - 48;
    }
    if (indent === 0) {
        const first = lines[header + 1];
        if (first === undefined || leadingSpaces(first) === 0)
            return undefined;
        indent = leadingSpaces(first);
    }
    if (indent === 0)
        return undefined;
    const firstContent = lines[header + 1];
    // A tab is never block-scalar indentation to YAML; it is a parse error there
    // and would only look like indentation here.
    if (firstContent === undefined || firstContent.charCodeAt(0) === 9)
        return undefined;
    const content = [];
    let index = header + 1;
    let closed = false;
    for (; index < lines.length; index += 1) {
        const line = lines[index];
        if (leadingSpaces(line) < indent) {
            closed = true;
            break;
        }
        if (line.length === indent) {
            // An interior blank line folds differently; only a trailing run may stay.
            if (index + 1 < lines.length && lines[index + 1].length >= indent)
                return undefined;
            content.push('');
            continue;
        }
        if (leadingSpaces(line) > indent)
            return undefined;
        if (line.charCodeAt(indent) === 9)
            return undefined;
        content.push(line.slice(indent, line.length));
    }
    // A block that runs to the end of the document is closed there.
    if (!closed && index >= lines.length)
        closed = true;
    if (!closed)
        return undefined;
    if (content.length === 0)
        return undefined;
    let last = content.length;
    while (last > 0 && content[last - 1] === '')
        last -= 1;
    const kept = content.slice(0, last);
    if (kept.length === 0)
        return undefined;
    const body = style === '|' ? kept.join('\n') : kept.join(' ');
    if (modifier.includes('-'))
        return { value: body, next: index };
    return { value: `${body}\n`, next: index };
}
/**
 * Read one scalar value.
 * @param raw - the value text, right-trimmed.
 * @returns the value, or `undefined` when it needs the real YAML parser.
 */
function readScalar(raw) {
    // A `#` needs YAML's comment rules (one only after whitespace) to read: refuse.
    if (raw.includes('#'))
        return undefined;
    // `.inf` / `.nan` are YAML's special floats, in any case and either sign.
    if (TYPED_SPECIAL.test(raw))
        return undefined;
    if (raw === '' || raw === '~' || raw === 'null' || raw === 'Null' || raw === 'NULL')
        return { value: null };
    if (raw === 'true' || raw === 'True' || raw === 'TRUE')
        return { value: true };
    if (raw === 'false' || raw === 'False' || raw === 'FALSE')
        return { value: false };
    if (/[0-9]/.test(raw)) {
        // A digit anywhere means YAML may type this scalar; only the spellings this
        // reader converts identically may pass, every other form goes to `yaml`.
        if (SAFE_INT.test(raw) || SAFE_FLOAT.test(raw))
            return { value: Number(raw) };
        // Any other exponent spelling is YAML's floatExp, whose mantissa may be
        // `.5`, `1.`, or zero-padded (`01e9`, `00e0`) — none of which this reader
        // converts, so it must not claim the block.
        if (/[eE]/.test(raw))
            return undefined;
        if (TYPED_INT.test(raw) || TYPED_FLOAT.test(raw) || /^[-+]/.test(raw) || raw.includes('_'))
            return undefined;
    }
    const first = raw.charCodeAt(0);
    if (first === 34) {
        if (!SIMPLE_DOUBLE.test(raw.slice(1)))
            return undefined;
        const closing = raw.indexOf('"', 1);
        if (closing === -1 || raw.slice(closing + 1).trim() !== '')
            return undefined;
        return { value: raw.slice(1, closing) };
    }
    if (first === 39) {
        if (!SIMPLE_SINGLE.test(raw.slice(1)))
            return undefined;
        const closing = raw.indexOf("'", 1);
        if (closing === -1 || raw.slice(closing + 1).trim() !== '')
            return undefined;
        return { value: raw.slice(1, closing) };
    }
    if (!PLAIN.test(raw))
        return undefined;
    return { value: raw };
}
/**
 * Read a flat block of `key: value` entries.
 * @param block - the block's own text, `\n`-separated.
 * @returns the mapping, or `undefined` when any line needs the real YAML parser.
 */
function parseFlatBlock(block) {
    // `trim`/`trimStart` in this reader would measure indentation through these
    // and YAML would not: the real parser has to decide.
    if (JS_ONLY_SPACE.test(block))
        return undefined;
    const lines = toLines(block);
    const data = {};
    const seen = new Set();
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line === '' || line.charCodeAt(0) === 35)
            continue;
        const entry = ENTRY.exec(line);
        if (entry === null)
            return undefined;
        const key = entry[1].trimEnd();
        if (key !== entry[1])
            return undefined;
        // Only a key that is provably its own string: that excludes quoted keys,
        // flow keys, keys starting with an indicator (`@a`, `|a`, `[a]`), typed
        // keys (`0x10`), and the words YAML resolves to `null`/`true`/`false`.
        if (!SAFE_KEY.test(key))
            return undefined;
        if (RESOLVED_KEY.test(key))
            return undefined;
        // `yaml` rejects a duplicate key and a `__proto__` key does not survive a
        // plain object assignment; both need the real parser.
        if (seen.has(key) || UNSAFE_KEY.has(key))
            return undefined;
        seen.add(key);
        const raw = entry[2].replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
        if (raw === '') {
            // A value on following lines is a nested map or a sequence.
            const next = lines[index + 1];
            if (next !== undefined && next.trimStart() !== '' && next.charCodeAt(0) !== 35)
                return undefined;
            data[key] = null;
            continue;
        }
        if (raw.charCodeAt(0) === 124 || raw.charCodeAt(0) === 62) {
            // Only clip and strip chomping are read here; `+` keeps every trailing
            // line break, which this line-based reader does not count.
            if (BLOCK_HEADER.exec(raw) === null)
                return undefined;
            const scalar = readBlockScalar(lines, index, raw);
            if (scalar === undefined)
                return undefined;
            data[key] = scalar.value;
            index = scalar.next - 1;
            continue;
        }
        const scalar = readScalar(raw);
        if (scalar === undefined)
            return undefined;
        data[key] = scalar.value;
    }
    return data;
}
/**
 * Parse leading frontmatter from a markdown document, for the flat subset only.
 * @param source - full file contents.
 * @returns the mapping and body, or `undefined` when this file's block needs
 *   the real YAML parser ({@link parseFrontmatterWithYaml}).
 */
export function parseFrontmatter(source) {
    // `\r` is a line break to YAML and not to this reader: hand the whole file,
    // CRLF included, to the real parser instead of claiming the block.
    if (source.includes('\r'))
        return undefined;
    const { block, body, present } = splitDocument(source);
    if (!present)
        return { data: {}, body };
    const data = parseFlatBlock(block);
    if (data === undefined)
        return undefined;
    return { data, body };
}
/**
 * Parse leading frontmatter with the `yaml` parser the harness's own filesystem
 * skill provider uses. Loaded dynamically, so a flat header never pays for it.
 * @param source - full file contents.
 * @returns the parsed mapping and the remaining body.
 */
export async function parseFrontmatterWithYaml(source) {
    const { block, body, present } = splitDocument(source);
    if (!present)
        return { data: {}, body };
    const { parse } = await import('yaml');
    const parsed = parse(block);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        // Empty or non-mapping frontmatter: no keys, but the body still loads.
        return { data: {}, body };
    }
    return { data: parsed, body };
}
