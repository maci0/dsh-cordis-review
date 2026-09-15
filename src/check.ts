/**
 * Deterministic CORDIS tags: JS/TS via the TypeScript AST, YAML `id:` by line,
 * other languages via ast-grep when on PATH else a comment-stripped scan.
 *
 * mix-export / inject / toplevel / id. Inverse, leak, hmr, boundary stay in the skill.
 *
 * @module dsh-cordis-review/check
 */

import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import * as ts from 'typescript'

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
  'target',
  'vendor',
  'build',
])

const SCRIPT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const YAML = new Set(['.yml', '.yaml'])
const POLYGLOT = new Set(['.py', '.pyi', '.go', '.zig', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.java', '.rs'])
const HASH_COMMENT = new Set(['.py', '.pyi'])

/** Options for {@link check}. */
export interface CheckOptions {
  /** Spawn ast-grep when true; skip when false; detect when omitted. */
  readonly astGrep?: boolean
}

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
const CTX_MEMBER = /\b(ctx|scope|hostCtx|context)\s*(?:\.|->)\s*([A-Za-z_][A-Za-z0-9_]*)/g
const TOPLEVEL_EFFECT = /^(?:ctx|scope|hostCtx|context)\s*(?:\.|->)\s*(?:effect|on|set|plugin|register)\b/

/**
 * Scan `root` for the closed-form tags.
 * @param root - workspace (or subdirectory) to walk.
 * @param options - ast-grep on/off/detect.
 */
export async function check(root: string, options: CheckOptions = {}): Promise<readonly Finding[]> {
  const files = await listFiles(root)
  const findings: Finding[] = []
  const useSg = options.astGrep ?? astGrepOnPath()

  for (const abs of files) {
    const rel = relative(root, abs).split('\\').join('/')
    const ext = extname(abs).toLowerCase()
    if (YAML.has(ext)) {
      findings.push(...yamlIds(rel, await readFile(abs, 'utf8')))
      continue
    }
    if (isTestPath(rel)) continue
    const text = await readFile(abs, 'utf8')
    if (SCRIPT.has(ext) && !abs.endsWith('.d.ts')) {
      if (text.includes('__ModuleLoader__')) continue
      const kind = scriptKind(ext)
      const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
      findings.push(...scanScript(source))
      continue
    }
    if (POLYGLOT.has(ext)) {
      findings.push(...scanPolyglot(root, rel, ext, text, useSg))
    }
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

function scriptKind(ext: string): ts.ScriptKind {
  if (ext === '.tsx' || ext === '.jsx') return ts.ScriptKind.TSX
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function yamlIds(file: string, text: string): Finding[] {
  const seen = new Map<string, number>()
  const findings: Finding[] = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^[ \t]*(?:-[ \t]+)?id:[ \t]*['"]?([A-Za-z0-9][A-Za-z0-9_.-]*)/.exec(lines[index] ?? '')
    if (match?.[1] === undefined) continue
    const id = match[1]
    const prev = seen.get(id)
    if (prev !== undefined) {
      findings.push({
        tag: 'id',
        file,
        line: index + 1,
        message: `duplicate Loader id "${id}" (first at line ${prev}). insert does not dedupe.`,
      })
    } else {
      seen.set(id, index + 1)
    }
  }
  return findings
}

function scanScript(source: ts.SourceFile): Finding[] {
  const findings: Finding[] = []
  const exportedInject = new Set<string>()
  let hasDefault = false
  let namedApply = false
  let namedInject = false

  const noteExport = (name: string): void => {
    if (name === 'apply') namedApply = true
    if (name === 'inject') namedInject = true
  }

  const collect = (node: ts.Node): void => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) hasDefault = true
    if (hasDefaultMod(node)) hasDefault = true
    if (ts.isFunctionDeclaration(node) && hasExport(node) && !hasDefaultMod(node) && node.name?.text === 'apply') namedApply = true
    if (ts.isVariableStatement(node) && hasExport(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        noteExport(decl.name.text)
        if (decl.name.text === 'inject' && decl.initializer) for (const key of keysFrom(decl.initializer)) exportedInject.add(key)
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) noteExport((el.propertyName ?? el.name).text)
    }
    ts.forEachChild(node, collect)
  }
  collect(source)

  if (hasDefault && (namedApply || namedInject)) {
    findings.push({
      tag: 'mix-export',
      file: source.fileName,
      line: 1,
      message: 'default export plus named apply/inject. Loader keeps one form; mixing drops inject. Pick one.',
    })
  }

  const visit = (node: ts.Node, inFn: number, aliases: ReadonlySet<string>, keys: ReadonlySet<string>): void => {
    if (ts.isCallExpression(node) && isInjectCallee(node)) {
      const deps = node.arguments[0]
      const cb = node.arguments[1]
      if (deps !== undefined && cb !== undefined && isFn(cb)) {
        const nextKeys = union(keys, keysFrom(deps))
        visit(node.expression, inFn, aliases, keys)
        visit(deps, inFn, aliases, keys)
        visitFn(cb, inFn, aliases, nextKeys)
        for (const extraArg of node.arguments.slice(2)) visit(extraArg, inFn, aliases, keys)
        return
      }
    }

    if (isFn(node)) {
      visitFn(node, inFn, aliases, keys)
      return
    }

    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const classKeys = new Set(keys)
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member) || member.name.getText(source) !== 'inject' || !member.initializer) continue
        if (!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue
        for (const key of keysFrom(member.initializer)) classKeys.add(key)
      }
      const classAliases = new Set(aliases)
      ts.forEachChild(node, (child) => visit(child, inFn + 1, classAliases, classKeys))
      return
    }

    if (inFn === 0 && ts.isCallExpression(node) && isToplevelCall(node)) {
      findings.push({
        tag: 'toplevel',
        file: source.fileName,
        line: lineOf(source, node),
        message: 'effect at module load. Move it into apply(ctx) / the Service constructor.',
      })
    }

    const service = serviceAccess(node)
    if (service !== undefined && aliases.has(service.alias) && !CTX_INTRINSICS.has(service.key) && !keys.has(service.key)) {
      findings.push({
        tag: 'inject',
        file: source.fileName,
        line: lineOf(source, node),
        message: `ctx.${service.key} without inject: ['${service.key}']. Declare it, or read optional services with ctx.get('${service.key}').`,
      })
    }

    ts.forEachChild(node, (child) => visit(child, inFn, aliases, keys))
  }

  const visitFn = (node: ts.Node, inFn: number, aliases: ReadonlySet<string>, keys: ReadonlySet<string>): void => {
    const nextAliases = new Set(aliases)
    for (const param of fnParams(node)) {
      if (CTX_ALIAS.test(param)) nextAliases.add(param)
    }
    ts.forEachChild(node, (child) => visit(child, inFn + 1, nextAliases, keys))
  }

  const rootAliases = new Set<string>(['ctx'])
  visit(source, 0, rootAliases, exportedInject)
  return findings
}

