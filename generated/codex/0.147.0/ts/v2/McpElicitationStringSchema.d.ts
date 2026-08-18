import type { McpElicitationStringFormat } from "./McpElicitationStringFormat";
import type { McpElicitationStringType } from "./McpElicitationStringType";
export type McpElicitationStringSchema = {
    type: McpElicitationStringType;
    title?: string;
    description?: string;
    minLength?: number;
    maxLength?: number;
    format?: McpElicitationStringFormat;
    default?: string;
};
