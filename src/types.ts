
export interface MapPolygon {
    textureId: number;
    flags: number;
    vertices: {x: number, y: number, z: number, u: number, v: number}[];
}

export interface GameTexture {
    id: number;
    width: number;
    height: number;
    data: Uint8Array; // RGBA
}

export interface MapTile {
    floorId: number | null;
    wallId: number | null;
    entityId: number | null;
}

export interface RawSprite {
    x: number;
    y: number;
    z: number;
    id: number;
}

export interface RawMapData {
    polygons: MapPolygon[];
    textures: Map<number, GameTexture>;
    sprites: RawSprite[];
}
