export function isPointerButtonPressed(event: Pick<PointerEvent, 'buttons'>, button: number): boolean {
    return (event.buttons & (1 << button)) !== 0;
}

export interface CanvasPoint { x: number; y: number }

/** Returns every integer pixel touched by the inclusive line from start to end. */
export function rasterizeLine(start: CanvasPoint, end: CanvasPoint): CanvasPoint[] {
    const points: CanvasPoint[] = [];
    let x = start.x;
    let y = start.y;
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const stepX = start.x < end.x ? 1 : -1;
    const stepY = start.y < end.y ? 1 : -1;
    let error = dx - dy;

    while (true) {
        points.push({ x, y });
        if (x === end.x && y === end.y) break;
        const doubledError = error * 2;
        if (doubledError > -dy) {
            error -= dy;
            x += stepX;
        }
        if (doubledError < dx) {
            error += dx;
            y += stepY;
        }
    }
    return points;
}

export type PixelBuffer = Uint8Array | Uint8ClampedArray;

export function paintBrush<T extends PixelBuffer>(data: T, width: number, height: number, point: CanvasPoint, color: ArrayLike<number>, size = 1, channels = 1): T {
    const result = data.slice() as T;
    const radius = Math.max(0, Math.floor(size / 2));
    for (let y = point.y - radius; y <= point.y + radius; y++) for (let x = point.x - radius; x <= point.x + radius; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const offset = (y * width + x) * channels;
        for (let channel = 0; channel < channels; channel++) result[offset + channel] = color[channel] ?? color[0];
    }
    return result;
}

export function floodFillPixels<T extends PixelBuffer>(data: T, width: number, height: number, start: CanvasPoint, color: ArrayLike<number>, channels = 1): T {
    const result = data.slice() as T;
    if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return result;
    const targetOffset = (start.y * width + start.x) * channels;
    const target = Array.from(result.slice(targetOffset, targetOffset + channels));
    if (target.every((value, channel) => value === (color[channel] ?? color[0]))) return result;
    const matches = (offset: number) => target.every((value, channel) => result[offset + channel] === value);
    const queue: CanvasPoint[] = [start];
    while (queue.length) {
        const point = queue.pop()!;
        const offset = (point.y * width + point.x) * channels;
        if (!matches(offset)) continue;
        for (let channel = 0; channel < channels; channel++) result[offset + channel] = color[channel] ?? color[0];
        if (point.x) queue.push({ x: point.x - 1, y: point.y });
        if (point.x + 1 < width) queue.push({ x: point.x + 1, y: point.y });
        if (point.y) queue.push({ x: point.x, y: point.y - 1 });
        if (point.y + 1 < height) queue.push({ x: point.x, y: point.y + 1 });
    }
    return result;
}

export function moveSelectionPixels<T extends PixelBuffer>(data: T, width: number, height: number, selection: { x: number; y: number; width: number; height: number }, nextX: number, nextY: number, clearPixel: number | ArrayLike<number> = 0, channels = 1): T {
    const snapshot = new Uint8Array(data);
    const result = data.slice() as T;
    const clear = typeof clearPixel === 'number' ? [clearPixel] : clearPixel;
    for (let sy = 0; sy < selection.height; sy++) for (let sx = 0; sx < selection.width; sx++) {
        const x = selection.x + sx, y = selection.y + sy;
        if (x >= 0 && x < width && y >= 0 && y < height) for (let channel = 0; channel < channels; channel++) result[(y * width + x) * channels + channel] = clear[channel] ?? clear[0];
    }
    for (let sy = 0; sy < selection.height; sy++) for (let sx = 0; sx < selection.width; sx++) {
        const sourceX = selection.x + sx, sourceY = selection.y + sy;
        const destinationX = nextX + sx, destinationY = nextY + sy;
        if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height || destinationX < 0 || destinationX >= width || destinationY < 0 || destinationY >= height) continue;
        for (let channel = 0; channel < channels; channel++) result[(destinationY * width + destinationX) * channels + channel] = snapshot[(sourceY * width + sourceX) * channels + channel];
    }
    return result;
}

export function firstClipboardImage(items: Pick<DataTransferItem, 'type' | 'getAsFile'>[]): File | null {
    return items.find(item => item.type.startsWith('image/'))?.getAsFile() ?? null;
}
