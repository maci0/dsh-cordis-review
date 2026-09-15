/**
 * Deterministic CORDIS tags, converged on one engine: ast-grep.
 *
 * Every tag (`mix-export`, `inject`, `toplevel`, `id`) is an ast-grep query.
 * `CheckOptions.astGrep` forces the engine on (`true`: throw when the binary
 * is missing) or off (`false`: every covered file takes the fallback path);
 * omit to auto-detect. ast-grep has no Zig grammar, so `.zig` files always
 * take the fallback path: a warning on stderr plus an LLM-fallback handoff in
 * the message (the review agent reads the message and judges the file).
 *
 * @module dsh-cordis-review/check
 */

import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

/** One closed-form hit. */
export interface Finding {
  /** Checklist tag. */
  readonly tag: 'mix-export' | 'inject' | 'toplevel' | 'id'
  /** Path relative to the scan root. */
  readonly file: string
  /** 1-based line. */
  readonly line: number
  /** What to change. */
  readonly message: string
}

/** Options for {@link check}. */
export interface CheckOptions {
  /**
   * Force the engine on (throw when `ast-grep` is missing) or off (every
   * covered file takes the warning + LLM-fallback path). Omit to auto-detect.
   */
  readonly astGrep?: boolean
}

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.dsh-module-fallback',
  'outputs',
  '__pycache__',
  '.venv',
  'zig-out',
  'zig-pkg',
  '.zig-cache',
  'target',
  'vendor',
  'build',
])

