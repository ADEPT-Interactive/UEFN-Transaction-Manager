// Compatibility facade retained for existing UEM imports. The reusable compiler
// implementation lives in verseCompiler.ts so UEM and the future agent skill can
// share one session/discovery contract.
export {
  HISTORICAL_WORKFLOW_PORT,
  compileVerseProject,
  discoverVerseCompiler,
  projectPathsMatch,
  resolveWorkflowEndpoint,
} from './verseCompiler';
export type {
  CompilerDiscoveryOptions,
  CompilerDiscoveryResult,
  CompilerDiscoverySystem,
  CompilerStatus,
  CompileVerseOptions,
  LoopbackListener,
  UefnProcessInfo,
  VerseCompilerDiagnostic,
  VerseCompilerSession,
  WorkflowCompileResult,
  WorkflowEndpoint,
} from './verseCompiler';
