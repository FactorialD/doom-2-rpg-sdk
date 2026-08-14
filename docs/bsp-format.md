# BSP and collision format (`mapXX.bin`)

This document records only behaviour demonstrated by `java/Render.txt`. Names
for the low collision flag values are deliberately not invented: the Java code
compares numeric values, but does not name them.

## Arrays loaded by `Render.loadMap`

The header supplies `numNodes`, `numLeafNodes`, `numLines`, `numNormals`,
`numPolys`, and `numVerts`. The geometry sections are structure-of-arrays:

* `normals`: `numNormals * 3` signed 16-bit components. Plane classification
  treats them as signed 2.14 fixed point.
* `nodeOffsets`: one unsigned-interpreted 16-bit value per node. `0xffff`
  identifies a leaf. Otherwise the value is added to the fixed-point dot
  product and is therefore the split-plane constant, not a byte offset.
* `nodeNormalIdxs`: one unsigned 8-bit index into `normals` per node.
* `nodeChildOffset1` and `nodeChildOffset2`: one 16-bit word each per node.
  For an internal node they are direct indexes into all node arrays. For a leaf
  they are packed records described below.
* `nodeBoundXs` and `nodeBoundYs`: two unsigned bytes (minimum, maximum) per
  node. `traceWorld` rejects nodes using these bounds before traversing them;
  `getNodeForPoint` checks the selected leaf bounds after traversal.
* `nodeVertOffset` and `nodePolyOffset`: one unsigned 16-bit starting index per
  logical leaf into the sequential vertex and polygon arrays.

Node zero is the root. For an internal node, `nodeClassifyPoint` computes

```text
((x * normal.x + y * normal.y + z * normal.z) >> 14) + unsigned(nodeOffset)
```

with engine-space coordinates. Map geometry bytes are converted to that space
by shifting left seven bits. A positive result selects `child1`; zero or a
negative result selects `child2` in `getNodeForPoint`. `traceWorld` uses
`child1` first for a non-negative start-point classification, then tries the
other child if the first reports no hit.

## Packed leaf children

When `nodeOffsets[node] == 0xffff`:

* `child1 & 0x01ff` is the logical leaf index (`0..511`).
* `(child1 >> 9) & 0x7f` is the number of polygons in that leaf (`0..127`).
  Their first polygon and vertex come from `nodePolyOffset[leaf]` and
  `nodeVertOffset[leaf]`.
* `child2 & 0x03ff` is the first collision-line index (`0..1023`).
* `(child2 >> 10) & 0x3f` is the collision-line count (`0..63`).

Both packed words must be regenerated whenever sequential ranges move.

## Collision lines and four-bit flags

There are `numLines` segments. X endpoints and Y endpoints are separate
unsigned-byte arrays. Two flags share each byte: the even line uses bits 0–3
and the odd line bits 4–7. Java consistently obtains `value = nibble & 7` for
collision decisions; bit `8` is set by automap visibility processing.

Observed `traceWorld` behaviour is intentionally stated numerically:

* low value `4` and low value `6` are skipped;
* low value `5` is skipped unless trace option bit `16` or `2048` is present;
* low value `7` additionally performs a directed-side test and may be skipped;
* other low values reach the segment/capsule intersection test.

`drawNodeLines` also excludes low values `1`, `2`, `3`, `5`, and `7` from its
ordinary automap occlusion path, handles `6` by setting bit `8`, and processes
`0` and `4` through that path. These observations do **not** establish stable
semantic names for values 0–7; callers should preserve numeric flags until
additional game behaviour is proven from Java code.

