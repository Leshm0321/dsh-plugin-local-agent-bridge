/**
 * An independently persisted, user-visible thread section.
 */
export type ThreadSection = {
    /**
     * Opaque UUIDv7 identity that remains stable when the section is renamed.
     */
    id: string;
    /**
     * The current user-visible section name.
     */
    name: string;
};
