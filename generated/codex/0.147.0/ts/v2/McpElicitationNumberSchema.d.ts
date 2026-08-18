import type { McpElicitationNumberType } from "./McpElicitationNumberType";
export type McpElicitationNumberSchema = {
    type: McpElicitationNumberType;
    title?: string;
    description?: string;
    minimum?: number;
    maximum?: number;
    default?: number;
};
