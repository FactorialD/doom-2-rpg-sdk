/** Starts a browser download and releases its temporary resources on a later task. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;

  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor?.remove();
    }, 0);
  }
}
