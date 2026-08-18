import type { McpElicitationBooleanSchema } from "./McpElicitationBooleanSchema";
import type { McpElicitationEnumSchema } from "./McpElicitationEnumSchema";
import type { McpElicitationNumberSchema } from "./McpElicitationNumberSchema";
import type { McpElicitationStringSchema } from "./McpElicitationStringSchema";
export type McpElicitationPrimitiveSchema = McpElicitationEnumSchema | McpElicitationStringSchema | McpElicitationNumberSchema | McpElicitationBooleanSchema;
