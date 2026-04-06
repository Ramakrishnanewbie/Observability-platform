import { relations } from "drizzle-orm";
import {
  organizations, users, memberships, api_keys,
  alert_rules, alert_history, data_sources,
} from "../schemas/platform";

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  api_keys: many(api_keys),
  alert_rules: many(alert_rules),
  alert_history: many(alert_history),
  data_sources: many(data_sources),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.user_id], references: [users.id] }),
  organization: one(organizations, { fields: [memberships.organization_id], references: [organizations.id] }),
}));

export const apiKeysRelations = relations(api_keys, ({ one }) => ({
  organization: one(organizations, { fields: [api_keys.organization_id], references: [organizations.id] }),
  created_by_user: one(users, { fields: [api_keys.created_by], references: [users.id] }),
}));

export const alertRulesRelations = relations(alert_rules, ({ one, many }) => ({
  organization: one(organizations, { fields: [alert_rules.organization_id], references: [organizations.id] }),
  created_by_user: one(users, { fields: [alert_rules.created_by], references: [users.id] }),
  history: many(alert_history),
}));

export const alertHistoryRelations = relations(alert_history, ({ one }) => ({
  organization: one(organizations, { fields: [alert_history.organization_id], references: [organizations.id] }),
  rule: one(alert_rules, { fields: [alert_history.rule_id], references: [alert_rules.id] }),
}));

export const dataSourcesRelations = relations(data_sources, ({ one }) => ({
  organization: one(organizations, { fields: [data_sources.organization_id], references: [organizations.id] }),
  created_by_user: one(users, { fields: [data_sources.created_by], references: [users.id] }),
}));
