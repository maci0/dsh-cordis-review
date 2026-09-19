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
/** Parsed frontmatter plus the markdown body that follows it. */
export interface Frontmatter {
    /** Frontmatter mapping, values as the YAML parser produced them. */
    readonly data: Readonly<Record<string, unknown>>;
    /** Everything after the closing delimiter, or the whole source when absent. */
    readonly body: string;
}
/**
 * Parse leading frontmatter from a markdown document, for the flat subset only.
 * @param source - full file contents.
 * @returns the mapping and body, or `undefined` when this file's block needs
 *   the real YAML parser ({@link parseFrontmatterWithYaml}).
 */
export declare function parseFrontmatter(source: string): Frontmatter | undefined;
/**
 * Parse leading frontmatter with the `yaml` parser the harness's own filesystem
 * skill provider uses. Loaded dynamically, so a flat header never pays for it.
 * @param source - full file contents.
 * @returns the parsed mapping and the remaining body.
 */
export declare function parseFrontmatterWithYaml(source: string): Promise<Frontmatter>;
