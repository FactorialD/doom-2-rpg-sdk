import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { downloadBlob } from '../shared/browser-download';
import { DoomFileService, JarLoadError, ResourceCompatibilityError } from './doom-file.service';

const testJarEntries = new WeakMap<ArrayBuffer, Record<string, Uint8Array>>();
const testJarBuffers = new WeakMap<File, ArrayBuffer>();
const corruptJars = new WeakSet<ArrayBuffer>();
const unreadableEntries = new WeakMap<ArrayBuffer, string>();
const originalLoadAsync = JSZip.prototype.loadAsync;

test('browser download appends and clicks before deferred revoke and removal', () => {
  const events: string[] = [];
  const cleanups: Array<() => void> = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const anchor = {
    href: '', download: '',
    click: () => events.push('click'),
    remove: () => events.push('remove')
  };
  URL.createObjectURL = () => 'blob:download';
  URL.revokeObjectURL = () => events.push('revoke');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    body: { appendChild: () => events.push('append') },
    createElement: () => anchor
  } });
  globalThis.setTimeout = ((callback: () => void) => { cleanups.push(callback); return 1; }) as typeof setTimeout;

  try {
    downloadBlob(new Blob(), 'mod.jar');
    assert.deepEqual(events, ['append', 'click']);
    assert.equal(cleanups.length, 1);
    cleanups[0]();
    assert.deepEqual(events, ['append', 'click', 'revoke', 'remove']);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    globalThis.setTimeout = originalSetTimeout;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }
});

async function jarFile(name: string, entries: Record<string, Uint8Array>): Promise<File> {
  const file = new File([], name, { type: 'application/java-archive' });
  const buffer = new ArrayBuffer(0);
  testJarEntries.set(buffer, entries);
  testJarBuffers.set(file, buffer);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buffer });
  return file;
}

(JSZip.prototype as any).loadAsync = async function(buffer: ArrayBuffer) {
  if (!testJarEntries.has(buffer) && !corruptJars.has(buffer)) {
    return originalLoadAsync.call(this, buffer);
  }
  if (corruptJars.has(buffer)) throw new Error('Corrupt central directory');
  return {
    forEach(callback: (path: string, entry: { dir: boolean; async: () => Promise<ArrayBuffer> }) => void) {
      for (const [path, contents] of Object.entries(testJarEntries.get(buffer) ?? {})) {
        callback(path, {
          dir: false,
          async: async () => {
            if (unreadableEntries.get(buffer) === path) throw new Error(`Cannot read ${path}`);
            return contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength);
          }
        });
      }
    }
  };
};

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

