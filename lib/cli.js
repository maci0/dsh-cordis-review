#!/usr/bin/env node
/**
 * `cordis-review-check [options] [root]` — print closed-form CORDIS tags.
 *
 * One engine (ast-grep, auto-detected) for every tag; without the binary each
 * covered file warns on stderr and yields an LLM-fallback hit.
 *
 * @module dsh-cordis-review/cli
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { check } from './check.js';
const USAGE = `usage: cordis-review-check [options] [root]

Print closed-form CORDIS findings for <root> (default: the current directory).
  -h, --help               print this message
Exit status: 0 clean, 1 findings, 2 usage or path error.
`;
/** Print one error line and exit with the usage-error status. */
function fail(message) {
    process.stderr.write(`cordis-check: ${message}\n`);
    process.exit(2);
}
let positionals;
let help = false;
try {
    const parsed = parseArgs({
        args: process.argv.slice(2),
        options: { help: { type: 'boolean', short: 'h' } },
        allowPositionals: true,
    });
    help = parsed.values.help === true;
    positionals = parsed.positionals;
}
catch (error) {
    const option = /'(-[^']+)'/.exec(error instanceof Error ? error.message : '');
    fail(`unknown flag ${JSON.stringify(option?.[1] ?? '')}; try --help`);
}
if (help) {
    process.stdout.write(USAGE);
    process.exit(0);
}
if (positionals.length > 1)
    fail(`unexpected extra argument ${JSON.stringify(positionals[1])}; try --help`);
const rootArg = positionals[0];
if (rootArg !== undefined && rootArg.startsWith('-'))
    fail(`unknown flag ${JSON.stringify(rootArg)}; try --help`);
const target = resolve(rootArg ?? '.');
let isDirectory = false;
try {
    isDirectory = (await stat(target)).isDirectory();
}
catch {
    fail(`no such path: ${target}`);
}
if (!isDirectory)
    fail(`not a directory: ${target}`);
let findings;
try {
    findings = await check(target);
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