function hasExport(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
}

function hasDefaultMod(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === true
}

function isFn(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
  )
}

function fnParams(node: ts.Node): string[] {
  const params =
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
      ? node.parameters
      : undefined
  if (params === undefined) return []
  return params.flatMap((param) => (ts.isIdentifier(param.name) ? [param.name.text] : []))
}

function isInjectCallee(node: ts.CallExpression): boolean {
  const expr = node.expression
  if (ts.isIdentifier(expr)) return expr.text === 'inject'
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'inject') {
    return ctxAlias(expr.expression) !== undefined
  }
  return false
}

function isToplevelCall(node: ts.CallExpression): boolean {
  const expr = node.expression
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name.text
    if (name === 'effect' || name === 'on' || name === 'set' || name === 'plugin' || name === 'register' || name.startsWith('register')) return true
  }
  return ts.isIdentifier(expr) && (expr.text === 'register' || expr.text.startsWith('register'))
}

function serviceAccess(node: ts.Node): { alias: string; key: string } | undefined {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const alias = ctxAlias(node.expression)
    if (alias === undefined) return undefined
    return { alias, key: node.name.text }
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    const alias = ctxAlias(node.expression)
    if (alias === undefined) return undefined
    return { alias, key: node.argumentExpression.text }
  }
  return undefined
}

function ctxAlias(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'ctx') {
    if (expr.expression.kind === ts.SyntaxKind.ThisKeyword) return 'ctx'
    if (ts.isIdentifier(expr.expression) && expr.expression.text === 'fiber') return 'ctx'
  }
  if (ts.isParenthesizedExpression(expr)) return ctxAlias(expr.expression)
  return undefined
}

function keysFrom(node: ts.Expression): string[] {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return keysFrom(node.expression)
  }
  if (ts.isTypeAssertionExpression(node)) return keysFrom(node.expression)
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((el) => (ts.isStringLiteralLike(el) ? [el.text] : []))
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((prop) => {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) return [prop.name.text]
      if (ts.isShorthandPropertyAssignment(prop)) return [prop.name.text]
      if (ts.isPropertyAssignment(prop) && ts.isStringLiteralLike(prop.name)) return [prop.name.text]
      return []
    })
  }
  return []
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

function union(base: ReadonlySet<string>, extra: readonly string[]): Set<string> {
  const next = new Set(base)
  for (const key of extra) next.add(key)
  return next
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

function scanPolyglot(root: string, rel: string, ext: string, text: string, useSg: boolean): Finding[] {
  const declared = declaredInjectKeys(text)
  const stripped = scanStripped(rel, ext, text)
  const sg = useSg && ext !== '.zig' ? astGrepInject(root, rel, ext) : undefined
  const inject = sg ?? stripped.filter((hit) => hit.tag === 'inject')
  const toplevel = stripped.filter((hit) => hit.tag === 'toplevel')
  return filterPolyglot(rel, [...inject, ...toplevel], declared)
}

function declaredInjectKeys(text: string): Set<string> {
  const keys = new Set<string>()
  const match = /\binject\s*[:=]\s*[\[{]([^\]}]+)[\]}]/.exec(text)
  if (match?.[1] === undefined) return keys
  for (const part of match[1].split(',')) {
    const token = part.trim().replace(/^['"]|['"]$/g, '')
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) keys.add(token)
  }
  return keys
}

