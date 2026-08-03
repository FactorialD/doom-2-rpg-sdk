
export class ByteStream {
    public view: DataView;
    private cursor: number = 0;
  
    constructor(buffer: ArrayBuffer, public littleEndian: boolean = true) {
        this.view = new DataView(buffer);
    }
  
    get position(): number {
        return this.cursor;
    }

    set position(val: number) {
        this.cursor = val;
    }

    get length(): number {
        return this.view.byteLength;
    }
  
    readUByte(): number {
        return this.view.getUint8(this.cursor++);
    }

    readByte(): number {
        return this.view.getInt8(this.cursor++);
    }
  
    readUShort(): number {
        const v = this.view.getUint16(this.cursor, this.littleEndian);
        this.cursor += 2;
        return v;
    }
  
    readShort(): number {
        const v = this.view.getInt16(this.cursor, this.littleEndian);
        this.cursor += 2;
        return v;
    }
  
    readInt(): number {
        const v = this.view.getInt32(this.cursor, this.littleEndian);
        this.cursor += 4;
        return v;
    }
  
    skip(n: number) {
        this.cursor += n;
    }

    readByteArray(length: number): Uint8Array {
        const arr = new Uint8Array(this.view.buffer.slice(this.cursor, this.cursor + length));
        this.cursor += length;
        return arr;
    }

    readInt16Array(length: number): Int16Array {
        const arr = new Int16Array(length);
        for(let i=0; i<length; i++) {
            arr[i] = this.readShort();
        }
        return arr;
    }

    // Added to read indices correctly (0-65535 instead of -32768-32767)
    readUint16Array(length: number): Uint16Array {
        const arr = new Uint16Array(length);
        for(let i=0; i<length; i++) {
            arr[i] = this.readUShort();
        }
        return arr;
    }
}

export class BinaryWriter {
    private buffer: Uint8Array;
    private view: DataView;
    private cursor: number = 0;
    
    constructor(initialSize: number = 1024, public littleEndian: boolean = true) {
        this.buffer = new Uint8Array(initialSize);
        this.view = new DataView(this.buffer.buffer);
    }
    
    get position(): number {
        return this.cursor;
    }

    // Ensure capacity exists
    private ensureCapacity(additionalBytes: number) {
        if (this.cursor + additionalBytes > this.buffer.length) {
            const newSize = Math.max(this.buffer.length * 2, this.cursor + additionalBytes + 1024);
            const newBuffer = new Uint8Array(newSize);
            newBuffer.set(this.buffer);
            this.buffer = newBuffer;
            this.view = new DataView(this.buffer.buffer);
        }
    }

    writeUByte(val: number): this {
        this.ensureCapacity(1);
        this.view.setUint8(this.cursor++, val);
        return this;
    }

    writeByte(val: number): this {
        this.ensureCapacity(1);
        this.view.setInt8(this.cursor++, val);
        return this;
    }

    writeUShort(val: number): this {
        this.ensureCapacity(2);
        this.view.setUint16(this.cursor, val, this.littleEndian);
        this.cursor += 2;
        return this;
    }

    writeShort(val: number): this {
        this.ensureCapacity(2);
        this.view.setInt16(this.cursor, val, this.littleEndian);
        this.cursor += 2;
        return this;
    }

    writeInt(val: number): this {
        this.ensureCapacity(4);
        this.view.setInt32(this.cursor, val, this.littleEndian);
        this.cursor += 4;
        return this;
    }
    
    writeBytes(bytes: Uint8Array | number[]): this {
        this.ensureCapacity(bytes.length);
        if (bytes instanceof Uint8Array) {
            this.buffer.set(bytes, this.cursor);
        } else {
            this.buffer.set(new Uint8Array(bytes), this.cursor);
        }
        this.cursor += bytes.length;
        return this;
    }
    
    // Helper to write string with null terminator if needed, or length prefixed
    // For Doom RPG simple byte arrays are mostly used.

    getData(): Uint8Array {
        return this.buffer.slice(0, this.cursor);
    }
}
