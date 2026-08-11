import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./map-entity-properties.component.ts', import.meta.url), 'utf8');

test('entity coordinate controls bind X/Y/Z to the matching model coordinates', () => {
    assert.match(source, /Y \(Height\)[\s\S]*?\[ngModel\]="info\.raw\.y"[\s\S]*?updateProperty\('y'/);
    assert.match(source, /Z \(Depth\)[\s\S]*?\[ngModel\]="info\.raw\.z"[\s\S]*?updateProperty\('z'/);
});

test('numeric entity inputs reject non-integers and enforce serializer ranges before mutation', () => {
    assert.match(source, /if \(!Number\.isInteger\(value\)\) return;/);
    assert.match(source, /value < range\[0\] \|\| value > range\[1\]/);
    assert.doesNotMatch(source, /Number\(value\) \|\| 0/);
    for (const range of ['255 * 8', '0xffff', 'info.floorHeight + 223']) assert.ok(source.includes(range));
});
