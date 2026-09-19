/**
 * Deterministic CORDIS tags, converged on one engine: ast-grep.
 *
 * Every tag (`mix-export`, `inject`, `toplevel`, `id`) is an ast-grep query.
 * The engine is auto-detected: when the binary is missing, every covered file
 * warns on stderr and yields an LLM-fallback handoff in the message (the
 * review agent reads the message and judges the file).
 *
 * @module dsh-cordis-review/check
 */
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
const SKIP_DIR = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'venv',
    '__pycache__',
    'target',
    '.venv',
    'coverage',
    '.next',
    'vendor',
    'out',
]);
/** Generated dirs with a variable prefix/suffix the exact set cannot name. */
function isSkippedDir(part) {
    return (SKIP_DIR.has(part) || part.endsWith('.egg-info') || part.startsWith('cmake-build-')); // pip / CLion output
}
/**
 * ast-grep language per file extension. One map serves both jobs: it is the
 * coverage set (`check` reads a file only when its extension appears here) and
 * the grouping that routes each file to the id / script / python pass.
 */
const LANGUAGE = {
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.py': 'python',
    '.pyi': 'python',
};
/** Languages whose files carry the JS/TS tags (mix-export plus member passes). */
const SCRIPT_LANGUAGES = new Set(['typescript', 'tsx', 'javascript']);
/** Extensions whose text is read before scanning (only to skip browser bundles). */
const SKIPPABLE = new Set(['.js', '.jsx', '.mjs', '.cjs']);
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
]);
/** Every alias a Cordis context is bound to in the languages this checker reads. */
const CTX_ALT = '(ctx|scope|hostCtx|context)';
const CTX_ALIAS = new RegExp(`^${CTX_ALT}$`);
const TOPLEVEL_VERB = /^(effect|on|set|plugin|register)/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Service-key shape, enforced only for Python (the `nonTs` flag).
 * Snake_case or `_`-leading members (`_undos`, `do_thing`) are locals in the
 * Python grammar: service keys carry no underscores. TS/JS keep the old
 * behavior (Cordis TS keys are host-defined; narrowing there would trade
 * false negatives for fewer false positives).
 */
const NONTS_KEY = /^[A-Za-z][A-Za-z0-9]*$/;
/** `alias.member` / `alias->member` anywhere in a text; alias and member are groups 1-2. */
const MEMBER = new RegExp(`(?:^|[^\\w$])\\$?${CTX_ALT}\\s*(?:\\.|->)\\s*([A-Za-z_][A-Za-z0-9_]*)`);
/** {@link MEMBER} restricted to a call: `alias.member(`. */
const MEMBER_CALL = new RegExp(`${MEMBER.source}\\s*\\(`);
/**
 * True when `line` continues `alias.KEY` with another `.` / `->`
 * dereference. A service is a namespace called into (`ctx.jobs.run()`); a
 * bare `ctx.snapshot()` is a method call, not a coeffect.
 */
const CONTINUED = new RegExp(`(?:^|[^\\w$])\\$?${CTX_ALT}\\s*(?:\\.|->)\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*(?:\\.|->)`);
const CONTINUED_G = new RegExp(CONTINUED.source, 'g');
function continuedAccess(line, alias, key) {
    CONTINUED_G.lastIndex = 0;
    let match;
    while ((match = CONTINUED_G.exec(` ${line}`)) !== null) {
        if (match[1] === alias && match[2] === key)
            return true;
    }
    return false;
}
/**
 * Rule bodies every script grammar shares, as `[id base, body]`. The
 * `language:` token and the `-<suffix>` every id carries both come from
 * {@link SCRIPT_LANGS}, so the TypeScript, JavaScript and JSX documents render
 * from this one list and a rule can never drift between them.
 */