const SCRIPT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const YAML = new Set(['.yml', '.yaml'])
const POLYGLOT = new Set(['.py', '.pyi', '.go', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.java', '.rs'])
/** Extensions whose text is read before scanning (only to skip browser bundles). */
const SKIPPABLE = new Set(['.js', '.jsx', '.mjs', '.cjs'])

/** Mixed onto every Cordis `ctx` — not services. */
const CTX_INTRINSICS = new Set([
  'accessor',
  'bail',
  'baseUrl',
  'effect',
  'emit',
  'events',
  'fiber',
  'get',
  'inject',
  'logger',
  'mixin',
  'on',
  'once',
  'parallel',
  'plugin',
  'provide',
  'reflect',
  'registry',
  'root',
  'runtime',
  'serial',
  'set',
  'waterfall',
])

const CTX_ALIAS = /^(ctx|scope|hostCtx|context)$/
const TOPLEVEL_VERB = /^(effect|on|set|plugin|register)/
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One ast-grep `scan` rule: one engine spawn covers every file of these languages. */
interface SgRule {
  readonly id: string
  readonly language: string
  readonly pattern?: string
  readonly kind?: string
  /** Matches whose text starts with this (with `kind`): bare calls like `register(`. */
  readonly textPrefix?: string
  readonly notInside?: readonly string[]
}

/**
 * Single multi-language rule document. Rule order is load-bearing only for
 * readability — matches carry ruleId, so evaluation order never changes output.
 * Keep the member/call/toplevel triple together per family when adding rules.
 */
function sgRulesDoc(): string {
  const rules: SgRule[] = [
    // yaml ids
    { id: 'u-id', language: 'yaml', pattern: 'id: $ID' },
    // JS/TS mix-export
    { id: 'u-def', language: 'typescript', pattern: 'export default $X' },
    { id: 'u-fn', language: 'typescript', pattern: 'export function $N($$$ARGS) { $$$BODY }' },
    { id: 'u-const', language: 'typescript', pattern: 'export const $N = $V' },
    { id: 'u-const-typed', language: 'typescript', pattern: 'export const $N: $T = $V' },
    { id: 'u-named', language: 'typescript', pattern: 'export { $X }' },
    { id: 'u-def-js', language: 'javascript', pattern: 'export default $X' },
    { id: 'u-fn-js', language: 'javascript', pattern: 'export function $N($$$ARGS) { $$$BODY }' },
    { id: 'u-const-js', language: 'javascript', pattern: 'export const $N = $V' },
    { id: 'u-named-js', language: 'javascript', pattern: 'export { $X }' },
    { id: 'u-def-tsx', language: 'tsx', pattern: 'export default $X' },
    { id: 'u-fn-tsx', language: 'tsx', pattern: 'export function $N($$$ARGS) { $$$BODY }' },
    { id: 'u-const-tsx', language: 'tsx', pattern: 'export const $N = $V' },
    { id: 'u-named-tsx', language: 'tsx', pattern: 'export { $X }' },
    // inject declarations
    { id: 'u-decl', language: 'typescript', pattern: 'export const inject = $V' },
    { id: 'u-decl-bare', language: 'typescript', pattern: 'inject = $V' },
    { id: 'u-decl-js', language: 'javascript', pattern: 'export const inject = $V' },
    { id: 'u-decl-bare-js', language: 'javascript', pattern: 'inject = $V' },
    { id: 'u-decl-tsx', language: 'tsx', pattern: 'export const inject = $V' },
    { id: 'u-decl-bare-tsx', language: 'tsx', pattern: 'inject = $V' },
    { id: 'u-decl-py', language: 'python', pattern: 'inject = $V' },
    // member reads ($C.$K)
    { id: 'm-ts', language: 'typescript', pattern: '$C.$K' },
    { id: 'm-js', language: 'javascript', pattern: '$C.$K' },
    { id: 'm-tsx', language: 'tsx', pattern: '$C.$K' },
    { id: 'm-py', language: 'python', pattern: '$C.$K' },
    { id: 'm-go', language: 'go', kind: 'selector_expression' },
    { id: 'm-c', language: 'c', pattern: '$C.$K' },
    { id: 'm-cpp', language: 'cpp', kind: 'field_expression' },
    { id: 'm-java', language: 'java', kind: 'field_access' },
    { id: 'm-rust', language: 'rust', pattern: '$C.$K' },
    // toplevel-shaped calls at depth 0 via inside-negation.
    // ast-grep `inside` does not see through fn bodies in some grammars
    // (rust `function_item`, go closures), so toplevel also keeps the old
    // brace-depth line pass over these matches — the match set is ast-grep's.
    { id: 't-ts', language: 'typescript', pattern: '$C.$M($$$ARGS)', notInside: ['function_declaration', 'arrow_function', 'function_expression', 'method_definition'] },
    { id: 't-js', language: 'javascript', pattern: '$C.$M($$$ARGS)', notInside: ['function_declaration', 'arrow_function', 'function_expression', 'method_definition'] },
    { id: 't-tsx', language: 'tsx', pattern: '$C.$M($$$ARGS)', notInside: ['function_declaration', 'arrow_function', 'function_expression', 'method_definition'] },
    { id: 't-py', language: 'python', pattern: '$C.$M($$$ARGS)', notInside: ['function_definition', 'lambda'] },
    { id: 't-go', language: 'go', kind: 'call_expression', notInside: ['function_declaration', 'func_literal'] },
    { id: 't-rs', language: 'rust', kind: 'call_expression', notInside: ['function_item'] },
    { id: 't-java', language: 'java', kind: 'method_invocation', notInside: ['method_declaration'] },
    { id: 't-c', language: 'c', kind: 'call_expression', notInside: ['function_definition'] },
    { id: 't-cpp', language: 'cpp', kind: 'call_expression', notInside: ['function_definition'] },
    // bare `register(` — kept parallel to the old per-file query; C/C++ use
    // kind+regex because `register($$$ARGS)` does not parse there
    { id: 't-bare-py', language: 'python', pattern: 'register($$$ARGS)', notInside: ['function_definition', 'lambda'] },
    { id: 't-bare-go', language: 'go', pattern: 'register($$$ARGS)', notInside: ['function_declaration'] },
    { id: 't-bare-rs', language: 'rust', pattern: 'register($$$ARGS)', notInside: ['function_item', 'closure_expression'] },
    { id: 't-bare-java', language: 'java', pattern: 'register($$$ARGS)', notInside: ['method_declaration', 'lambda_expression'] },
    { id: 't-bare-ts', language: 'typescript', pattern: 'register($$$ARGS)', notInside: ['function_declaration', 'arrow_function', 'function_expression', 'method_definition'] },
    { id: 't-bare-js', language: 'javascript', pattern: 'register($$$ARGS)', notInside: ['function_declaration', 'arrow_function', 'function_expression', 'method_definition'] },
    { id: 't-bare-tsx', language: 'tsx', pattern: 'register($$$ARGS)', notInside: ['function_declaration', 'arrow_function', 'function_expression', 'method_definition'] },
    { id: 't-bare-c', language: 'c', kind: 'call_expression', textPrefix: 'register', notInside: ['function_definition'] },
    { id: 't-bare-cpp', language: 'cpp', kind: 'call_expression', textPrefix: 'register', notInside: ['function_definition'] },
    // ctx.get / ctx.inject widening (data for the inject pass)
    { id: 'u-get-ts', language: 'typescript', pattern: '$C.get($$$ARGS)' },
    { id: 'u-get-js', language: 'javascript', pattern: '$C.get($$$ARGS)' },
    { id: 'u-get-tsx', language: 'tsx', pattern: '$C.get($$$ARGS)' },
    { id: 'u-get-py', language: 'python', pattern: '$C.get($$$ARGS)' },
    { id: 'u-inject-ts', language: 'typescript', pattern: '$C.inject($$$ARGS)' },
    { id: 'u-inject-js', language: 'javascript', pattern: '$C.inject($$$ARGS)' },
    { id: 'u-inject-tsx', language: 'tsx', pattern: '$C.inject($$$ARGS)' },
    { id: 'u-inject-py', language: 'python', pattern: '$C.inject($$$ARGS)' },
  ]
  return rules.map((rule) => sgRuleYaml(rule)).join('---\n')
}

function sgRuleYaml(rule: SgRule): string {
  const header = `id: ${rule.id}\nlanguage: ${rule.language}\nrule:\n`
  const base = rule.kind !== undefined ? `kind: ${rule.kind}` : `pattern: ${JSON.stringify(rule.pattern ?? '')}`
  const withText =
    rule.textPrefix !== undefined ? `${base}\n    - regex: ${JSON.stringify(`^${rule.textPrefix}`)}` : base
  if (rule.notInside === undefined && rule.textPrefix === undefined) return `${header}  ${withText}\n`
  const kinds = (rule.notInside ?? []).map((kind) => `            - kind: ${kind}`).join('\n')
  const negate = rule.notInside !== undefined ? `\n    - not:\n        inside:\n          any:\n${kinds}` : ''
  return `${header}  all:\n    - ${withText}${negate}\n`
}

function warn(message: string): void {
  process.stderr.write(`cordis-check: warning: ${message}\n`)
}

function sgOrThrow(rel: string): never {
  throw new Error(`ast-grep failed on ${rel}: fix the binary or rerun without { astGrep: true }.`)
}

/** LLM-fallback handoff: the review agent judges the file against the checklist. */
function llmFallback(ext: string): string {
  return (
    `ast-grep covers no ${ext} grammar here (LLM fallback): judge this file against the CORDIS checklist yourself — ` +
    `ctx.* service reads need inject, module-load effects belong in apply(ctx).`
  )
}

/**
 * Scan `root` for the closed-form tags.
 * @param root - workspace (or subdirectory) to walk.
 * @param options - ast-grep on/off/detect.
 */
export async function check(root: string, options: CheckOptions = {}): Promise<readonly Finding[]> {
  const files = await listFiles(root)
  const detected = astGrepOnPath()
  const wantSg = options.astGrep ?? detected
  if (!detected && options.astGrep !== false) {
    warn('ast-grep not on PATH: every covered file takes the warning + LLM-fallback path. Install ast-grep for deterministic results.')
  }
  if (options.astGrep === true && !detected) {
    throw new Error('ast-grep forced on but not on PATH: install ast-grep or rerun without { astGrep: true }.')
  }

  const covered: string[] = []
  const zig: string[] = []
  for (const abs of files) {
    const rel = relative(root, abs).split('\\').join('/')
    const ext = extname(abs).toLowerCase()
    if (isTestPath(rel)) continue
    if (abs.endsWith('.d.ts')) continue
    if (YAML.has(ext) || SCRIPT.has(ext) || POLYGLOT.has(ext)) {
      const text = SKIPPABLE.has(ext) ? await readFile(abs, 'utf8') : undefined
      if (text !== undefined && text.includes('__ModuleLoader__')) continue
      covered.push(abs)
    } else if (ext === '.zig') {
      zig.push(abs)
    }
  }

  // Single scan spawn for the whole tree; per-file grouping below is just
  // bucketing matches by their `file` field, not more engine calls.
  const raw = wantSg ? sgScanAll(covered) : undefined
  if (raw === undefined && wantSg) {
    const first = covered.length > 0 ? relative(root, covered[0] ?? '').split('\\').join('/') : root
    sgOrThrow(first)
  }
  const byFile = new Map<string, SgHit[]>()
  for (const hit of raw ?? []) {
    const abs = hit.file ?? ''
    const list = byFile.get(abs) ?? []
    list.push(hit)
    byFile.set(abs, list)
  }

  const findings: Finding[] = []
  for (const abs of covered) {
    const rel = relative(root, abs).split('\\').join('/')
    const ext = extname(abs).toLowerCase()
    const hits = byFile.get(abs) ?? []
    if (!wantSg) {
      warn(`${rel}: ast-grep off or unavailable for ${ext}. LLM fallback: judge this file against the CORDIS checklist yourself.`)
      findings.push({ tag: 'inject', file: rel, line: 1, message: llmFallback(ext) })
      continue
    }
    if (YAML.has(ext)) {
      findings.push(...sgIds(rel, hits))
      continue
    }
    if (SCRIPT.has(ext)) {
      const text = await readFile(abs, 'utf8')
      findings.push(...sgScript(rel, hits, text))
      continue
    }
    findings.push(...(await sgPolyglot(rel, hits, abs)))
  }
  for (const abs of zig) {
    const rel = relative(root, abs).split('\\').join('/')
    const ext = extname(abs).toLowerCase()
    warn(`${rel}: no ast-grep grammar for ${ext}. LLM fallback: judge this file against the CORDIS checklist yourself.`)
    findings.push({ tag: 'inject', file: rel, line: 1, message: llmFallback(ext) })
  }

  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.tag.localeCompare(b.tag))
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const abs = join(entry.parentPath, entry.name)
    const rel = relative(root, abs).split('\\').join('/')
    if (rel.split('/').some((part) => SKIP_DIR.has(part))) continue
    out.push(abs)
  }
  return out
}

