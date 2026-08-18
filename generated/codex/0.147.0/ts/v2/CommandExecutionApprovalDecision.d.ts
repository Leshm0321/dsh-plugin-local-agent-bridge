import type { ExecPolicyAmendment } from "./ExecPolicyAmendment";
import type { NetworkPolicyAmendment } from "./NetworkPolicyAmendment";
export type CommandExecutionApprovalDecision = "accept" | "acceptForSession" | {
    "acceptWithExecpolicyAmendment": {
        execpolicy_amendment: ExecPolicyAmendment;
    };
} | {
    "applyNetworkPolicyAmendment": {
        network_policy_amendment: NetworkPolicyAmendment;
    };
} | "decline" | "cancel";
