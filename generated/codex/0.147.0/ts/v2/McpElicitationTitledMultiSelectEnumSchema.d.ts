import type { McpElicitationArrayType } from "./McpElicitationArrayType";
import type { McpElicitationTitledEnumItems } from "./McpElicitationTitledEnumItems";
export type McpElicitationTitledMultiSelectEnumSchema = {
    type: McpElicitationArrayType;
    title?: string;
    description?: string;
    minItems?: bigint;
    maxItems?: bigint;
    items: McpElicitationTitledEnumItems;
    default?: Array<string>;
};
