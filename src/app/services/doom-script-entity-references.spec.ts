import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('entity relocation validates every UUID and operand before mutating instructions', () => {
    const source = readFileSync(new URL('./doom-script.service.ts', import.meta.url), 'utf8');
    const validation = source.indexOf('const indices = new Map');
    const mutation = source.indexOf('for (const inst of scriptData.instructions)', validation + 1);
    assert.ok(validation >= 0 && mutation > validation);
    assert.match(source, /newIndex === undefined \|\| !this\.entityOperandFits\(inst, newIndex\)/);
    assert.match(source, /argument\.packedReference\.max/);
});

test('entity dependency reporting uses stable UUIDs', () => {
    const source = readFileSync(new URL('./doom-script.service.ts', import.meta.url), 'utf8');
    assert.match(source, /instruction\.referencedEntityUuid === uuid/);
});
