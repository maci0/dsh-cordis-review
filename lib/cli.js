#!/usr/bin/env node
/**
 * `cordis-review-check [options] [root]` — print closed-form CORDIS tags.
 *
 * One engine (ast-grep) for every tag; without the binary (or for Zig, which
 * has no grammar) each file warns on stderr and yields an LLM-fallback hit.
 * The flags reach the two `CheckOptions` knobs the review protocol names:
 * `--grammar-config <path>` forwards an `sgconfig.yml` registering custom
 * grammars, and `--ast-grep` / `--no-ast-grep` force the engine on or off.
 *
 * @module dsh-cordis-review/cli
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { check } from './check.js';
const USAGE = `usage: cordis-review-check [options] [root]

Print closed-form CORDIS findings for <root> (default: the current directory).
  --grammar-config <path>  ast-grep sgconfig.yml registering custom grammars (e.g. zig)
  --ast-grep               force the ast-grep engine on (fails when not on PATH)
  --no-ast-grep            never run ast-grep; every covered file takes the LLM fallback
  -h, --help               print this message
Exit status: 0 clean, 1 findings, 2 usage or path error.
`;
/** Print one error line and exit with the usage-error status. */
function fail(message) {
    process.stderr.write(`cordis-check: ${message}\n`);
    process.exit(2);
}
const args = process.argv.slice(2);
let root;
let astGrep;
let grammarConfig;
for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--help' || arg === '-h') {
        process.stdout.write(USAGE);
        process.exit(0);
    }
    if (arg === '--ast-grep') {
        astGrep = true;
        continue;
    }
    if (arg === '--no-ast-grep') {
        astGrep = false;
        continue;
    }
    if (arg === '--grammar-config') {
        const value = args[index + 1];
        if (value === undefined || value.startsWith('-'))
            fail('--grammar-config needs a path');
        grammarConfig = value;
        index += 1;
        continue;
    }
    if (arg.startsWith('-'))
        fail(`unknown flag ${JSON.stringify(arg)}; try --help`);
    if (root !== undefined)
        fail(`unexpected extra argument ${JSON.stringify(arg)}; try --help`);
    root = arg;
}
const target = resolve(root ?? '.');
let isDirectory = false;
try {
    isDirectory = (await stat(target)).isDirectory();
}
catch {
    fail(`no such path: ${target}`);
}
if (!isDirectory)
    fail(`not a directory: ${target}`);
const options = {
    ...astGrep === undefined ? {} : { astGrep },
    ...grammarConfig === undefined ? {} : { grammarConfig },
};
let findings;
try {
    findings = await check(target, options);
}
catch (error) {
    fail(error instanceof Error ? error.message : String(error));
}
if (findings.length === 0) {
    process.stdout.write('cordis-check: clean\n');
    process.exit(0);
}
for (const finding of findings) {
    process.stdout.write(`${finding.file}:${finding.line}: ${finding.tag}: ${finding.message}\n`);
}
process.exit(1);
