import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./image-viewer.component.ts', import.meta.url), 'utf8');

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
