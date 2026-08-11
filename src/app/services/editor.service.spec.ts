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
