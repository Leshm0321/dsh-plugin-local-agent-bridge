import type { AbsolutePathBuf } from "./AbsolutePathBuf";
export type ImageGenerationItem = {
    id: string;
    status: string;
    revisedPrompt: string | null;
    result: string;
    transparentBackground?: boolean;
    savedPath?: AbsolutePathBuf;
};