function astGrepOnPath(): boolean {
  const which = spawnSync('ast-grep', ['--version'], { encoding: 'utf8' })
  return which.status === 0
}

function isTestPath(rel: string): boolean {
  if (rel.startsWith('tests/') || rel.startsWith('test/') || rel.includes('/tests/') || rel.includes('/test/')) return true
  const base = rel.split('/').pop() ?? ''
  return (
    /\.(?:test|spec)\.[^.]+$/.test(base)
    || /^test_/.test(base)
    || /_(?:test|spec)\.[^.]+$/.test(base)
    || /Test\.[^.]+$/.test(base)
  )
}

interface SgHit {
  readonly text?: string
  readonly file?: string
  readonly ruleId?: string
  readonly range?: { readonly start?: { readonly line?: number } }
  readonly metaVariables?: { readonly single?: Record<string, { readonly text?: string }> }
}

/** One `ast-grep scan` spawn over every covered file: hits, [] on no match, undefined on engine failure. */
function sgScanAll(files: readonly string[]): SgHit[] | undefined {
  if (files.length === 0) return []
  const result = spawnSync('ast-grep', ['scan', '--inline-rules', sgRulesDoc(), '--json', ...files], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0) return undefined
  const stdout = result.stdout.trim()
  if (stdout === '') return []
  try {
    const parsed = JSON.parse(stdout) as unknown
    if (Array.isArray(parsed)) return parsed as SgHit[]
  } catch {
    return undefined
  }
  return undefined
}

