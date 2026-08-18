import type { CodexErrorInfo } from "./CodexErrorInfo";
export type TurnError = {
    message: string;
    codexErrorInfo: CodexErrorInfo | null;
    additionalDetails: string | null;
};
