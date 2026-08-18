import type { ToolRequestUserInputQuestion } from "./ToolRequestUserInputQuestion";
/**
 * EXPERIMENTAL. Params sent with a request_user_input event.
 */
export type ToolRequestUserInputParams = {
    threadId: string;
    turnId: string;
    itemId: string;
    questions: Array<ToolRequestUserInputQuestion>;
    isBlocking: boolean;
    /**
     * @deprecated Use `isBlocking` to decide whether the request should block.
     */
    autoResolutionMs: number | null;
};