function meta(hit: SgHit, name: string): string {
  return (hit.metaVariables?.single?.[name]?.text ?? '').trim()
}

function lineOf(hit: SgHit): number {
  return (hit.range?.start?.line ?? 0) + 1
}

function injectMessage(key: string): string {
  return `ctx.${key} without inject: ['${key}']. Declare it, or read optional services with ctx.get('${key}').`
}

function memberKeyFromText(text: string): { alias: string; key: string } | undefined {
  const match = /(?:^|[^\w])(ctx|scope|hostCtx|context)\s*(?:\.|->)\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(` ${text}`)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  return { alias: match[1], key: match[2] }
}

function keysFromValue(value: string): string[] {
  const out: string[] = []
  for (const part of value.replace(/^\s*[[{]/, '').replace(/[\]}]\s*$/, '').split(',')) {
    const token = part.trim().replace(/^['"`]|['"`]$/g, '')
    if (IDENT.test(token)) out.push(token)
  }
  return out
}

function hitsFor(hits: readonly SgHit[], ...ids: readonly string[]): SgHit[] {
  const wanted = new Set(ids)
  return hits.filter((hit) => hit.ruleId !== undefined && wanted.has(hit.ruleId))
}

function sgIds(rel: string, hits: readonly SgHit[]): Finding[] {
  const seen = new Map<string, number>()
  const findings: Finding[] = []
  for (const hit of hitsFor(hits, 'u-id')) {
    const id = meta(hit, 'ID').replace(/^['"`]|['"`]$/g, '')
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) continue
    const line = lineOf(hit)
    const prev = seen.get(id)
    if (prev !== undefined) {
      findings.push({
        tag: 'id',
        file: rel,
        line,
        message: `duplicate Loader id "${id}" (first at line ${prev}). insert does not dedupe.`,
      })
    } else {
      seen.set(id, line)
    }
  }
  return findings
}

/** Declared inject keys, read as data from `inject = [...]` matches. */
function declaredKeys(hits: readonly SgHit[]): Set<string> {
  const out = new Set<string>()
  for (const hit of hitsFor(hits, 'u-decl', 'u-decl-bare', 'u-decl-js', 'u-decl-bare-js', 'u-decl-tsx', 'u-decl-bare-tsx', 'u-decl-py')) {
    for (const key of keysFromValue(meta(hit, 'V'))) out.add(key)
  }
  return out
}

/**
 * `ctx.inject([...], scope => …)` widens the alias set: the callback's first
 * parameter carries the declared keys for its body lines.
 */
function injectWidens(hits: readonly SgHit[]): Map<number, { alias: string; keys: readonly string[] }> {
  const widens = new Map<number, { alias: string; keys: readonly string[] }>()
  for (const hit of hitsFor(hits, 'u-inject-ts', 'u-inject-js', 'u-inject-tsx', 'u-inject-py')) {
    const text = hit.text ?? ''
    const keys = keysFromValue(/\[([^\]]*)\]/.exec(text)?.[1] ?? '')
    const alias = /\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,)]/.exec(text)?.[1]
    if (alias === undefined || keys.length === 0) continue
    widens.set(lineOf(hit), { alias, keys })
  }
  return widens
}

