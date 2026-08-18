import type { McpElicitationConstOption } from "./McpElicitationConstOption";
import type { McpElicitationStringType } from "./McpElicitationStringType";
export type McpElicitationTitledSingleSelectEnumSchema = {
    type: McpElicitationStringType;
    title?: string;
    description?: string;
    oneOf: Array<McpElicitationConstOption>;
    default?: string;
};
