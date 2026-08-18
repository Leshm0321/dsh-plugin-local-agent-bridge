import type { McpElicitationStringType } from "./McpElicitationStringType";
export type McpElicitationUntitledSingleSelectEnumSchema = {
    type: McpElicitationStringType;
    title?: string;
    description?: string;
    enum: Array<string>;
    default?: string;
};
