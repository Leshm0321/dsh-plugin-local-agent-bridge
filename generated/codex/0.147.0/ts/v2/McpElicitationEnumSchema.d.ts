import type { McpElicitationLegacyTitledEnumSchema } from "./McpElicitationLegacyTitledEnumSchema";
import type { McpElicitationMultiSelectEnumSchema } from "./McpElicitationMultiSelectEnumSchema";
import type { McpElicitationSingleSelectEnumSchema } from "./McpElicitationSingleSelectEnumSchema";
export type McpElicitationEnumSchema = McpElicitationSingleSelectEnumSchema | McpElicitationMultiSelectEnumSchema | McpElicitationLegacyTitledEnumSchema;
