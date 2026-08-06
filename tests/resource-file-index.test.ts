import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResourceFileIndex } from '../src/app/core/resource-file-index.ts';

function makeSplitIndex(): ArrayBuffer {
  const buffer = new ArrayBuffer(2 + 4 * 5);
  const view = new DataView(buffer);
  view.setInt16(0, 2, true);

  const records = [
    { fileId: 7, offset: 0 },
    { fileId: 0xff, offset: 12 },
    { fileId: 8, offset: 0 },
    { fileId: 0xff, offset: 23 }
  ];
  records.forEach((record, index) => {
    const position = 2 + index * 5;
    view.setUint8(position, record.fileId);
    view.setInt32(position + 1, record.offset, true);
  });
  return buffer;
}

test('0xff separator does not consume a logical resource ID', () => {
  const entries = parseResourceFileIndex(makeSplitIndex());

  assert.deepEqual(entries, [
    { fileId: 7, offset: 0, length: 12 },
    { fileId: 8, offset: 0, length: 23 }
  ]);
  assert.equal(entries[1].fileId, 8, 'sound ID 1 keeps the entry after the separator');
  assert.ok(entries.every(entry => entry.fileId !== 0xff), 'no ID resolves to sounds255.bin');
});
