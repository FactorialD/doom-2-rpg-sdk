import * as fs from 'fs';

const buffer = fs.readFileSync('src/assets/entities.bin');
const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
let offset = 0;
const numDefs = view.getInt16(offset); offset += 2;
for (let i = 0; i < numDefs; i++) {
    const tileIndex = view.getInt16(offset); offset += 2;
    const eType = view.getInt8(offset); offset += 1;
    const eSubType = view.getInt8(offset); offset += 1;
    const parm = view.getInt8(offset); offset += 1;
    const nameId = view.getUint8(offset); offset += 1;
    const longName = view.getUint8(offset); offset += 1;
    const desc = view.getUint8(offset); offset += 1;
    if (eType === 9) { // NPC
        console.log(`NPC ${i}: tileIndex=${tileIndex}, eSubType=${eSubType}, parm=${parm}`);
    }
}
