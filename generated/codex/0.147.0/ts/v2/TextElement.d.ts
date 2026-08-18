import type { ByteRange } from "./ByteRange";
export type TextElement = {
    /**
     * Byte range in the parent `text` buffer that this element occupies.
     */
    byteRange: ByteRange;
    /**
     * Optional human-readable placeholder for the element, displayed in the UI.
     */
    placeholder: string | null;
};
