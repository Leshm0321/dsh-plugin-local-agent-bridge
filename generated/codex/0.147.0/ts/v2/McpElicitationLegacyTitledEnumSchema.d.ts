import type { McpElicitationStringType } from "./McpElicitationStringType";
export type McpElicitationLegacyTitledEnumSchema = {
    type: McpElicitationStringType;
    title?: string;
    description?: string;
    enum: Array<string>;
    enumNames?: Array<string>;
    default?: string;
};
