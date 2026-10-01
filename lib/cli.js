#!/usr/bin/env node
/**
 * `cordis-review-check [options] [root]`: print closed-form CORDIS tags.
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
Exit status: 0 clean, 1 findings, 2 usage, path, or ast-grep error, or an
incomplete scan (each unreadable directory is named on stderr; findings from
the readable part still print).
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
let result;
try {
    result = await check(target);
}
catch (error) {
    fail(error instanceof Error ? error.message : String(error));
}
for (const finding of result.findings) {
    process.stdout.write(`${finding.file}:${finding.line}: ${finding.tag}: ${finding.message}\n`);
}
if (result.unreadable.length > 0) {
    // An incomplete scan is never "clean": exit 2 even when nothing was found.
    for (const { dir, reason } of result.unreadable)
        process.stderr.write(`cordis-check: cannot read ${dir}: ${reason}\n`);
    const count = result.unreadable.length;
    fail(`incomplete scan: ${count} ${count === 1 ? 'directory' : 'directories'} unreadable`);
}
if (result.findings.length === 0)
    process.stdout.write('cordis-check: clean\n');
process.exit(result.findings.length === 0 ? 0 : 1);
