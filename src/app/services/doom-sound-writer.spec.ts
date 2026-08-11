import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResourceFileIndex } from '../core/resource-file-index';
import { writeSoundResources } from './doom-sound-writer';

const data = (...bytes: number[]) => Uint8Array.from(bytes).buffer;

test('sounds parse, edit, write, and parse recalculates offsets across split files', () => {
  const edited = [data(1, 2, 3), data(9, 8, 7, 6), data(5, 4)];
  const written = writeSoundResources(edited, 6);
  assert.deepEqual(parseResourceFileIndex(written.index), [
    { fileId: 0, offset: 0, length: 3 }, { fileId: 1, offset: 0, length: 4 }, { fileId: 1, offset: 4, length: 2 }
  ]);
  assert.deepEqual([...new Uint8Array(written.files.get('sounds1.bin')!)], [9, 8, 7, 6, 5, 4]);
});
