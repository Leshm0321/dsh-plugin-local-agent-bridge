import type { McpElicitationObjectType } from "./McpElicitationObjectType";
import type { McpElicitationPrimitiveSchema } from "./McpElicitationPrimitiveSchema";
/**
 * Typed form schema for MCP `elicitation/create` requests.
 *
 * This matches the `requestedSchema` shape from the MCP 2025-11-25
 * `ElicitRequestFormParams` schema.
 */
export type McpElicitationSchema = {
    $schema?: string;
    type: McpElicitationObjectType;
    properties: {
        [key in string]?: McpElicitationPrimitiveSchema;
    };
    required?: Array<string>;
};
