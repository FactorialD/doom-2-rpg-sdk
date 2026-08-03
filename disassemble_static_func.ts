import * as fs from 'fs';
import { ScriptDisassemblerService } from './src/app/services/scripts/script-disassembler.service';

const mapData = fs.readFileSync('map01.bin');
// staticFuncs are at offset 12 in the map file? No, we need to parse the map file.
// Let's just read the map file and find staticFuncs.
// In DoomScriptService:
// const staticFuncsOffset = ...