function filterPolyglot(file: string, raw: readonly Finding[], declared: ReadonlySet<string>): Finding[] {
  return raw.filter((hit) => {
    if (hit.tag !== 'inject') return true
    const key = /\bctx\.([A-Za-z_][A-Za-z0-9_]*)/.exec(hit.message)?.[1]
    return key !== undefined && !declared.has(key)
  }).map((hit) => ({ ...hit, file }))
}

interface SgHit {
  readonly text?: string
  readonly range?: { readonly start?: { readonly line?: number } }
}

function astGrepInject(root: string, rel: string, ext: string): Finding[] | undefined {
  const lang = sgLang(ext)
  if (lang === undefined) return undefined
  const abs = join(root, rel)
  const parsed: SgHit[] = []
  for (const args of sgQueries(lang)) {
    const result = spawnSync('ast-grep', [...args, '--json=compact', abs], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
    if (result.status !== 0 && result.status !== 1) return undefined
    const stdout = result.stdout.trim()
    if (stdout === '') continue
    let chunk: unknown
    try {
      chunk = JSON.parse(stdout) as unknown
    } catch {
      return undefined
    }
    if (!Array.isArray(chunk)) return undefined
    parsed.push(...(chunk as SgHit[]))
  }
  const findings: Finding[] = []
  const seen = new Set<string>()
  for (const hit of parsed) {
    const text = hit.text ?? ''
    const key = memberKey(text)
    if (key === undefined || CTX_INTRINSICS.has(key)) continue
    const line = (hit.range?.start?.line ?? 0) + 1
    const id = `${line}:${key}`
    if (seen.has(id)) continue
    seen.add(id)
    findings.push({
      tag: 'inject',
      file: rel,
      line,
      message: `ctx.${key} without inject: ['${key}']. Declare it, or read optional services with ctx.get('${key}').`,
    })
  }
  return findings
}

function sgLang(ext: string): string | undefined {
  if (ext === '.py' || ext === '.pyi') return 'python'
  if (ext === '.go') return 'go'
  if (ext === '.rs') return 'rust'
  if (ext === '.c' || ext === '.h') return 'c'
  if (ext === '.cc' || ext === '.cpp' || ext === '.cxx' || ext === '.hpp' || ext === '.hh') return 'cpp'
  if (ext === '.java') return 'java'
  return undefined
}

function sgQueries(lang: string): string[][] {
  if (lang === 'go') return [['run', '-l', 'go', '-k', 'selector_expression']]
  if (lang === 'java') return [['run', '-l', 'java', '-k', 'field_access']]
  if (lang === 'cpp') return [['run', '-l', 'cpp', '-p', 'ctx->$K'], ['run', '-l', 'cpp', '-p', 'ctx.$K']]
  return [['run', '-l', lang, '-p', 'ctx.$K']]
}

function memberKey(text: string): string | undefined {
  const match = /(?:^|[^\w])(?:ctx|scope|hostCtx|context)\s*(?:\.|->)\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(` ${text}`)
  return match?.[1]
}

function scanStripped(rel: string, ext: string, text: string): Finding[] {
  const findings: Finding[] = []
  const lines = stripComments(ext, text).split(/\r?\n/)
  let depth = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (depth === 0 && TOPLEVEL_EFFECT.test(line.trimStart())) {
      findings.push({
        tag: 'toplevel',
        file: rel,
        line: index + 1,
        message: 'effect at module load. Move it into apply(ctx) / the Service constructor.',
      })
    }
    CTX_MEMBER.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CTX_MEMBER.exec(line)) !== null) {
      const key = match[2]
      if (key === undefined || CTX_INTRINSICS.has(key)) continue
      findings.push({
        tag: 'inject',
        file: rel,
        line: index + 1,
        message: `ctx.${key} without inject: ['${key}']. Declare it, or read optional services with ctx.get('${key}').`,
      })
    }
    depth += braceDelta(line)
    if (depth < 0) depth = 0
  }
  return findings
}

function stripComments(ext: string, text: string): string {
  if (HASH_COMMENT.has(ext)) {
    return text.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, (block) => block.replace(/[^\n]/g, ' ')).replace(/#[^\n]*/g, '')
  }
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
}

function braceDelta(line: string): number {
  let delta = 0
  for (const ch of line) {
    if (ch === '{' || ch === '(') delta += 1
    if (ch === '}' || ch === ')') delta -= 1
  }
  return delta
}
