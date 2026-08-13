export function firstClipboardImage(items: readonly Pick<ClipboardItem, 'types' | 'getType'>[]): Promise<Blob> {
  for (const item of items) { const type = item.types.find(value => value.startsWith('image/')); if (type) return item.getType(type); }
  return Promise.reject(new Error('Clipboard does not contain an image.'));
}

export async function readClipboardImage(clipboard: Pick<Clipboard, 'read'> | undefined = globalThis.navigator?.clipboard): Promise<Blob> {
  if (!clipboard?.read) throw new Error('Clipboard image access is not available in this browser. You can still use Ctrl+V.');
  try { return await firstClipboardImage(await clipboard.read()); }
  catch (error) { if (error instanceof Error && error.message.includes('does not contain')) throw error; throw new Error('Clipboard access was denied. Allow clipboard permission or use Ctrl+V.'); }
}
