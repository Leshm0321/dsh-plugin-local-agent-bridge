import type { ThreadItem } from "./ThreadItem";
import type { TurnError } from "./TurnError";
import type { TurnItemsView } from "./TurnItemsView";
import type { TurnStatus } from "./TurnStatus";
export type Turn = {
    /**
     * Identifier for this turn. Codex-generated turn IDs are UUIDv7.
     */
    id: string;
    /**
     * Thread items currently included in this turn payload.
     */
    items: Array<ThreadItem>;
    /**
     * Describes how much of `items` has been loaded for this turn.
     */
    itemsView: TurnItemsView;
    status: TurnStatus;
    /**
     * Only populated when the Turn's status is failed.
     */
    error: TurnError | null;
    /**
     * Unix timestamp (in seconds) when the turn started.
     */
    startedAt: number | null;
    /**
     * Unix timestamp (in seconds) when the turn completed.
     */
    completedAt: number | null;
    /**
     * Duration between turn start and completion in milliseconds, if known.
     */
    durationMs: number | null;
};
