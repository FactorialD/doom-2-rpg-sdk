# Angular / Java audit

## Script bytecode

- [x] A single declarative opcode schema is the source of truth for decoding, encoding, sizing, validation, semantic references, relocation, and editor metadata. The supported range and reserved Java opcodes are checked when the module initializes.

## Beta readiness matrix

The matrix records capabilities of `0.1.0-beta.1`, not a promise of compatibility
with every regional or carrier JAR. Here **yes** means that a user-facing path is
implemented, **limited** means that only the stated subset is implemented or that
the path still needs representative-JAR coverage, and **no** means that the SDK is
currently read-only in that area. “Round trip” is the ability to read, save, and
read the result without unintended semantic changes; it does not mean that the
ZIP/JAR bytes remain identical.

| Area | Read | Edit | Write | Round trip | Automated checks |
|---|---|---|---|---|---|
| Maps | **Yes:** headers, geometry, polygons, BSP, heightmap, sprites, entities, and embedded scripts | **Yes:** surface textures plus entity creation, type/property changes, movement and deletion; entity reorder/ID and referenced deletion remain experimental | **Yes:** map serializer writes geometry, entities and supported scripts back to `mapXX.bin` | **Limited:** entity-reference relocation is validated, but not yet guaranteed for every operand/JAR variant | **Limited:** focused serializer and editor checks; no complete map corpus |
| Scripts | **Yes:** disassembly, functions, tile events, operands, and semantic references | **Yes:** edit, insert, delete, and reorder instructions with relocation | **Yes:** assembler replaces bytecode plus function and tile-event tables | **Limited:** opcode schema validates encoding, but no end-to-end script corpus is run automatically | **Limited:** schema self-validation during module initialization; no dedicated automated round-trip suite |
| Textures | **Yes:** mappings, raw texels, Doom-column sprites, references, bounds, and split `texXX.bin` files | **Limited:** paint/import root textures; referenced textures are not directly editable | **Yes:** recompresses sprites, updates mappings, and rebuilds split texture files | **Limited:** reference resolution has a fixture, but encode/decode and complete-file equivalence are not covered | **Limited:** reference-chain/read behavior fixture exists, but uses a separate Bun test and is not in the npm test script |
| Palettes | **Yes:** RGB555 root palettes and parent references | **Yes:** colors, image import, creation, and palette-size replacement | **Yes:** rebuilds `newPalettes.bin` and updates `newMappings.bin` | **Limited:** RGB555 is quantized and structural round trip has no automated corpus | **No:** production build compiles the path, but there is no palette-specific automated test |
| Strings | **Yes:** indexed chunks in Windows-1251, Windows-1252, and UTF-8 | **Yes:** individual strings in the selected language/chunk | **Yes:** rebuilds the affected `stringsXX.bin` and `strings.idx` data | **Limited:** single-byte codecs are checked; full index/chunk and UTF-8 round trips are not | **Limited:** standalone Windows-1251/1252 codec checks exist, but are not exposed by a package script |
| Items | **Yes:** all eight-byte `EntityDef` records and map/script cross-references | **Yes:** every persisted `entities.bin` field with signed/unsigned range validation | **Yes:** explicit Save rebuilds `entities.bin` | **Yes:** synthetic parse → edit → write → parse covers all fields | **Yes:** synthetic record round trip and rejection test |
| Variables | **Yes:** SDK labels are separate from runtime/script values and script references | **Limited:** Java-confirmed literal `EV_SETSTATE` values only | **Limited:** recompiles the affected map script; SDK labels are never written | **Limited:** assignment codec is checked; runtime-computed values deliberately have no writer | **Yes:** signed EV_SETSTATE encoding and metadata separation tests |
| Sounds | **Yes:** parses the shared resource index and decodes MIDI/WAV/AU metadata for preview | **Limited:** replacement import is MIDI-only, matching `Sound.SOUND_FORMAT` and `Manager.createPlayer(..., "audio/midi")` | **Yes:** recalculates offsets/lengths and rebuilds 32768-byte `soundsNN.bin` splits | **Yes:** writer reparses its index and the service decodes the selected sound after saving | **Yes:** synthetic split parse → edit → write → parse plus format metadata tests |
| JAR repacking | **Yes:** loads every non-directory ZIP entry into the in-memory file system | **Limited:** editors replace supported resources in memory | **Yes:** JSZip creates a downloadable JAR while retaining entry paths | **Limited:** archive metadata, compression, ordering, and signatures are not preserved or compared; runtime compatibility still needs manual testing | **No:** no load/repack/reload archive test |

## First beta release criteria

`0.1.0-beta.1` is the first beta when all of the following are true:

- the application completes a production build with zoneless Angular;
- an original-layout Doom II RPG J2ME JAR can be loaded into the in-memory file
  system and repacked without intentionally dropping file entries;
- maps, scripts, textures, palettes, strings, and map entities expose read and
  save paths; entities support creation, type/property edits, movement and
  deletion, while reference-sensitive reorder/ID operations remain experimental;
- script size changes relocate jumps, function offsets, and tile-event references
  through the shared opcode schema;
- texture and palette writers retain reference semantics, RGB555 storage, and the
  32768-byte texture-file split model;
- text saving rejects characters that cannot be represented in the selected
  single-byte encoding instead of silently corrupting them;
- the README identifies supported input scope, experimental operations, known
  limitations, and the mandatory original-JAR backup workflow.

These criteria establish a testable beta boundary, not production readiness.
Before a stable release, the **limited** and **no** cells above must be reassessed
with legally redistributable synthetic fixtures and representative manual runtime
checks.
