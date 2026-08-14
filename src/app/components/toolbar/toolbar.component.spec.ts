import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ToolbarComponent } from './toolbar.component';
import { EditorService, type EditorTab } from '../../services/editor.service';

const toolbarSource = readFileSync(new URL('./toolbar.component.ts', import.meta.url), 'utf8');
const entryPath = fileURLToPath(new URL('../../../../index.tsx', import.meta.url));
const entrySource = readFileSync(entryPath, 'utf8');
const appImport = entrySource.match(/import\s+\{\s*AppComponent\s*\}\s+from\s+['"]([^'"]+)['"]/);
assert.ok(appImport, 'index.tsx must import AppComponent');
const appPath = resolve(dirname(entryPath), `${appImport[1]}.ts`);
const appSource = readFileSync(appPath, 'utf8');
const imageViewerSource = readFileSync(new URL('../image-viewer/image-viewer.component.ts', import.meta.url), 'utf8');

/**
 * Component integration harness for the toolbar-to-workspace contract. It keeps
 * every workspace node mounted, just like AppComponent, and applies its class
 * and ARIA bindings after a toolbar click.
 */
class TabWorkspaceHarness {
  readonly service = new EditorService();
  readonly workspaces = new Map<EditorTab, { hidden: boolean; ariaHidden: string }>(
    (['map', 'textures', 'images', 'text', 'scripts', 'palettes', 'items', 'variables', 'sounds'] as EditorTab[])
      .map(tab => [tab, { hidden: false, ariaHidden: 'false' }])
  );

  clickToolbarButton(tab: EditorTab) {
    this.service.selectTab(tab);
    for (const [workspaceTab, workspace] of this.workspaces) {
      workspace.hidden = this.service.activeTab() !== workspaceTab;
      workspace.ariaHidden = String(workspace.hidden);
    }
  }
}

test('Images toolbar button selects and reveals its persistently mounted workspace', () => {
  assert.match(entrySource, /bootstrapApplication\(AppComponent/);
  assert.equal(appPath, fileURLToPath(new URL('../../../../src/app.component.ts', import.meta.url)));
  assert.match(toolbarSource, /\(click\)="service\.selectTab\('images'\)"/);
  assert.doesNotMatch(toolbarSource, /service\.activeTab\.set\(/);
  assert.match(appSource, /import \{ ImageViewerComponent \} from ['"].\/app\/components\/image-viewer\/image-viewer\.component['"]/);
  assert.match(appSource, /imports:\s*\[[^\]]*ImageViewerComponent[^\]]*\]/);
  assert.match(appSource, /data-testid="image-workspace-wrapper"[\s\S]*?\[class\.hidden\]="service\.activeTab\(\) !== 'images'"[\s\S]*?<app-image-viewer\s*\/>/);
  assert.match(imageViewerSource, /data-testid="image-workspace"/);

  const component = new TabWorkspaceHarness();
  component.clickToolbarButton('textures');
  const imageWorkspace = component.workspaces.get('images')!;
  const previousWorkspace = component.workspaces.get('textures')!;

  component.service.activeTab.set('images');
  component.clickToolbarButton(component.service.activeTab());
  assert.equal(component.service.activeTab(), 'images');
  assert.equal(imageWorkspace.hidden, false);
  assert.equal(imageWorkspace.ariaHidden, 'false');
  assert.equal(previousWorkspace.hidden, true);
  assert.equal(previousWorkspace.ariaHidden, 'true');
  assert.equal(component.workspaces.size, 9, 'switching tabs must not unmount a workspace');

  component.clickToolbarButton('text');
  assert.equal(component.service.activeTab(), 'text');
  assert.equal(imageWorkspace.hidden, true);
  assert.equal(imageWorkspace.ariaHidden, 'true');
  assert.equal(component.workspaces.get('text')!.hidden, false);
  assert.equal(component.workspaces.get('images'), imageWorkspace, 'Images remains mounted when hidden');
});

test('all toolbar tab buttons use the typed EditorService selection path', () => {
  for (const tab of ['map', 'textures', 'images', 'items', 'palettes', 'text', 'variables', 'sounds', 'scripts'] as EditorTab[]) {
    assert.ok(toolbarSource.includes(`(click)="service.selectTab('${tab}')"`), `${tab} uses selectTab`);
  }
});

function createExportHarness(hasUnsavedChanges: boolean) {
  let downloadCount = 0;
  const component = Object.create(ToolbarComponent.prototype) as ToolbarComponent;
  component.service = {
    hasUnsavedChanges: () => hasUnsavedChanges,
  } as EditorService;
  component.fileService = {
    downloadModdedJar: async () => { downloadCount++; },
  } as never;

  return { component, downloadCount: () => downloadCount };
}

function mockConfirm(t: Parameters<typeof test>[1] extends (context: infer T) => unknown ? T : never, implementation: typeof confirm) {
  Object.defineProperty(globalThis, 'confirm', { configurable: true, value: implementation });
  t.after(() => { delete (globalThis as { confirm?: typeof confirm }).confirm; });
  return t.mock.method(globalThis, 'confirm', implementation);
}

test('cancelled dirty export does not download the JAR or clear dirty state', async t => {
  const harness = createExportHarness(true);
  let confirmation = '';
  mockConfirm(t, message => {
    confirmation = String(message);
    return false;
  });

  await harness.component.downloadModdedJar();

  assert.match(confirmation, /not been saved/i);
  assert.match(confirmation, /will not be included in the downloaded JAR/i);
  assert.equal(harness.downloadCount(), 0);
  assert.equal(harness.component.service.hasUnsavedChanges(), true);
});

test('confirmed dirty export downloads the JAR without clearing dirty state', async t => {
  const harness = createExportHarness(true);
  const confirmMock = mockConfirm(t, () => true);

  await harness.component.downloadModdedJar();

  assert.equal(confirmMock.mock.callCount(), 1);
  assert.equal(harness.downloadCount(), 1);
  assert.equal(harness.component.service.hasUnsavedChanges(), true);
});

test('clean export downloads immediately without confirmation', async t => {
  const harness = createExportHarness(false);
  const confirmMock = mockConfirm(t, () => {
    throw new Error('Clean exports must not ask for confirmation');
  });

  await harness.component.downloadModdedJar();

  assert.equal(confirmMock.mock.callCount(), 0);
  assert.equal(harness.downloadCount(), 1);
});

test('failed JAR loading preserves dirty state and never reports success', async t => {
  const component = Object.create(ToolbarComponent.prototype) as ToolbarComponent;
  const editor = new EditorService();
  editor.markDirty('maps', 1);
  const notifications: Array<{ type: string; text: string }> = [];
  t.mock.method(editor, 'notify', (type, text) => notifications.push({ type, text }));
  const clearDirty = t.mock.method(editor, 'clearAllDirty');
  component.service = editor;
  component.fileService = {
    loadJar: async () => { throw new Error('broken archive'); }
  } as never;
  mockConfirm(t, () => true);
  const input = {
    files: [new File([], 'broken.jar')],
    value: 'selected'
  } as unknown as HTMLInputElement;

  await component.onFileSelected({ target: input } as unknown as Event);

  assert.equal(clearDirty.mock.callCount(), 0);
  assert.equal(editor.hasUnsavedChanges(), true);
  assert.deepEqual(notifications, [{ type: 'error', text: 'Failed to load JAR: broken archive' }]);
  assert.equal(input.value, '');
});
