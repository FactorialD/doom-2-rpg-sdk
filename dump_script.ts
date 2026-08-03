import * as fs from 'fs';

const buffer = fs.readFileSync('map01.bin');
const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

const head_numNodes = view.getUint16(11, true);
const head_numLeaf = view.getUint16(13, true);
const head_numLines = view.getUint16(15, true);
const head_numNormals = view.getUint16(17, true);
const head_numPolys = view.getUint16(19, true);
const head_numVerts = view.getUint16(21, true);
const head_numNormalSprites = view.getUint16(23, true);
const head_numZSprites = view.getInt16(25, true);

const numTileEvents = view.getInt16(27, true);
const codeSize = view.getInt16(29, true);

let pos = 46;
function skip(bytes: number) { pos += bytes; }
function readUShort() { const val = view.getUint16(pos, true); pos += 2; return val; }
function readMarker() { pos += 4; }

readMarker(); const mediaCount = readUShort(); skip(mediaCount * 2);
readMarker(); skip(head_numNormals * 3 * 2);
readMarker(); skip(head_numNodes * 2);
readMarker(); skip(head_numNodes);
readMarker(); skip(head_numNodes * 2); skip(head_numNodes * 2); 
readMarker(); skip(head_numNodes * 2); skip(head_numNodes * 2);
readMarker(); skip(head_numLeaf * 2); skip(head_numLeaf * 2);
readMarker(); skip(head_numPolys * 2); skip(head_numVerts * 5); 
readMarker(); skip(Math.floor((head_numLines + 1) / 2)); skip(head_numLines * 2); skip(head_numLines * 2);
readMarker(); skip(1024);
readMarker(); 
const totalSprites = head_numNormalSprites + head_numZSprites;
skip(totalSprites * 3); skip(4 + totalSprites * 2); skip(4 + head_numZSprites); skip(4 + head_numZSprites);

readMarker();
const staticFuncsOffsets: number[] = [];
for(let i=0; i<12; i++) staticFuncsOffsets.push(readUShort());

console.log("staticFuncsOffsets:", staticFuncsOffsets);

readMarker();
skip(numTileEvents * 8);

readMarker();
const bytecode = new Uint8Array(buffer.buffer, buffer.byteOffset + pos, codeSize);

console.log("Bytecode length:", bytecode.length);

const targetOffset = staticFuncsOffsets[7];
if (targetOffset !== 65535) {
    console.log("staticFuncs[7] offset:", targetOffset);
    const slice = bytecode.slice(targetOffset, targetOffset + 50);
    console.log("Bytes:", Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' '));
}