test('keeps all active state when a corrupt ZIP replaces a loaded JAR', async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.createObjectURL = () => 'blob:original-font';
  URL.revokeObjectURL = url => revoked.push(url);

  try {
    const service = new DoomFileService();
    await service.loadJar(await jarFile('original.jar', {
      'game/strings.idx': new Uint8Array([1]),
      'game/font.png': new Uint8Array([2]),
      'game/map00.bin': new Uint8Array([3])
    }));
    const originalRevision = service.archiveRevision();
    const originalFiles = service.files;
    const originalMetadata = service.entryMetadata;
    const corrupt = new File([], 'corrupt.jar');
    const corruptBuffer = await corrupt.arrayBuffer();
    corruptJars.add(corruptBuffer);
    Object.defineProperty(corrupt, 'arrayBuffer', { value: async () => corruptBuffer });

    await assert.rejects(service.loadJar(corrupt), (error: unknown) => {
      assert.ok(error instanceof JarLoadError);
      assert.equal(error.code, 'INVALID_ARCHIVE');
      return true;
    });

    assert.equal(service.files, originalFiles);
    assert.equal(service.entryMetadata, originalMetadata);
    assert.deepEqual(bytes(service.getFile('map00.bin')), [3]);
    assert.equal(service.loadedFileName(), 'original.jar');
    assert.equal(service.isLoaded(), true);
    assert.equal(service.stringsIndexLoaded(), true);
    assert.equal(service.fontImageSrc(), 'blob:original-font');
    assert.equal(service.archiveRevision(), originalRevision);
    assert.deepEqual(revoked, []);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('increments the archive revision only after each successful transactional replacement', async () => {
  const service = new DoomFileService();
  assert.equal(service.archiveRevision(), 0);
  await service.loadJar(await jarFile('first.jar', { 'same.png': new Uint8Array([1, 2, 3]) }));
  assert.equal(service.archiveRevision(), 1);
  await service.loadJar(await jarFile('second.jar', { 'same.png': new Uint8Array([4, 5, 6]) }));
  assert.equal(service.archiveRevision(), 2);
});

test('keeps all active state when reading a replacement entry fails', async () => {
  const service = new DoomFileService();
  await service.loadJar(await jarFile('original.jar', {
    'strings.idx': new Uint8Array([4]),
    'map00.bin': new Uint8Array([5])
  }));
  const originalFiles = service.files;
  const originalMetadata = service.entryMetadata;
  const replacement = await jarFile('unreadable.jar', {
    'strings.idx': new Uint8Array([6]),
    'map00.bin': new Uint8Array([7])
  });
  unreadableEntries.set(testJarBuffers.get(replacement)!, 'map00.bin');

  await assert.rejects(service.loadJar(replacement), (error: unknown) => {
    assert.ok(error instanceof JarLoadError);
    assert.equal(error.code, 'ENTRY_READ_FAILED');
    return true;
  });

  assert.equal(service.files, originalFiles);
  assert.equal(service.entryMetadata, originalMetadata);
  assert.deepEqual(bytes(service.getFile('strings.idx')), [4]);
  assert.deepEqual(bytes(service.getFile('map00.bin')), [5]);
  assert.equal(service.loadedFileName(), 'original.jar');
  assert.equal(service.isLoaded(), true);
  assert.equal(service.stringsIndexLoaded(), true);
  assert.equal(service.fontImageSrc(), null);
});

test('keeps all active state when a replacement resource index is invalid', async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let sequence = 0;
  URL.createObjectURL = () => `blob:font-${++sequence}`;
  URL.revokeObjectURL = url => revoked.push(url);

  try {
    const service = new DoomFileService();
    await service.loadJar(await jarFile('original.jar', {
      'strings.idx': new Uint8Array([1]),
      'font.png': new Uint8Array([2]),
      'map00.bin': new Uint8Array([3])
    }));
    const originalFiles = service.files;
    const originalMetadata = service.entryMetadata;

    await assert.rejects(
      service.loadJar(await jarFile('invalid-index.jar', {
        'strings.idx': new Uint8Array([9]),
        'images.idx': new Uint8Array([1]),
        'font.png': new Uint8Array([8])
      })),
      (error: unknown) => {
        assert.ok(error instanceof JarLoadError);
        assert.equal(error.code, 'INVALID_RESOURCE_INDEX');
        return true;
      }
    );

    assert.equal(service.files, originalFiles);
    assert.equal(service.entryMetadata, originalMetadata);
    assert.deepEqual(bytes(service.getFile('strings.idx')), [1]);
    assert.deepEqual(bytes(service.getFile('map00.bin')), [3]);
    assert.equal(service.loadedFileName(), 'original.jar');
    assert.equal(service.isLoaded(), true);
    assert.equal(service.stringsIndexLoaded(), true);
    assert.equal(service.fontImageSrc(), 'blob:font-1');
    assert.deepEqual(revoked, []);
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

test('preserves supported JSZip entry metadata and untouched payloads across a JAR round trip', async () => {
  const source = new JSZip();
  source.file('stored.bin', Uint8Array.from([0, 1, 2, 3]), {
    date: new Date(2020, 1, 2, 3, 4, 6),
    comment: 'stored entry',
    unixPermissions: 0o100640,
    compression: 'STORE'
  });
  source.file('nested/', null, {
    date: new Date(2021, 2, 4, 5, 6, 8),
    unixPermissions: 0o40750,
    dir: true
  });
  source.file('nested/deflated.bin', Uint8Array.from([9, 8, 7, 6, 5]), {
    date: new Date(2022, 3, 6, 7, 8, 10),
    comment: 'deflated entry',
    unixPermissions: 0o100600,
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  const sourceBytes = await source.generateAsync({ type: 'uint8array', platform: 'UNIX' });
  const service = new DoomFileService();
  await service.loadJar(new File([sourceBytes], 'metadata.jar'));

  let downloadedBlob: Blob | undefined;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalDocument = globalThis.document;
  URL.createObjectURL = blob => {
    downloadedBlob = blob;
    return 'blob:round-trip';
  };
  URL.revokeObjectURL = () => {};
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: { appendChild() {}, removeChild() {} },
      createElement: () => ({ click() {}, remove() {}, href: '', download: '' })
    }
  });

  try {
    await service.downloadModdedJar();
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  }

  assert.ok(downloadedBlob);
  const roundTrip = await JSZip.loadAsync(await downloadedBlob.arrayBuffer());
  assert.deepEqual(Object.keys(roundTrip.files), ['stored.bin', 'nested/', 'nested/deflated.bin']);

  for (const path of ['stored.bin', 'nested/', 'nested/deflated.bin']) {
    const before = (await JSZip.loadAsync(sourceBytes)).files[path];
    const after = roundTrip.files[path];
    assert.equal(after.date.getTime(), before.date.getTime(), `${path} date`);
    assert.equal(after.comment, before.comment, `${path} comment`);
    assert.equal(after.unixPermissions, before.unixPermissions, `${path} UNIX permissions`);
    assert.equal(after.dir, before.dir, `${path} directory flag`);
  }
  assert.equal(service.entryMetadata.get('stored.bin')?.compression, 'STORE');
  assert.equal(service.entryMetadata.get('nested/deflated.bin')?.compression, 'DEFLATE');
  assert.deepEqual(bytes(await roundTrip.file('stored.bin')?.async('arraybuffer')), [0, 1, 2, 3]);
  assert.deepEqual(bytes(await roundTrip.file('nested/deflated.bin')?.async('arraybuffer')), [9, 8, 7, 6, 5]);
});

test('uses stable ZIP metadata defaults for newly saved resources', () => {
  const service = new DoomFileService();
  service.saveBuffer('new.bin', Uint8Array.from([1]).buffer);

  const metadata = service.entryMetadata.get('new.bin');
  assert.ok(metadata);
  assert.deepEqual(metadata.date, new Date(1980, 0, 1, 0, 0, 0));
  assert.equal(metadata.comment, '');
  assert.equal(metadata.unixPermissions, null);
  assert.equal(metadata.dosPermissions, null);
  assert.equal(metadata.dir, false);
  assert.equal(metadata.compression, 'STORE');
  assert.equal(metadata.compressionOptions, null);
});
