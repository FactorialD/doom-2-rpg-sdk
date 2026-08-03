
export class J2ME {
    // Converts 15-bit RGB (5-5-5) from J2ME Little Endian Short to RGBA components
    // Format in binary: 0RRRRRGGGGGBBBBB (Big Endian logic) -> but read as LE number
    static getRGBA(shortVal: number): {r: number, g: number, b: number, a: number} {
        // RGB555 expansion to RGB888
        
        // Extract 5-bit components
        const r5 = (shortVal >> 10) & 31;
        const g5 = (shortVal >> 5) & 31;
        const b5 = (shortVal) & 31;

        // Expand 5-bit to 8-bit by shifting and repeating MSB
        const r = (r5 << 3) | (r5 >> 2);
        const g = (g5 << 3) | (g5 >> 2);
        const b = (b5 << 3) | (b5 >> 2);

        return { r, g, b, a: 255 };
    }

    // Packs RGBA8888 back to RGB555 (Uint16)
    static packRGB555(r: number, g: number, b: number): number {
        // Downsample 8-bit to 5-bit (just take top 5 bits)
        const r5 = (r >> 3) & 31;
        const g5 = (g >> 3) & 31;
        const b5 = (b >> 3) & 31;

        // 0RRRRRGGGGGBBBBB
        return (r5 << 10) | (g5 << 5) | b5;
    }
}
