/** Returns whether map keyboard shortcuts may handle an event from `target`. */
export function isMapKeyboardControlAllowed(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object') return true;

    const element = target as {
        tagName?: string;
        isContentEditable?: boolean;
        closest?: (selector: string) => unknown;
    };
    const tagName = element.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return false;
    if (element.isContentEditable) return false;

    // A child of a contenteditable region can be the event target.
    return !element.closest?.('[contenteditable]:not([contenteditable="false"])');
}
