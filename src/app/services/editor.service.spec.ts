import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorService } from './editor.service';

test('dirty state survives tab switches used by hidden workspaces', () => {
  const service = new EditorService();
  service.markDirty('textures', 42);
  service.activeTab.set('map');
  service.activeTab.set('textures');
  assert.deepEqual(service.dirtyResources().textures, { dirty: true, resourceId: 42 });
  assert.equal(service.hasUnsavedChanges(), true);
});

test('a successful save can clear only the resource that was written', () => {
  const service = new EditorService();
  service.markDirty('scripts', 3);
  service.markDirty('maps', 2);
  service.clearDirty('scripts', 3);
  assert.equal(service.isDirty('scripts'), false);
  assert.equal(service.isDirty('maps', 2), true);
});

test('destructive resource navigation is blocked until confirmed', () => {
  const service = new EditorService();
  service.markDirty('strings', '0:4');
  assert.equal(service.confirmResourceChange('strings', '0:5', () => false), false);
  assert.equal(service.isDirty('strings', '0:4'), true);
  assert.equal(service.confirmResourceChange('strings', '0:5', () => true), true);
  assert.equal(service.isDirty('strings'), false);
});

test('cross-editor requests have unique IDs and identify external navigation', () => {
  const service = new EditorService();
  service.goToString(2, 11);
  const text = service.requestedTextNavigation()!;
  service.goToScript(3, 0x40);
  const script = service.requestedScriptNavigation()!;
  service.selectPalette(7);
  service.selectMapEntity(2, 5);
  service.selectTexture(19);

  const requests = [text, script, service.requestedPaletteSelection()!, service.requestedEntitySelection()!, service.requestedTextureSelection()!];
  assert.equal(requests.every(request => request.externalNavigation), true);
  assert.equal(new Set(requests.map(request => request.requestId)).size, 5);
});

test('only the matching request may acknowledge rapid sequential navigation', () => {
  const service = new EditorService();
  service.selectTexture(10);
  const staleId = service.requestedTextureSelection()!.requestId;
  service.selectTexture(11);
  service.acknowledgeNavigation(service.requestedTextureSelection, staleId);
  assert.equal(service.requestedTextureSelection()!.textureId, 11);
  service.acknowledgeNavigation(service.requestedTextureSelection, service.requestedTextureSelection()!.requestId);
  assert.equal(service.requestedTextureSelection(), null);
  assert.equal(service.currentTextureId(), 11);
});
