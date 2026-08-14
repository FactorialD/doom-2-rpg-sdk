import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { downloadBlob } from '../../shared/browser-download';
import { ImageLoadGuard } from './image-load-guard';

const source = readFileSync(new URL('./image-viewer.component.ts', import.meta.url), 'utf8');
const thumbnailSource = readFileSync(new URL('./image-thumbnail/image-thumbnail.component.ts', import.meta.url), 'utf8');

test('Images export defers cleanup and still cleans up when starting the download throws', () => {
  assert.match(source, /downloadBlob\(new Blob\(\[bytes\], \{ type: 'image\/png' \}\), image\.path/);
  const events: string[] = [];
  const cleanups: Array<() => void> = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const anchor = {
    href: '', download: '',
    click: () => { events.push('click'); throw new Error('download blocked'); },
    remove: () => events.push('remove')
  };
  URL.createObjectURL = () => 'blob:image';
  URL.revokeObjectURL = () => events.push('revoke');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    body: { appendChild: () => events.push('append') },
    createElement: () => anchor
  } });
  globalThis.setTimeout = ((callback: () => void) => { cleanups.push(callback); return 1; }) as typeof setTimeout;

  try {
    assert.throws(() => downloadBlob(new Blob(), 'image.png'), /download blocked/);
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class AsyncSelectionHarness {
  readonly guard = new ImageLoadGuard();
  revision = 1;
  selected: string | null = null;
  model: string | null = null;
  dirty = false;
  saves: string[] = [];

  async select(id: string, decode: Promise<string>): Promise<void> {
    const request = this.guard.begin(this.revision);
    const model = await decode;
    if (!this.guard.isCurrent(request, this.revision)) return;
    this.selected = id; this.model = model; this.dirty = false;
  }

  replaceJar(): void {
    this.revision++; this.guard.invalidate();
    this.selected = this.model = null; this.dirty = false;
  }

  async save(encode: Promise<string>): Promise<void> {
    const revision = this.revision, selected = this.selected;
    const bytes = await encode;
    if (revision === this.revision && selected !== null && selected === this.selected) this.saves.push(bytes);
  }
}

class ImageShortcutHarness {
  activeTab = 'text'; dirty = true; selected = true; undoAvailable = true; redoAvailable = false;
  imports = 0; saves = 0; undos = 0; redos = 0;

  shortcuts(event: KeyboardEvent): void {
    if (this.activeTab !== 'images' || this.isEditableTarget(event.target)) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && (event.shiftKey ? this.redoAvailable : this.undoAvailable)) {
      event.preventDefault(); event.shiftKey ? this.redos++ : this.undos++;
    } else if (key === 'y' && this.redoAvailable) {
      event.preventDefault(); this.redos++;
    } else if (key === 's' && this.selected && this.dirty) {
      event.preventDefault(); this.saves++;
    }
  }

  onPaste(event: ClipboardEvent): void {
    if (this.activeTab !== 'images' || this.isEditableTarget(event.target)) return;
    const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'));
    if (file) { event.preventDefault(); this.imports++; }
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    return !!(target as unknown as { editable?: boolean } | null)?.editable;
  }
}

function keyboard(key: string, options: { shiftKey?: boolean; editable?: boolean } = {}) {
  let prevented = false;
  return {
    event: { key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: !!options.shiftKey,
      target: options.editable ? { editable: true } : null, preventDefault: () => { prevented = true; } } as unknown as KeyboardEvent,
    prevented: () => prevented
  };
}

