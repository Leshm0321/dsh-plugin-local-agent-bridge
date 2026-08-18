import type { McpElicitationArrayType } from "./McpElicitationArrayType";
import type { McpElicitationUntitledEnumItems } from "./McpElicitationUntitledEnumItems";
export type McpElicitationUntitledMultiSelectEnumSchema = {
    type: McpElicitationArrayType;
    title?: string;
    description?: string;
    minItems?: bigint;
    maxItems?: bigint;
    items: McpElicitationUntitledEnumItems;
    default?: Array<string>;
};
