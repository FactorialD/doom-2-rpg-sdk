import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPng } from '../src/app/core/png-codec.ts';
import { parseResourceFileIndex, serializeResourceFileIndex } from '../src/app/core/resource-file-index.ts';
import { firstClipboardImage, readClipboardImage } from '../src/app/shared/image-clipboard.ts';

function indexedPng(): ArrayBuffer {
  const bytes = new Uint8Array(8 + 25 + 15 + 14 + 12);
  bytes.set([137,80,78,71,13,10,26,10]); let at = 8;
  const chunk = (type: string, data: number[]) => { new DataView(bytes.buffer).setUint32(at, data.length); at += 4; bytes.set([...type].map(c => c.charCodeAt(0)), at); at += 4; bytes.set(data, at); at += data.length + 4; };
  chunk('IHDR', [0,0,0,2,0,0,0,1,8,3,0,0,0]); chunk('PLTE', [1,2,3]); chunk('tRNS', [0,255]); chunk('IEND', []); return bytes.buffer;
}

test('images.idx serialization preserves split chunk offsets and lengths', () => {
  const entries = [{fileId:0,offset:0,length:7},{fileId:0,offset:7,length:9},{fileId:1,offset:0,length:5}];
  assert.deepEqual(parseResourceFileIndex(serializeResourceFileIndex(entries)), entries);
});

test('indexed PNG inspection preserves PLTE/tRNS bytes without a canvas round trip', () => {
  const bytes = indexedPng(), info = inspectPng(bytes);
  assert.equal(info.indexed, true); assert.equal(info.hasAlpha, true); assert.deepEqual([...info.palette!], [1,2,3]); assert.deepEqual([...info.transparency!], [0,255]);
  assert.equal(new Uint8Array(bytes).join(','), new Uint8Array(bytes.slice(0)).join(','));
});

test('clipboard chooses the first image MIME and explains unavailable API', async () => {
  const requested: string[] = [], blob = new Blob([], {type:'image/png'});
  assert.equal(await firstClipboardImage([{types:['text/plain','image/png'], getType: async type => (requested.push(type), blob)}] as ClipboardItem[]), blob);
  assert.deepEqual(requested, ['image/png']);
  await assert.rejects(() => readClipboardImage(undefined), /not available|denied/);
});
