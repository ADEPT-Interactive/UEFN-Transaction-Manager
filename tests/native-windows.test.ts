import assert from 'node:assert/strict';
import test from 'node:test';
import { UEM_INPUT_SIZE } from '../electron/nativeWindows.js';

test('Windows INPUT uses the native x64 layout required by SendInput', () => {
  if (process.platform !== 'win32') return;
  assert.equal(UEM_INPUT_SIZE, 40);
});
