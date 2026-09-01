import assert from 'node:assert/strict';
import test from 'node:test';
import { FileService } from '../src/services/fileService';

test('browser storage namespace is stable for one project path', () => {
  const first = FileService.getStorageNamespace('C:\\Demo\\Fortnite Projects\\Store\\Content');
  const equivalent = FileService.getStorageNamespace('c:/demo/fortnite projects/store/content/');
  assert.equal(first, equivalent);
});

test('browser storage namespaces differ between projects', () => {
  const first = FileService.getStorageNamespace('C:\\Demo\\Fortnite Projects\\StoreA\\Content');
  const second = FileService.getStorageNamespace('C:\\Demo\\Fortnite Projects\\StoreB\\Content');
  assert.notEqual(first, second);
});