function paste() {
  let prevented = false;
  return {
    event: { target: null, clipboardData: { files: [{ type: 'image/png' }] },
      preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent,
    prevented: () => prevented
  };
}

test('component gates paste and shortcuts on the active Images tab and editable targets', () => {
  assert.match(source, /shortcuts\(event: KeyboardEvent\): void \{\s*if \(this\.editor\.activeTab\(\) !== 'images' \|\| this\.isEditableTarget\(event\.target\)\) return;/);
  assert.match(source, /onPaste\(event: ClipboardEvent\): void \{\s*if \(this\.editor\.activeTab\(\) !== 'images' \|\| this\.isEditableTarget\(event\.target\)\) return;/);
  assert.match(source, /target\.closest\('input, textarea, select, \[contenteditable\]:not\(\[contenteditable="false"\]\)'\)/);

  const component = new ImageShortcutHarness();
  for (const [key, shiftKey] of [['s', false], ['z', false], ['y', false], ['z', true]] as const) {
    const command = keyboard(key, { shiftKey }); component.shortcuts(command.event);
    assert.equal(command.prevented(), false);
  }
  const clipboard = paste(); component.onPaste(clipboard.event);
  assert.equal(clipboard.prevented(), false);
  assert.deepEqual([component.imports, component.saves, component.undos, component.redos], [0, 0, 0, 0]);

  component.activeTab = 'images';
  const editable = keyboard('s', { editable: true }); component.shortcuts(editable.event);
  assert.equal(editable.prevented(), false);
});

test('active Images commands prevent defaults only when they can run', () => {
  const component = new ImageShortcutHarness(); component.activeTab = 'images';
  const clipboard = paste(); component.onPaste(clipboard.event);
  const save = keyboard('s'); component.shortcuts(save.event);
  const undo = keyboard('z'); component.shortcuts(undo.event);
  assert.equal(clipboard.prevented(), true); assert.equal(save.prevented(), true); assert.equal(undo.prevented(), true);
  assert.deepEqual([component.imports, component.saves, component.undos], [1, 1, 1]);

  const unavailableRedo = keyboard('y'); component.shortcuts(unavailableRedo.event);
  assert.equal(unavailableRedo.prevented(), false);
  component.redoAvailable = true;
  const redo = keyboard('y'); component.shortcuts(redo.event);
  const shiftedRedo = keyboard('z', { shiftKey: true }); component.shortcuts(shiftedRedo.event);
  assert.equal(redo.prevented(), true); assert.equal(shiftedRedo.prevented(), true); assert.equal(component.redos, 2);

  component.dirty = false;
  const cleanSave = keyboard('s'); component.shortcuts(cleanSave.event);
  assert.equal(cleanSave.prevented(), false);
});

test('selection decode commits only the newest request when A finishes after B', async () => {
  const harness = new AsyncSelectionHarness();
  const a = deferred<string>(), b = deferred<string>();
  const selectingA = harness.select('A', a.promise);
  const selectingB = harness.select('B', b.promise);
  b.resolve('model-B'); await selectingB;
  a.resolve('model-A'); await selectingA;
  assert.deepEqual([harness.selected, harness.model], ['B', 'model-B']);
});

test('archive replacement invalidates decode and an in-flight save from the old archive', async () => {
  const harness = new AsyncSelectionHarness();
  const decode = deferred<string>();
  const selecting = harness.select('same/path.png', decode.promise);
  harness.selected = 'same/path.png'; harness.model = 'old-model'; harness.dirty = true;
  const encode = deferred<string>(), saving = harness.save(encode.promise);
  harness.replaceJar();
  decode.resolve('decoded-old-model'); encode.resolve('encoded-old-model');
  await Promise.all([selecting, saving]);
  assert.deepEqual([harness.selected, harness.model, harness.dirty, harness.saves], [null, null, false, []]);
  assert.match(source, /image\.archiveRevision !== archiveRevision/);
});

test('a failed decode leaves the current model and dirty state intact', async () => {
  const harness = new AsyncSelectionHarness();
  harness.selected = 'current'; harness.model = 'current-model'; harness.dirty = true;
  await assert.rejects(harness.select('broken', Promise.reject(new Error('invalid PNG'))));
  assert.deepEqual([harness.selected, harness.model, harness.dirty], ['current', 'current-model', true]);
  assert.match(source, /const model = await decodePng\(image\.bytes\);[\s\S]*this\.selected\.set\(image\); this\.model\.set\(model\)/);
});

test('same image identity and byte length in a new JAR receives a different thumbnail cache key', () => {
  const cacheKey = (revision: number) => `${revision}:file:same/path.png:123:123`;
  assert.notEqual(cacheKey(4), cacheKey(5));
  assert.match(thumbnailSource, /image\.archiveRevision.*image\.source.*image\.id.*image\.length.*image\.bytes\.byteLength/s);
});

test('zoom is a signal wired through numeric ngModel changes to the canvas', () => {
  assert.match(source, /readonly zoom = signal\(8\)/);
  assert.match(source, /\[ngModel\]="zoom\(\)" \(ngModelChange\)="zoom\.set\(\+\$event\)"/);
  assert.match(source, /\[zoom\]="normalizedZoom\(\)"/);
  assert.match(source, /normalize\(this\.zoom\(\), 1, 32, 8\)/);
});

test('Save and Discard share dirty-state actions and discard clears transient editor state', () => {
  assert.match(source, /<app-editor-actions \[dirty\]="dirty\(\)" \(save\)="save\(\)" \(discard\)="discard\(\)"/);
  assert.match(source, /async discard\(\): Promise<void>/);
  assert.match(source, /this\.cancelImport\(\); this\.resizeOpen\.set\(false\); this\.selection\.set\(null\)/);
  assert.match(source, /this\.undoStack\.set\(\[\]\); this\.redoStack\.set\(\[\]\); this\.dirty\.set\(false\)/);
  assert.match(source, /this\.editor\.clearDirty\('images', image\.id\)/);
});

test('a stale Discard decode cannot replace a newer selection or archive', async () => {
  const harness = new AsyncSelectionHarness();
  harness.selected = 'A'; harness.model = 'edited-A'; harness.dirty = true;
  const restored = deferred<string>();
  const discarding = harness.select('A', restored.promise);
  harness.replaceJar();
  harness.selected = 'B'; harness.model = 'model-B';
  restored.resolve('saved-A'); await discarding;
  assert.deepEqual([harness.selected, harness.model], ['B', 'model-B']);
  assert.match(source, /this\.loadGuard\.begin\(archiveRevision\)[\s\S]*decodePng\(image\.bytes\)[\s\S]*this\.selected\(\) !== image/);
});

test('a stale import decode is guarded by archive revision and selected image', () => {
  assert.match(source, /async beginImport\(blob: Blob\)[\s\S]*const archiveRevision = this\.imageService\.archiveRevision\(\)/);
  assert.match(source, /const request = this\.loadGuard\.begin\(archiveRevision\)[\s\S]*decodePng\(await blob\.arrayBuffer\(\)\)/);
  assert.match(source, /!this\.loadGuard\.isCurrent\(request, this\.imageService\.archiveRevision\(\)\) \|\| this\.selected\(\) !== selected/);
});
