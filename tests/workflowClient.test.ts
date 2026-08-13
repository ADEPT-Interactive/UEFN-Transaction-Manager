import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkflowEndpoint } from '../server/workflowClient';

test('Verse Workflow Server defaults to the local UEFN endpoint', () => {
  assert.deepEqual(resolveWorkflowEndpoint({}), { host: '127.0.0.1', port: 1962 });
});

test('Verse Workflow Server endpoint can be configured per machine', () => {
  assert.deepEqual(resolveWorkflowEndpoint({ UEM_VERSE_WORKFLOW_HOST: 'localhost', UEM_VERSE_WORKFLOW_PORT: '1972' }), { host: 'localhost', port: 1972 });
});

test('invalid Verse Workflow Server endpoint configuration is rejected', () => {
  assert.throws(() => resolveWorkflowEndpoint({ UEM_VERSE_WORKFLOW_HOST: ' ', UEM_VERSE_WORKFLOW_PORT: 'nope' }), /must not be empty/);
  assert.throws(() => resolveWorkflowEndpoint({ UEM_VERSE_WORKFLOW_PORT: '70000' }), /valid TCP port/);
});