const SCRIPT_RULES = [
    ['u-def', String.raw `rule:
  pattern: "export default $X"`],
    ['u-fn', String.raw `rule:
  pattern: "export function $N($$$ARGS) { $$$BODY }"`],
    ['u-const', String.raw `rule:
  pattern: "export const $N = $V"`],
    ['u-const-typed', String.raw `rule:
  pattern: "export const $N: $T = $V"`],
    ['u-named', String.raw `rule:
  pattern: "export { $X }"`],
    ['u-decl', String.raw `rule:
  pattern: "export const inject = $V"`],
    ['u-decl-bare', String.raw `rule:
  pattern: "inject = $V"`],
    ['m', String.raw `rule:
  all:
    - pattern: "$C.$K"
    - regex: "^\\$?(ctx|scope|hostCtx|context)\\b"`],
    ['t', String.raw `rule:
  all:
    - pattern: "$C.$M($$$ARGS)"
    - regex: "^\\$?(ctx|scope|hostCtx|context)\\b"
    - not:
        inside:
          any:
            - kind: function_declaration
            - kind: arrow_function
            - kind: function_expression
            - kind: method_definition`],
    ['t-bare', String.raw `rule:
  all:
    - pattern: "register($$$ARGS)"
    - not:
        inside:
          any:
            - kind: function_declaration
            - kind: arrow_function
            - kind: function_expression
            - kind: method_definition`],
    ['u-get', String.raw `rule:
  all:
    - pattern: "$C.get($$$ARGS)"
    - regex: "^\\$?(ctx|scope|hostCtx|context)\\b"`],
    ['u-inject', String.raw `rule:
  all:
    - pattern: "$C.inject($$$ARGS)"
    - regex: "^\\$?(ctx|scope|hostCtx|context)\\b"`],
];
/** Script grammar → the id suffix its rules carry. Declaration order is the scan order. */
const SCRIPT_LANGS = { typescript: 'ts', javascript: 'js', tsx: 'tsx' };
/** One `ast-grep` document for one script grammar: every {@link SCRIPT_RULES} body under its own id. */
function scriptDoc(language) {
    return SCRIPT_RULES.map(([id, body]) => `id: ${id}-${SCRIPT_LANGS[language]}\nlanguage: ${language}\n${body}`).join('\n---\n');
}
/** Rule-id suffixes of {@link SCRIPT_LANGS}. */
const SCRIPT_SUFFIXES = Object.values(SCRIPT_LANGS);
/** One rule id per script grammar. */
function scriptIds(base) {
    return SCRIPT_SUFFIXES.map((suffix) => `${base}-${suffix}`);
}
/**
 * One static multi-rule document per language, fed to `ast-grep scan
 * --inline-rules`. One engine spawn covers every file of the language.
 * Rule order is load-bearing only for readability — matches carry ruleId, so
 * evaluation order never changes output. Keep the member/call/toplevel triple
 * together when adding a rule.
 */
const SG_DOC = {
    yaml: String.raw `id: u-id
language: yaml
rule:
  pattern: "id: $ID"
`,
    typescript: scriptDoc('typescript'),
    javascript: scriptDoc('javascript'),
    tsx: scriptDoc('tsx'),
    python: String.raw `id: u-decl-py
language: python
rule:
  pattern: "inject = $V"
---
id: m-py
language: python
rule:
  all:
    - pattern: "$C.$K"
    - regex: "^\\$?(ctx|scope|hostCtx|context)\\b"
---
id: t-py
language: python
rule:
  all:
    - pattern: "$C.$M($$$ARGS)"
    - regex: "^\\$?(ctx|scope|hostCtx|context)\\b"
    - not:
        inside:
          any:
            - kind: function_definition
            - kind: lambda
---
id: t-bare-py
language: python
rule:
  all:
    - pattern: "register($$$ARGS)"
    - not:
        inside:
          any:
            - kind: function_definition
            - kind: lambda
---
id: u-get-py
language: python
rule:
  all:
    - pattern: "$C.get($$$ARGS)"
    - regex: "^\\$?(ctx|scope|hostCtx|context)\\b"
---
id: u-inject-py
language: python
rule:
  all:
    - pattern: "$C.inject($$$ARGS)"
    - regex: "^\\$?(ctx|scope|hostCtx|context)\\b"
`,
};
function warn(message) {
    process.stderr.write(`cordis-check: warning: ${message}\n`);
}
function sgOrThrow(rel) {
    throw new Error(`ast-grep failed on ${rel}: fix the binary or rerun without { astGrep: true }.`);
}
/** LLM-fallback handoff: the review agent judges the file against the checklist. */
function fallback(rel, ext) {
    warn(`${rel}: no ast-grep verdict for ${ext}. LLM fallback: judge this file against the CORDIS checklist yourself.`);
    return {
        tag: 'inject',
        file: rel,
        line: 1,
        message: `ast-grep covers no ${ext} grammar here (LLM fallback): judge this file against the CORDIS checklist yourself — ` +
            `ctx.* service reads need inject, module-load effects belong in apply(ctx).`,
    };
}
/**
 * Scan `root` for the closed-form tags.
 * @param root - workspace (or subdirectory) to walk.
 */
