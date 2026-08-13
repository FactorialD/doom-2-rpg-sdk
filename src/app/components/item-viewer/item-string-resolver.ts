import type { EntityDef } from '../../services/doom-entities.service';
import type { TextEntry } from '../../services/doom-text.service';

export type EntityStringReferences = Pick<EntityDef, 'nameId' | 'longNameId' | 'descriptionId'>;

export function resolveEntityString(id: number, entries: readonly TextEntry[]): string {
    return entries.find(entry => entry.id === id)?.raw ?? 'String not found';
}

/** Resolves the three uint8 references without changing the entities.bin record. */
export function resolveEntityStrings(
    references: EntityStringReferences,
    entries: readonly TextEntry[]
): Record<keyof EntityStringReferences, string> {
    return {
        nameId: resolveEntityString(references.nameId, entries),
        longNameId: resolveEntityString(references.longNameId, entries),
        descriptionId: resolveEntityString(references.descriptionId, entries)
    };
}
