import { pgTable, uuid, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo_url: text("logo_url"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // Matches Supabase auth.users.id
  email: text("email").notNull().unique(),
  full_name: text("full_name"),
  avatar_url: text("avatar_url"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organization_id: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // "owner", "admin", "member", "viewer"
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const api_keys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key_hash: text("key_hash").notNull(), // SHA256 of the actual key
  key_prefix: text("key_prefix").notNull(), // First 8 chars for display
  created_by: uuid("created_by").references(() => users.id),
  is_active: boolean("is_active").notNull().default(true),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const alert_rules = pgTable("alert_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  metric_name: text("metric_name").notNull(),
  condition: text("condition").notNull(), // "gt", "lt", "gte", "lte"
  threshold: text("threshold").notNull(),
  duration_minutes: text("duration_minutes").notNull().default("1"),
  severity: text("severity").notNull().default("warning"), // "warning", "critical"
  is_enabled: boolean("is_enabled").notNull().default(true),
  host_filter: text("host_filter"), // null = all hosts
  notification_channels: jsonb("notification_channels"), // webhook URLs, email, Slack
  created_by: uuid("created_by").references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const alert_history = pgTable("alert_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  rule_id: uuid("rule_id").references(() => alert_rules.id, { onDelete: "set null" }),
  rule_name: text("rule_name").notNull(),
  metric_name: text("metric_name").notNull(),
  host: text("host").notNull(),
  value: text("value").notNull(),
  threshold: text("threshold").notNull(),
  condition: text("condition").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(), // "firing", "resolved"
  fired_at: timestamp("fired_at", { withTimezone: true }).notNull(),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
});

export const data_sources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  organization_id: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // "clickhouse", "otel_collector", "cloudwatch", "gcp_monitoring"
  config: jsonb("config").notNull(), // Connection details (encrypted)
  is_active: boolean("is_active").notNull().default(true),
  created_by: uuid("created_by").references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
