import type { ThreadItem } from "./ThreadItem";
export type ItemCompletedNotification = {
    item: ThreadItem;
    threadId: string;
    turnId: string;
    /**
     * Unix timestamp (in milliseconds) when this item lifecycle completed.
     */
    completedAtMs: number;
};
