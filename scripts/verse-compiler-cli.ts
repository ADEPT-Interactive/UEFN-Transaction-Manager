import { compileVerseProject, discoverVerseCompiler, type WorkflowCompileResult } from '../server/verseCompiler';

interface CliOptions { command: 'discover' | 'status' | 'compile'; projectFile?: string; preferredProcessId?: number; json: boolean; }

function parseArgs(argv: string[]): CliOptions {
  const command = (argv[0] || 'status') as CliOptions['command'];
  if (!['discover', 'status', 'compile'].includes(command)) throw new Error('Usage: verse-compile [discover|status|compile] [--project <path>] [--process-id <pid>] [--json].');
  let projectFile: string | undefined;
  let preferredProcessId: number | undefined;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--json') json = true;
    else if (argv[index] === '--project' && argv[index + 1]) projectFile = argv[++index];
    else if (argv[index] === '--process-id' && argv[index + 1]) preferredProcessId = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (preferredProcessId !== undefined && (!Number.isInteger(preferredProcessId) || preferredProcessId < 1)) throw new Error('--process-id must be a positive integer.');
  return { command, projectFile, preferredProcessId, json };
}

function printJson(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function printCompile(result: WorkflowCompileResult): void {
  process.stdout.write(`${result.status || 'unknown'}: ${result.success ? 'success' : result.error || 'failed'}\n`);
  if (result.numErrors !== undefined || result.numWarnings !== undefined) process.stdout.write(`errors=${result.numErrors ?? 0} warnings=${result.numWarnings ?? 0}\n`);
  for (const diagnostic of result.diagnostics || []) process.stdout.write(`${diagnostic.severity || 'message'}: ${diagnostic.file || ''}${diagnostic.line === undefined ? '' : `:${diagnostic.line}${diagnostic.column === undefined ? '' : `:${diagnostic.column}`}`} ${diagnostic.message}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'compile') {
    const result = await compileVerseProject({ projectFile: options.projectFile, preferredProcessId: options.preferredProcessId });
    if (options.json) printJson(result); else printCompile(result);
    process.exitCode = result.success ? 0 : 1;
    return;
  }
  const result = await discoverVerseCompiler({ projectFile: options.projectFile, preferredProcessId: options.preferredProcessId });
  if (options.json) printJson(result);
  else {
    process.stdout.write(`${result.status}\n`);
    if (result.activeProjectFile) process.stdout.write(`project=${result.activeProjectFile}\n`);
    for (const session of result.sessions) process.stdout.write(`candidate=${session.host}:${session.port} pid=${session.processId ?? 'unknown'} source=${session.source}\n`);
    if (result.error) process.stdout.write(`${result.error}\n`);
  }
  process.exitCode = result.sessions.length > 0 ? 0 : 1;
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'verse-compile failed'}\n`); process.exitCode = 2; });
