import assert from 'node:assert/strict';
import test from 'node:test';
import { ByteStream, MAP_FIRST_MARKER, checkedLength, readMarker } from './byte-stream.ts';

test('readMarker reports an invalid marker with file, section, and offset', () => {
    const stream = new ByteStream(new Uint8Array([0, 0, 0, 0]).buffer, true, 'map00.bin');

    assert.throws(
        () => readMarker(stream, MAP_FIRST_MARKER, 'media registration'),
        /map00\.bin, section "media registration": invalid marker at byte offset 0/
    );
});

test('a truncated section reports its requested size without advancing', () => {
    const stream = new ByteStream(new Uint8Array(3).buffer, true, 'map00.bin');

    assert.throws(
        () => stream.readByteArray(4, 'heightmap'),
        /map00\.bin, section "heightmap": read out of bounds at byte offset 0; requested 4 byte/
    );
    assert.equal(stream.position, 0);
});

test('an inflated header count is rejected before allocation', () => {
    const stream = new ByteStream(new Uint8Array(16).buffer, true, 'map00.bin');
    const length = checkedLength(0xffff, 6, stream.fileName, 'normals', 17);

    assert.throws(
        () => stream.ensureAvailable(length, 'normals'),
        /map00\.bin, section "normals": read out of bounds at byte offset 0; requested 393210 byte/
    );
});