export async function check(root) {
    const files = await listFiles(root);
    const detected = astGrepOnPath();
    if (!detected) {
        warn('ast-grep not on PATH: every covered file takes the warning + LLM-fallback path. Install ast-grep for deterministic results.');
    }
    const covered = [];
    for (const abs of files) {
        const ext = extname(abs).toLowerCase();
        if (isTestPath(relative(root, abs).split('\\').join('/')))
            continue;
        if (abs.endsWith('.d.ts'))
            continue;
        if (LANGUAGE[ext] === undefined)
            continue;
        const text = SKIPPABLE.has(ext) ? await readFile(abs, 'utf8') : undefined;
        if (text !== undefined && text.includes('__ModuleLoader__'))
            continue;
        covered.push(abs);
    }
    // Single scan spawn for the whole tree; per-file grouping below is just
    // bucketing matches by their `file` field, not more engine calls.
    const raw = detected ? sgScanAll(covered) : undefined;
    if (raw === undefined && detected) {
        const first = covered.length > 0 ? relative(root, covered[0] ?? '').split('\\').join('/') : root;
        sgOrThrow(first);
    }
    const byFile = new Map();
    for (const hit of raw ?? []) {
        const abs = hit.file ?? '';
        const list = byFile.get(abs) ?? [];
        list.push(hit);
        byFile.set(abs, list);
    }
    const findings = [];
    const seenIds = new Map();
    for (const abs of covered) {
        const rel = relative(root, abs).split('\\').join('/');
        const ext = extname(abs).toLowerCase();
        if (raw === undefined) {
            findings.push(fallback(rel, ext));
            continue;
        }
        const byRule = indexHits(byFile.get(abs) ?? []);
        const language = LANGUAGE[ext];
        if (language === 'yaml') {
            findings.push(...sgIds(rel, byRule, seenIds));
            continue;
        }
        if (language !== undefined && SCRIPT_LANGUAGES.has(language)) {
            const text = await readFile(abs, 'utf8');
            findings.push(...sgScript(rel, byRule, text));
            continue;
        }
        const text = await readFile(abs, 'utf8');
        findings.push(...sgMembersAndToplevel(rel, byRule, text, true, 'm-py', 't-py'));
    }
    return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.tag.localeCompare(b.tag));
}
async function listFiles(root) {
    const out = [];
    // Walk by hand instead of `readdir({ recursive: true })`: pruning skipped
    // dirs during descent keeps node_modules unvisited, and skipping entries
    // that are neither plain files nor plain dirs means a symlinked dir (pnpm's
    // store layout) is never followed, so no ELOOP and no double-reported files.
    const walk = async (dir) => {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const abs = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!isSkippedDir(entry.name))
                    await walk(abs);
            }
            else if (entry.isFile()) {
                out.push(abs);
            }
        }
    };
    await walk(root);
    return out;
}
function astGrepOnPath() {
    const which = spawnSync('ast-grep', ['--version'], { encoding: 'utf8' });
    return which.status === 0;
}
function isTestPath(rel) {
    if (rel.startsWith('tests/') || rel.startsWith('test/') || rel.includes('/tests/') || rel.includes('/test/'))
        return true;
    const base = rel.split('/').pop() ?? '';
    return (/\.(?:test|spec)\.[^.]+$/.test(base)
        || /^test_/.test(base)
        || /_(?:test|spec)\.[^.]+$/.test(base)
        || /Test\.[^.]+$/.test(base));
}
/** `spawnSync` stdout ceiling for one `ast-grep scan` (see {@link MAX_PATHS}). */
const MAX_OUTPUT = 32 * 1024 * 1024;
/**
 * Paths per `ast-grep` spawn. Bounds argv size and keeps the batch's JSON
 * stdout inside {@link MAX_OUTPUT} (measured ~14KB per file on ordinary
 * sources, worst case ~0.5MB on dense ones). A single file with more than
 * {@link MAX_OUTPUT} of matches still overflows its batch — that is ~100k
 * matches in one file, not a real tree.
 * ponytail: fixed chunks; stream stdout to disk if a real tree ever hits the ceiling.
 */
