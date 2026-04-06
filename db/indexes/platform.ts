import { index, uniqueIndex } from "drizzle-orm/pg-core";
import { memberships, alert_rules, alert_history, api_keys, data_sources } from "../schemas/platform";

// Membership lookup by user + org
export const membershipUserOrgIdx = uniqueIndex("membership_user_org_idx")
  .on(memberships.user_id, memberships.organization_id);

// Alert rules by org
export const alertRulesOrgIdx = index("alert_rules_org_idx")
  .on(alert_rules.organization_id);

// Alert history by org + fired_at for time queries
export const alertHistoryOrgTimeIdx = index("alert_history_org_time_idx")
  .on(alert_history.organization_id, alert_history.fired_at);

// API keys by org
export const apiKeysOrgIdx = index("api_keys_org_idx")
  .on(api_keys.organization_id);

// Data sources by org
export const dataSourcesOrgIdx = index("data_sources_org_idx")
  .on(data_sources.organization_id);
