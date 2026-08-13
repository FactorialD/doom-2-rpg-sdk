export function isPointerButtonPressed(event: Pick<PointerEvent, 'buttons'>, button: number): boolean {
    return (event.buttons & (1 << button)) !== 0;
}

export function moveSelectionPixels(data: Uint8Array, width: number, height: number, selection: { x: number; y: number; width: number; height: number }, nextX: number, nextY: number, clearIndex = 0): Uint8Array {
    const snapshot = new Uint8Array(data);
    const result = new Uint8Array(snapshot);
    for (let sy = 0; sy < selection.height; sy++) for (let sx = 0; sx < selection.width; sx++) {
        const x = selection.x + sx, y = selection.y + sy;
        if (x >= 0 && x < width && y >= 0 && y < height) result[y * width + x] = clearIndex;
    }
    for (let sy = 0; sy < selection.height; sy++) for (let sx = 0; sx < selection.width; sx++) {
        const sourceX = selection.x + sx, sourceY = selection.y + sy;
        const destinationX = nextX + sx, destinationY = nextY + sy;
        if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height || destinationX < 0 || destinationX >= width || destinationY < 0 || destinationY >= height) continue;
        result[destinationY * width + destinationX] = snapshot[sourceY * width + sourceX];
    }
    return result;
}

export function firstClipboardImage(items: Pick<DataTransferItem, 'type' | 'getAsFile'>[]): File | null {
    return items.find(item => item.type.startsWith('image/'))?.getAsFile() ?? null;
}
