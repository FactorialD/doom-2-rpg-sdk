# Doom II RPG map geometry format

This note documents the geometry section of `mapXX.bin`. The primary evidence is
`Render.java` as decompiled in `java/Render.txt` (allocation/loading around lines
715–800, drawing around lines 1457–1560 and collision around lines 1265–1290),
with the rendering overview in `java/help/03_Rendering_Engine.md`. The SDK parser
and serializer deliberately retain these source records rather than attempting
to infer a more conventional indexed-mesh format.

## Counts and section order

The 46-byte header stores six unsigned 16-bit counts at offset 11: nodes, leaves,
collision lines, normals, polygons and **polygon vertex records**. The last count
is not a count of unique positions: vertices are consecutive per leaf and per
polygon. Sections are separated by `0xDEADBEEF` for the first two markers and
`0xCAFEBABE` thereafter:

1. normals; 2. node offsets; 3. node normal indices; 4. node children; 5. node
bounds; 6. leaf vertex/polygon offsets; 7. polygon attributes and vertex arrays;
8. collision lines; 9. the height map; 10. sprites and all later map sections.
All multi-byte fields are little-endian.

## Records and index relationships

* **Normal** — three signed `int16` values. Internal BSP nodes select one normal
  through their `uint8 normalIndex`; the engine evaluates a 2.14 fixed-point
  plane equation and adds the node's unsigned offset.
* **Node** — `uint16 offset`, `uint8 normalIndex`, two `uint16` children, then
  byte bounds `(minX,maxX,minY,maxY)`. `offset == 0xffff` denotes a leaf node.
  Otherwise both children index the node array.
* **Leaf** — the leaf node's first child is packed as
  `(polygonCount << 9) | leafIndex`; counts therefore have 7 bits and leaf
  indices 9 bits. `leafIndex` selects parallel `uint16 nodeVertOffset` and
  `uint16 nodePolyOffset` arrays. Starting at those offsets, polygon vertex
  counts are accumulated to locate each polygon's records. Structural edits are
  safe without rebuilding BSP only when all new coordinates stay inside one
  existing leaf; the editor enforces this and adjusts subsequent offsets.
* **Polygon** — parallel byte arrays `polyTex` and `polyFlags`. Bits 0–2 encode
  `vertexCount - 2` (2…9). Bits 3–4 choose the extrusion axis for a two-record
  wall; bit 5 adds 257 to the texture group; bit 6 swaps texture coordinates;
  bit 7 selects the wall UV delta direction. A 2-record polygon expands to a
  quad in the renderer. Other polygons are ordered N-gons and are triangle-fan
  rendered. Reversing record order changes winding/culling.
* **Vertex record** — five parallel bytes: unsigned X, Y, Z and signed U, V.
  Coordinates are multiplied by 128 by the game. SDK world axes are
  `(X,Z,Y)` because game Z is height. Records are not shared and are addressed
  only through the leaf offsets and accumulated polygon counts.
* **Collision line** — two unsigned byte XY endpoints. Its four-bit flag is
  packed into the low/high nibble of `lineFlags[i >> 1]`. These lines are used
  independently from render polygon edges, so adding a visible polygon does not
  synthesize collision. Flags must remain 0…15.
* **Height map** — exactly 1024 signed bytes, row-major 32×32. A sprite at game
  `(x,y)` samples `(y >> 6) * 32 + (x >> 6)` and scales the height by eight.

## Validation and serialization policy

The editable `MapGeometry` keeps normals, nodes, leaves, polygons, source vertex
records, collision lines and heightmap, plus derived Three.js buffers. Before
writing, counts and offsets must fit `uint16`, coordinates and line endpoints
must fit `uint8`, UV values must fit `int8`, packed leaf fields and collision
nibbles must fit their bit widths, and polygon ranges must be valid. Coincident
wall endpoints and zero-area flats are rejected. Geometry edits update the
header and every geometry section; sprite, script and later bytes continue
through their dedicated serializers/copy path.

There is currently no general BSP builder. The UI therefore only inserts a wall
or flat into an existing leaf when every snapped point lies within that leaf's
stored bounds. Cross-leaf edits are rejected rather than emitting a map whose
BSP references are invalid.