/** `ctx.get('key')` / `scope.get('key')` reads that never need inject. */
function getReads(hits: readonly SgHit[]): Set<string> {
  const reads = new Set<string>()
  for (const hit of hitsFor(hits, 'u-get-ts', 'u-get-js', 'u-get-tsx', 'u-get-py')) {
    const arg = /\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/.exec(hit.text ?? '')?.[1]
    if (arg !== undefined) reads.add(`${lineOf(hit)}:${arg}`)
  }
  return reads
}

function sgScript(rel: string, hits: readonly SgHit[], text: string): Finding[] {
  const findings: Finding[] = []

  const defs = hitsFor(hits, 'u-def', 'u-def-js', 'u-def-tsx')
  if (defs.length > 0) {
    const names = new Set<string>()
    for (const hit of hitsFor(hits, 'u-fn', 'u-fn-js', 'u-fn-tsx', 'u-const', 'u-const-js', 'u-const-tsx', 'u-const-typed', 'u-named', 'u-named-js', 'u-named-tsx')) {
      for (const slot of ['N', 'X'] as const) {
        for (const part of meta(hit, slot).split(',')) {
          const token = part.trim().split(/\s+as\s+/).pop()?.trim() ?? ''
          if (token !== '') names.add(token)
        }
      }
    }
    if (names.has('apply') || names.has('inject')) {
      findings.push({
        tag: 'mix-export',
        file: rel,
        line: 1,
        message: 'default export plus named apply/inject. Loader keeps one form; mixing drops inject. Pick one.',
      })
    }
  }

  return findings.concat(sgMembersAndToplevel(rel, hits, text, 'm-ts', 'm-js', 'm-tsx', 't-ts', 't-js', 't-tsx'))
}

async function sgPolyglot(rel: string, hits: readonly SgHit[], abs: string): Promise<Finding[]> {
  const text = await readFile(abs, 'utf8')
  return sgMembersAndToplevel(rel, hits, text, 'm-py', 'm-go', 'm-c', 'm-cpp', 'm-java', 'm-rust', 't-py')
}

