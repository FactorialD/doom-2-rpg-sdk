export const GeometryScale = {
    /** Scale factor for Vertex coordinates (128.0) */
    GEO: 128.0,
    /** Scale factor for Sprite coordinates in World units (16.0) */
    SPRITE: 16.0
};

export enum PolyFlag {
    /** Vertices are extruded along X axis */
    AxisX = 0,       // 0
    /** Vertices are extruded along Y axis (Depth) */
    AxisY = 8,       // 1 << 3
    /** Vertices are extruded along Z axis (Height) */
    AxisZ = 16,      // 2 << 3
    /** Mask for axis bits (24) */
    AxisMask = 24,
    
    /** Indicates this polygon uses a wall texture (offsets ID by 257) */
    WallTexture = 32, // 1 << 5
    
    /** Swap U/V coordinates */
    SwapXY = 64,      // 1 << 6
    
    /** Use delta X for UV mapping */
    UVDeltaX = 128    // 1 << 7
}