import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { DoomFileService, ResourceCompatibilityError } from './doom-file.service';

const testJarEntries = new WeakMap<File, Record<string, Uint8Array>>();

async function jarFile(name: string, entries: Record<string, Uint8Array>): Promise<File> {
  const file = new File([], name, { type: 'application/java-archive' });
  testJarEntries.set(file, entries);
  return file;
}

(JSZip.prototype as any).loadAsync = async (file: File) => ({
  forEach(callback: (path: string, entry: { dir: boolean; async: () => Promise<ArrayBuffer> }) => void) {
    for (const [path, contents] of Object.entries(testJarEntries.get(file) ?? {})) {
      callback(path, {
        dir: false,
        async: async () => contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength)
      });
    }
  }
});

function bytes(buffer: ArrayBuffer | undefined): number[] | undefined {
  return buffer ? [...new Uint8Array(buffer)] : undefined;
}

test('resolves root and uniquely nested game resources by basename', async () => {
  const service = new DoomFileService();
  await service.loadJar(await jarFile('resources.jar', {
    'strings.idx': new Uint8Array([1]),
    'game/data/sounds.idx': new Uint8Array([2]),
    'game/maps/map00.bin': new Uint8Array([3]),
    'game/data/images00.bin': new Uint8Array([4])
  }));

  assert.deepEqual(bytes(service.getFile('strings.idx')), [1]);
  assert.deepEqual(bytes(service.getFile('sounds.idx')), [2]);
  assert.deepEqual(bytes(service.getFile('map00.bin')), [3]);
  assert.deepEqual(bytes(service.getFile('images00.bin')), [4]);
  assert.equal(service.stringsIndexLoaded(), true);
});

test('keeps the loaded JAR and its font URL when a replacement has ambiguous resources', async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.createObjectURL = () => 'blob:valid-font';
  URL.revokeObjectURL = url => revoked.push(url);

  try {
    const service = new DoomFileService();
    await service.loadJar(await jarFile('valid.jar', {
      'game/strings.idx': new Uint8Array([7]),
      'game/font.png': new Uint8Array([8]),
      'game/map00.bin': new Uint8Array([9])
    }));

    await assert.rejects(
      service.loadJar(await jarFile('ambiguous.jar', {
        'region-a/strings.idx': new Uint8Array([1]),
        'region-b/strings.idx': new Uint8Array([2])
      })),
      (error: unknown) => {
        assert.ok(error instanceof ResourceCompatibilityError);
        assert.equal(error.code, 'AMBIGUOUS_RESOURCE_BASENAME');
        assert.equal(error.resourceName, 'strings.idx');
        assert.deepEqual(error.conflictingPaths, ['region-a/strings.idx', 'region-b/strings.idx']);
        return true;
      }
    );

    assert.equal(service.loadedFileName(), 'valid.jar');
    assert.equal(service.isLoaded(), true);
    assert.equal(service.stringsIndexLoaded(), true);
    assert.equal(service.fontImageSrc(), 'blob:valid-font');
    assert.deepEqual(revoked, []);
    assert.deepEqual(bytes(service.getFile('strings.idx')), [7]);
    assert.deepEqual(bytes(service.getFile('map00.bin')), [9]);
    assert.equal(service.getFile('region-a/strings.idx'), undefined);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('writes basename updates back to the uniquely resolved original path', async () => {
  const service = new DoomFileService();
  await service.loadJar(await jarFile('nested.jar', {
    'assets/strings.idx': new Uint8Array([1])
  }));

  service.saveBuffer('strings.idx', new Uint8Array([9]).buffer);

  assert.deepEqual([...service.files.keys()], ['assets/strings.idx']);
  assert.deepEqual(bytes(service.files.get('assets/strings.idx')), [9]);
  assert.equal(service.files.has('strings.idx'), false);
});

test('rebuilds the resource index and revokes font URLs on repeated JAR loads', async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let sequence = 0;
  URL.createObjectURL = () => `blob:test-${++sequence}`;
  URL.revokeObjectURL = url => revoked.push(url);

  try {
    const service = new DoomFileService();
    await service.loadJar(await jarFile('first.jar', {
      'old/strings.idx': new Uint8Array([1]),
      'old/font.png': new Uint8Array([2])
    }));
    assert.equal(service.fontImageSrc(), 'blob:test-1');

    await service.loadJar(await jarFile('second.jar', {
      'new/strings.idx': new Uint8Array([3]),
      'new/font.png': new Uint8Array([4])
    }));

    assert.deepEqual(revoked, ['blob:test-1']);
    assert.equal(service.fontImageSrc(), 'blob:test-2');
    assert.deepEqual(bytes(service.getFile('strings.idx')), [3]);
    assert.equal(service.files.has('old/strings.idx'), false);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('atomically updates and deletes only explicitly named resources', () => {
  const service = new DoomFileService();
  service.files.set('game/images.idx', Uint8Array.from([1]).buffer);
  service.files.set('game/images0.bin', Uint8Array.from([2]).buffer);
  service.files.set('game/images1.bin', Uint8Array.from([3]).buffer);
  service.files.set('other/images1.bin.backup', Uint8Array.from([4]).buffer);
  (service as any).rebuildResourceIndex();

  service.updateBuffersAtomically(new Map([['game/images.idx', Uint8Array.from([9]).buffer]]), ['game/images1.bin']);

  assert.deepEqual(bytes(service.files.get('game/images.idx')), [9]);
  assert.equal(service.files.has('game/images1.bin'), false);
  assert.deepEqual(bytes(service.files.get('game/images0.bin')), [2]);
  assert.deepEqual(bytes(service.files.get('other/images1.bin.backup')), [4]);
});
