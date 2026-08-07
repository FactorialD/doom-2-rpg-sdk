import test from 'node:test';
import assert from 'node:assert/strict';
import { isMapKeyboardControlAllowed } from './map-keyboard-control';

test('map keyboard control ignores form controls', () => {
    for (const tagName of ['INPUT', 'textarea', 'Select']) {
        assert.equal(isMapKeyboardControlAllowed({ tagName } as unknown as EventTarget), false);
    }
});

test('map keyboard control ignores contenteditable targets and descendants', () => {
    assert.equal(isMapKeyboardControlAllowed({ isContentEditable: true } as EventTarget), false);
    assert.equal(isMapKeyboardControlAllowed({ closest: () => ({}) } as unknown as EventTarget), false);
});

test('map keyboard control allows ordinary and missing targets', () => {
    assert.equal(isMapKeyboardControlAllowed({ tagName: 'BUTTON', closest: () => null } as unknown as EventTarget), true);
    assert.equal(isMapKeyboardControlAllowed(null), true);
});
