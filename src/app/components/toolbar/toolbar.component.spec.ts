import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EditorService, type EditorTab } from '../../services/editor.service';

const toolbarSource = readFileSync(new URL('./toolbar.component.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../app.component.ts', import.meta.url), 'utf8');
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
  assert.match(toolbarSource, /\(click\)="service\.selectTab\('images'\)"/);
  assert.doesNotMatch(toolbarSource, /service\.activeTab\.set\(/);
  assert.match(appSource, /data-testid="image-workspace-wrapper"[\s\S]*?\[class\.hidden\]="service\.activeTab\(\) !== 'images'"[\s\S]*?\[attr\.aria-hidden\]="service\.activeTab\(\) !== 'images'"/);
  assert.match(imageViewerSource, /data-testid="image-workspace"/);

  const component = new TabWorkspaceHarness();
  component.clickToolbarButton('text');
  const imageWorkspace = component.workspaces.get('images')!;
  const textWorkspace = component.workspaces.get('text')!;

  component.clickToolbarButton('images');
  assert.equal(component.service.activeTab(), 'images');
  assert.equal(imageWorkspace.hidden, false);
  assert.equal(imageWorkspace.ariaHidden, 'false');
  assert.equal(textWorkspace.hidden, true);
  assert.equal(textWorkspace.ariaHidden, 'true');
  assert.equal(component.workspaces.size, 9, 'switching tabs must not unmount a workspace');

  component.clickToolbarButton('text');
  assert.equal(component.service.activeTab(), 'text');
  assert.equal(imageWorkspace.hidden, true);
  assert.equal(imageWorkspace.ariaHidden, 'true');
  assert.equal(textWorkspace.hidden, false);
  assert.equal(component.workspaces.get('images'), imageWorkspace, 'Images remains mounted when hidden');
});

test('all toolbar tab buttons use the typed EditorService selection path', () => {
  for (const tab of ['map', 'textures', 'images', 'items', 'palettes', 'text', 'variables', 'sounds', 'scripts'] as EditorTab[]) {
    assert.ok(toolbarSource.includes(`(click)="service.selectTab('${tab}')"`), `${tab} uses selectTab`);
  }
});