const MAX_PATHS = 200;
/** `ast-grep scan` spawns over every covered file: hits, [] on no match, undefined on engine failure. */
function sgScanAll(files) {
    if (files.length === 0)
        return [];
    // Group by language *before* chunking. The engine evaluates every rule in
    // the doc against every file, so one multi-language doc costs per-file eval
    // time linear in rule count; per-language docs keep each spawn's rule set
    // small. Chunking first pays the engine's startup once per (chunk ×
    // language present) — on a mixed tree that is one spawn per language per
    // 50 files instead of one per language per 200, for no gain.
    const byLang = new Map();
    for (const file of files) {
        const lang = LANGUAGE[extname(file).toLowerCase()];
        if (lang === undefined)
            continue;
        const list = byLang.get(lang);
        if (list === undefined)
            byLang.set(lang, [file]);
        else
            list.push(file);
    }
    const out = [];
    for (const [lang, langFiles] of byLang) {
        const doc = SG_DOC[lang];
        if (doc === undefined)
            continue;
        for (let index = 0; index < langFiles.length; index += MAX_PATHS) {
            const batch = sgScanBatch(doc, langFiles.slice(index, index + MAX_PATHS));
            if (batch === undefined)
                return undefined;
            out.push(...batch);
        }
    }
    return out;
}
/** One bounded `ast-grep scan` spawn. */
function sgScanBatch(doc, files) {
    const result = spawnSync('ast-grep', ['scan', '--inline-rules', doc, '--json=compact', ...files], {
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT,
    });
    if (result.status !== 0)
        return undefined;
    const stdout = result.stdout.trim();
    if (stdout === '')
        return [];
    try {
        const parsed = JSON.parse(stdout);
        return Array.isArray(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function meta(hit, name) {
    return (hit.metaVariables?.single?.[name]?.text ?? '').trim();
}
function lineOf(hit) {
    return (hit.range?.start?.line ?? 0) + 1;
}
function injectMessage(key) {
    return `ctx.${key} without inject: ['${key}']. Declare it, or read optional services with ctx.get('${key}').`;
}
function memberKeyFromText(text) {
    const match = MEMBER.exec(` ${text}`);
    if (match?.[1] === undefined || match[2] === undefined)
        return undefined;
    return { alias: match[1], key: match[2] };
}
function keysFromValue(value) {
    const out = [];
    for (const part of value.replace(/^\s*[[{]/, '').replace(/[\]}]\s*$/, '').split(',')) {
        const token = part.trim().replace(/^['"`]|['"`]$/g, '');
        if (IDENT.test(token))
            out.push(token);
    }
    return out;
}
/** Index hits once per file: ruleId → matches. */
function indexHits(hits) {
    const out = new Map();
    for (const hit of hits) {
        if (hit.ruleId === undefined)
            continue;
        const list = out.get(hit.ruleId);
        if (list === undefined)
            out.set(hit.ruleId, [hit]);
        else
            list.push(hit);
    }
    return out;
}
function sgIds(rel, byRule, seen) {
    const findings = [];
    for (const hit of byRule.get('u-id') ?? []) {
        const id = meta(hit, 'ID').replace(/^['"`]|['"`]$/g, '');
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id))
            continue;
        const line = lineOf(hit);
        const prev = seen.get(id);
        if (prev !== undefined) {
            findings.push({
                tag: 'id',
                file: rel,
                line,
                message: `duplicate Loader id "${id}" (first at ${prev}). insert does not dedupe.`,
            });
        }
        else {
            seen.set(id, `${rel}:${line}`);
        }
    }
    return findings;
}
/** Declared inject keys, read as data from `inject = [...]` matches. */
function declaredKeys(byRule) {
    const out = new Set();
    for (const [id, hits] of byRule) {
        if (!id.startsWith('u-decl'))
            continue;
        for (const hit of hits) {
            for (const key of keysFromValue(meta(hit, 'V')))
                out.add(key);
        }
    }
    return out;
}
/**
 * `ctx.inject([...], scope => …)` widens the alias set: the callback's first
 * parameter carries the declared keys for its body lines.
 */
function injectWidens(byRule) {
    const widens = new Map();
    for (const [id, hits] of byRule) {
        if (!id.startsWith('u-inject'))
            continue;
        for (const hit of hits) {
            const text = hit.text ?? '';
            const keys = keysFromValue(/\[([^\]]*)\]/.exec(text)?.[1] ?? '');
            const alias = /\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,)]/.exec(text)?.[1];
            if (alias === undefined || keys.length === 0)
                continue;
            widens.set(lineOf(hit), { alias, keys });
        }
    }
    return widens;
}
/** `ctx.get('key')` / `scope.get('key')` reads that never need inject. */
function getReads(byRule) {
    const reads = new Set();
    for (const [id, hits] of byRule) {
        if (!id.startsWith('u-get'))
            continue;
        for (const hit of hits) {
            const arg = /\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/.exec(hit.text ?? '')?.[1];
            if (arg !== undefined)
                reads.add(`${lineOf(hit)}:${arg}`);
        }
    }
    return reads;
}
function sgScript(rel, byRule, text) {
    const defs = scriptIds('u-def').flatMap((id) => byRule.get(id) ?? []);
    if (defs.length === 0) {
        return sgMembersAndToplevel(rel, byRule, text, false, ...scriptIds('m'), ...scriptIds('t'), ...scriptIds('t-bare'));
    }
    const names = new Set();
    for (const id of [...scriptIds('u-fn'), ...scriptIds('u-const'), ...scriptIds('u-const-typed'), ...scriptIds('u-named')]) {
        for (const hit of byRule.get(id) ?? []) {
            for (const slot of ['N', 'X']) {
                for (const part of meta(hit, slot).split(',')) {
                    const token = part.trim().split(/\s+as\s+/).pop()?.trim() ?? '';
                    if (token !== '')
                        names.add(token);
                }
            }
        }
    }
    const findings = names.has('apply') || names.has('inject')
        ? [
            {
                tag: 'mix-export',
                file: rel,
                line: 1,
                message: 'default export plus named apply/inject. Loader keeps one form; mixing drops inject. Pick one.',
            },
        ]
        : [];
    return findings.concat(sgMembersAndToplevel(rel, byRule, text, false, ...scriptIds('m'), ...scriptIds('t'), ...scriptIds('t-bare')));
}
/** Shared inject + toplevel pass over one scan's member/call matches. */
function sgMembersAndToplevel(rel, byRule, text, nonTs, ...ids) {
    const memberIds = ids.filter((id) => id.startsWith('m-'));
    const callIds = ids.filter((id) => id.startsWith('t-'));
    const declared = declaredKeys(byRule);
    const widens = injectWidens(byRule);
    const reads = getReads(byRule);
    const findings = [];
    const seen = new Set();
    const srcLines = text.split(/\r?\n/);
    for (const id of memberIds) {
        for (const hit of byRule.get(id) ?? []) {
            const parsed = memberKeyFromText(hit.text ?? '');
            if (parsed === undefined || !CTX_ALIAS.test(parsed.alias))
                continue;
            if (!IDENT.test(parsed.key) || CTX_INTRINSICS.has(parsed.key) || declared.has(parsed.key))
                continue;
            if (nonTs && !NONTS_KEY.test(parsed.key))
                continue;
            // A bare call is a host method, not a coeffect: only `ctx.KEY.…`
            // survived. The call itself never reads (`ctx.tools.register()` is the
            // service `tools` providing `register`, already caught at its member).
            const contText = continuedAccess(hit.text ?? '', parsed.alias, parsed.key)
                ? hit.text ?? ''
                : (srcLines[lineOf(hit) - 1] ?? '');
            if (nonTs && !continuedAccess(contText, parsed.alias, parsed.key))
                continue;
            if (reads.has(`${lineOf(hit)}:${parsed.key}`))
                continue;
            if (widened(widens, lineOf(hit), parsed.alias, parsed.key))
                continue;
            const seenId = `${lineOf(hit)}:${parsed.key}`;
            if (seen.has(seenId))
                continue;
            seen.add(seenId);
            findings.push({ tag: 'inject', file: rel, line: lineOf(hit), message: injectMessage(parsed.key) });
        }
    }
    const callLines = new Map();
    for (const id of callIds) {
        for (const hit of byRule.get(id) ?? []) {
            const text = hit.text ?? '';
            const ruleId = hit.ruleId ?? '';
            // t-bare-*: the whole match is the call; method is its callee name.
            const bareCall = ruleId.startsWith('t-bare-') ? /^register/.exec(text.trim()) !== null : false;
            // Recover receiver+method from one match.
            const call = MEMBER_CALL.exec(` ${text}`);
            const bare = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(text);
            const recv = call?.[1] ?? '';
            const method = call?.[2] ?? (bareCall ? 'register' : (bare?.[1] ?? ''));
            if (!IDENT.test(method))
                continue;
            if (recv === '' && !bareCall)
                continue;
            callLines.set(lineOf(hit), { recv, method });
        }
    }
    // Toplevel = effect-shaped call at brace depth 0. ast-grep patterns cannot
    // see depth, so depth stays a brace scan over ast-grep's own call lines —
    // the match set is ast-grep's, not a second engine. Bare `register(…)`
    // has no receiver; `registerX` methods match TOPLEVEL_VERB by prefix.
    // String/comment braces would corrupt depth, so count code braces only.
    let depth = 0;
    for (let index = 0; index < srcLines.length; index += 1) {
        const call = callLines.get(index + 1);
        if (depth === 0 && call !== undefined && TOPLEVEL_VERB.test(call.method)
            && (call.recv === '' || CTX_ALIAS.test(call.recv))) {
            findings.push({
                tag: 'toplevel',
                file: rel,
                line: index + 1,
                message: 'effect at module load. Move it into apply(ctx) / the Service constructor.',
            });
        }
        for (const ch of codeBraces(srcLines[index] ?? '')) {
            if (ch === '{' || ch === '(')
                depth += 1;
            if (ch === '}' || ch === ')')
                depth -= 1;
        }
        if (depth < 0)
            depth = 0;
    }
    return findings;
}
/**
 * Yield the brace characters that are code, not string/comment text, so an
 * unbalanced `}` inside a literal cannot corrupt the toplevel depth pass.
 * Handles `'`, `"`, backtick strings (with `\` escapes) and `//` / `#` line
 * comments; block comments stay counted (a backstop, not a lexer).
 */
function* codeBraces(line) {
    let quote;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote !== undefined) {
            if (ch === '\\')
                i += 1;
            else if (ch === quote)
                quote = undefined;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        if (ch === '/' && line[i + 1] === '/')
            return;
        if (ch === '#')
            return;
        if (ch === '{' || ch === '(' || ch === '}' || ch === ')')
            yield ch;
    }
}
/** True when an enclosing ctx.inject call widens this alias+key. */
function widened(widens, line, alias, key) {
    for (const [start, widen] of widens) {
        if (start < line && widen.alias === alias && widen.keys.includes(key))
            return true;
    }
    return false;
}
