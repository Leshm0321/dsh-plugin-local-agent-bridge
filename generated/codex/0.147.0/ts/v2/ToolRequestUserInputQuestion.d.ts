import type { ToolRequestUserInputOption } from "./ToolRequestUserInputOption";
/**
 * EXPERIMENTAL. Represents one request_user_input question and its required options.
 */
export type ToolRequestUserInputQuestion = {
    id: string;
    header: string;
    question: string;
    isOther: boolean;
    isSecret: boolean;
    options: Array<ToolRequestUserInputOption> | null;
};