/** Shared inject + toplevel pass over one scan's member/call matches. */
function sgMembersAndToplevel(
  rel: string,
  hits: readonly SgHit[],
  text: string,
  ...ids: readonly string[]
): Finding[] {
  const declared = declaredKeys(hits)
  const widens = injectWidens(hits)
  const reads = getReads(hits)
  const findings: Finding[] = []
  const seen = new Set<string>()

  for (const hit of hitsFor(hits, ...ids.filter((id) => id.startsWith('m-')))) {
    const parsed = memberKeyFromText(hit.text ?? '')
    if (parsed === undefined || !CTX_ALIAS.test(parsed.alias)) continue
    if (!IDENT.test(parsed.key) || CTX_INTRINSICS.has(parsed.key) || declared.has(parsed.key)) continue
    if (reads.has(`${lineOf(hit)}:${parsed.key}`)) continue
    if (widened(widens, lineOf(hit), parsed.alias, parsed.key)) continue
    const id = `${lineOf(hit)}:${parsed.key}`
    if (seen.has(id)) continue
    seen.add(id)
    findings.push({ tag: 'inject', file: rel, line: lineOf(hit), message: injectMessage(parsed.key) })
  }

  const callLines = new Map<number, { recv: string; method: string }>()
  const callIds = ids.filter((id) => id.startsWith('t-'))
  for (const hit of hitsFor(hits, ...callIds)) {
    const text = hit.text ?? ''
    const ruleId = hit.ruleId ?? ''
    // t-bare-*: the whole match is the call; method is its callee name.
    const bareCall = ruleId.startsWith('t-bare-') ? /^register/.exec(text.trim()) !== null : false
    // Recover receiver+method from one match (C++ `ctx->jobs.run` parses
    // with C=`ctx->jobs`; kind-only rules carry no metavariables at all).
    const call = /(?:^|[^\w])(ctx|scope|hostCtx|context)\s*(?:\.|->)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(` ${text}`)
    const bare = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(text)
    // Kind-only matches (go/rust/java/c/cpp) have no receiver info: take the
    // head member (`ctx.jobs.run()` → `ctx.jobs`) and let the depth pass below
    // decide toplevel-ness; the inject pass already judged the key.
    const dotted = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\.|->)\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(text.trim())
    const recv = call?.[1] ?? ''
    const method = call?.[2] ?? (bareCall ? 'register' : (bare?.[1] ?? dotted?.[2] ?? ''))
    if (!IDENT.test(method)) continue
    if (recv === '' && !bareCall && dotted === null) continue
    callLines.set(lineOf(hit), { recv, method })
  }
  // Toplevel = effect-shaped call at brace depth 0 over ast-grep's own call
  // lines — the match set is ast-grep's, not a second engine. Bare
  // `register(…)` has no receiver; `registerX` methods match by prefix.
  // Toplevel = effect-shaped call at brace depth 0. ast-grep patterns cannot
  // see depth, so depth stays a brace scan over ast-grep's own call lines —
  // the match set is ast-grep's, not a second engine. Bare `register(…)`
  // has no receiver; `registerX` methods match TOPLEVEL_VERB by prefix.
  const lines = text.split(/\r?\n/)
  let depth = 0
  for (let index = 0; index < lines.length; index += 1) {
    const call = callLines.get(index + 1)
    if (
      depth === 0 && call !== undefined && TOPLEVEL_VERB.test(call.method)
      && (call.recv === '' || CTX_ALIAS.test(call.recv))
    ) {
      findings.push({
        tag: 'toplevel',
        file: rel,
        line: index + 1,
        message: 'effect at module load. Move it into apply(ctx) / the Service constructor.',
      })
    }
    const line = lines[index] ?? ''
    for (const ch of line) {
      if (ch === '{' || ch === '(') depth += 1
      if (ch === '}' || ch === ')') depth -= 1
    }
    if (depth < 0) depth = 0
  }
  return findings
}

/** True when an enclosing ctx.inject call widens this alias+key. */
function widened(
  widens: ReadonlyMap<number, { alias: string; keys: readonly string[] }>,
  line: number,
  alias: string,
  key: string,
): boolean {
  for (const [start, widen] of widens) {
    if (start < line && widen.alias === alias && widen.keys.includes(key)) return true
  }
  return false
}
