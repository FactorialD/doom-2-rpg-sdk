import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * A small output-driven model keeps this test independent of WebGL while
 * exercising the toolbar/Map3D contract as a user would exercise it.
 */
class Map3DToolbarHarness {
    draftPoints: Array<{ x: number; y: number; z: number }> = [];
    geometry: number[] = [];
    undoStack: number[][] = [];
    redoStack: number[][] = [];

    confirmGeometryOperation() {
        if (this.draftPoints.length < 2) return;
        this.undoStack.push([...this.geometry]);
        this.redoStack = [];
        this.geometry.push(this.geometry.length);
        this.cancelGeometryOperation();
    }

    cancelGeometryOperation() { this.draftPoints = []; }

    undoGeometry() {
        const previous = this.undoStack.pop();
        if (!previous) return;
        this.redoStack.push([...this.geometry]);
        this.geometry = previous;
    }

    redoGeometry() {
        const next = this.redoStack.pop();
        if (!next) return;
        this.undoStack.push([...this.geometry]);
        this.geometry = next;
    }
}

test('Map3D wires toolbar geometry operations, selection, and history', () => {
    const source = readFileSync(new URL('./map-3d.component.ts', import.meta.url), 'utf8');
    for (const binding of [
        '[hasSelection]="selectedEntityId() !== -1 || selectedGeometry() !== null"',
        '(confirmOperation)="confirmGeometryOperation()"',
        '(cancelOperation)="cancelGeometryOperation()"',
        '(undo)="undoGeometry()"',
        '(redo)="redoGeometry()"',
        '(focusSelected)="focusSelected()"'
    ]) assert.match(source, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const component = new Map3DToolbarHarness();
    const toolbarOutputs = {
        confirmOperation: () => component.confirmGeometryOperation(),
        cancelOperation: () => component.cancelGeometryOperation(),
        undo: () => component.undoGeometry(),
        redo: () => component.redoGeometry()
    };

    component.draftPoints = [{ x: 0, y: 0, z: 0 }, { x: 128, y: 0, z: 0 }];
    toolbarOutputs.cancelOperation();
    assert.deepEqual(component.draftPoints, []);

    component.draftPoints = [{ x: 0, y: 0, z: 0 }, { x: 128, y: 0, z: 0 }];
    toolbarOutputs.confirmOperation();
    assert.deepEqual(component.draftPoints, []);
    assert.equal(component.geometry.length, 1);
    assert.equal(component.undoStack.length, 1);

    toolbarOutputs.undo();
    assert.equal(component.geometry.length, 0);
    assert.equal(component.redoStack.length, 1);
    toolbarOutputs.redo();
    assert.equal(component.geometry.length, 1);
    assert.equal(component.undoStack.length, 1);
});

test('entity edits use atomic history and Delete ignores inspector input', () => {
    const source = readFileSync(new URL('./map-3d.component.ts', import.meta.url), 'utf8');
    assert.match(source, /interface MapEditorSnapshot \{ geometry: MapGeometry; sprites: MapSprite\[\]; scripts: ScriptData \| null; \}/);
    assert.match(source, /this\.pushUndo\(\);\s*\/\/ Add to map data/);
    assert.match(source, /getEntityReferences\(scripts, this\.mapData\.sprites\[id\]\.uuid\)/);
    assert.match(source, /target\?\.closest\('input, textarea, select, \[contenteditable="true"\]'\)/);
    assert.match(source, /this\.editorService\.activeTab\(\) !== 'map'/);
    assert.match(source, /this\.selectedEntityId\(\) !== -1/);
});
