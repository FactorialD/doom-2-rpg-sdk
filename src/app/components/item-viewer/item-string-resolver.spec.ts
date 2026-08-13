import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEntityStrings } from './item-string-resolver';

const entries = (...values: string[]) => values.map((raw, id) => ({ id, raw, renderKey: raw }));

test('resolves name, long name and description references', () => {
    assert.deepEqual(resolveEntityStrings(
        { nameId: 1, longNameId: 2, descriptionId: 3 },
        entries('unused', 'Name', 'Long name', 'Description')
    ), { nameId: 'Name', longNameId: 'Long name', descriptionId: 'Description' });
});

test('resolves another selected ID and refreshed language or resource entries', () => {
    const changedReference = { nameId: 2, longNameId: 1, descriptionId: 0 };
    assert.equal(resolveEntityStrings(changedReference, entries('One', 'Two', 'Three')).nameId, 'Three');
    assert.deepEqual(resolveEntityStrings(changedReference, entries('Один', 'Два', 'Три')), {
        nameId: 'Три', longNameId: 'Два', descriptionId: 'Один'
    });
    assert.equal(resolveEntityStrings(changedReference, entries('Updated', 'Two', 'Three')).descriptionId, 'Updated');
});
