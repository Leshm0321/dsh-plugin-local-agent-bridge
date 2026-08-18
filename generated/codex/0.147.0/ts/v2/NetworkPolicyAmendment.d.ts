import type { NetworkPolicyRuleAction } from "./NetworkPolicyRuleAction";
export type NetworkPolicyAmendment = {
    host: string;
    action: NetworkPolicyRuleAction;
};
