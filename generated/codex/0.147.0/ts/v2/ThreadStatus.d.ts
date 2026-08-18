import type { ThreadActiveFlag } from "./ThreadActiveFlag";
export type ThreadStatus = {
    "type": "notLoaded";
} | {
    "type": "idle";
} | {
    "type": "systemError";
} | {
    "type": "active";
    activeFlags: Array<ThreadActiveFlag>;
};
