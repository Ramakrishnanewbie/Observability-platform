package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
)

// ══════════════════════════════════════════════
//  TYPES
// ══════════════════════════════════════════════

// ─── Metrics ───
type Metric struct {
	Timestamp  time.Time `json:"timestamp"`
	Host       string    `json:"host"`
	MetricName string    `json:"metric_name"`
	Value      float64   `json:"value"`
	Unit       string    `json:"unit"`
}

// ─── Logs ───
type LogEntry struct {
	Timestamp time.Time         `json:"timestamp"`
	Host      string            `json:"host"`
	Source    string            `json:"source"`
	Severity  string            `json:"severity"`
	Message   string            `json:"message"`
	Tags      map[string]string `json:"tags,omitempty"`
}

type LogBatch struct {
	AgentID string     `json:"agent_id"`
	Logs    []LogEntry `json:"logs"`
}

// ─── Traces ───
type Span struct {
	TraceID    string            `json:"trace_id"`
	SpanID     string            `json:"span_id"`
	ParentID   string            `json:"parent_id"`
	Service    string            `json:"service"`
	Operation  string            `json:"operation"`
	Host       string            `json:"host"`
	StartTime  time.Time         `json:"start_time"`
	Duration   float64           `json:"duration_ms"`
	Status     string            `json:"status"` // "ok", "error"
	Tags       map[string]string `json:"tags,omitempty"`
}

type TraceBatch struct {
	AgentID string `json:"agent_id"`
	Spans   []Span `json:"spans"`
}

// ─── Alerts ───
type AlertRule struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	MetricName string  `json:"metric_name"`
	Condition  string  `json:"condition"` // "gt", "lt", "gte", "lte", "eq"
	Threshold  float64 `json:"threshold"`
	Duration   int     `json:"duration_minutes"` // must exceed threshold for this long
	Severity   string  `json:"severity"`         // "warning", "critical"
	Enabled    bool    `json:"enabled"`
	Host       string  `json:"host,omitempty"` // empty = all hosts
}

type Alert struct {
	ID         string    `json:"id"`
	RuleID     string    `json:"rule_id"`
	RuleName   string    `json:"rule_name"`
	MetricName string    `json:"metric_name"`
	Host       string    `json:"host"`
	Value      float64   `json:"value"`
	Threshold  float64   `json:"threshold"`
	Condition  string    `json:"condition"`
	Severity   string    `json:"severity"`
	Status     string    `json:"status"` // "firing", "resolved"
	FiredAt    time.Time `json:"fired_at"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
}

// ══════════════════════════════════════════════
//  GLOBALS
// ══════════════════════════════════════════════

var conn clickhouse.Conn

// In-memory alert rules (persisted to ClickHouse)
var (
	alertRules   []AlertRule
	alertRulesMu sync.RWMutex
	firingAlerts   map[string]*Alert // key: ruleID+host
	firingAlertsMu sync.RWMutex
)

func init() {
	firingAlerts = make(map[string]*Alert)
}

// ══════════════════════════════════════════════
//  CLICKHOUSE
// ══════════════════════════════════════════════

func connectClickHouse() (clickhouse.Conn, error) {
	c, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{"localhost:9000"},
		Auth: clickhouse.Auth{Database: "default"},
	})
	if err != nil {
		return nil, err
	}
	if err := c.Ping(context.Background()); err != nil {
		return nil, err
	}
	return c, nil
}

func initTables() error {
	tables := []string{
		// Metrics
		`CREATE TABLE IF NOT EXISTS metrics (
			timestamp   DateTime64(3),
			host        String,
			metric_name String,
			value       Float64,
			unit        String
		) ENGINE = MergeTree()
		ORDER BY (metric_name, host, timestamp)
		TTL toDateTime(timestamp) + INTERVAL 30 DAY`,

		// Logs
		`CREATE TABLE IF NOT EXISTS logs (
			timestamp  DateTime64(3),
			host       String,
			source     String,
			severity   LowCardinality(String),
			message    String,
			tags       Map(String, String)
		) ENGINE = MergeTree()
		ORDER BY (host, source, timestamp)
		TTL toDateTime(timestamp) + INTERVAL 30 DAY`,

		// Traces / Spans
		`CREATE TABLE IF NOT EXISTS spans (
			trace_id   String,
			span_id    String,
			parent_id  String,
			service    String,
			operation  String,
			host       String,
			start_time DateTime64(3),
			duration_ms Float64,
			status     LowCardinality(String),
			tags       Map(String, String)
		) ENGINE = MergeTree()
		ORDER BY (trace_id, start_time)
		TTL toDateTime(start_time) + INTERVAL 30 DAY`,

		// Alert Rules
		`CREATE TABLE IF NOT EXISTS alert_rules (
			id           String,
			name         String,
			metric_name  String,
			condition    String,
			threshold    Float64,
			duration_min UInt32,
			severity     LowCardinality(String),
			enabled      UInt8,
			host         String
		) ENGINE = ReplacingMergeTree()
		ORDER BY id`,

		// Alert History
		`CREATE TABLE IF NOT EXISTS alert_history (
			id          String,
			rule_id     String,
			rule_name   String,
			metric_name String,
			host        String,
			value       Float64,
			threshold   Float64,
			condition   String,
			severity    LowCardinality(String),
			status      LowCardinality(String),
			fired_at    DateTime64(3),
			resolved_at Nullable(DateTime64(3))
		) ENGINE = MergeTree()
		ORDER BY (fired_at, rule_id)
		TTL toDateTime(fired_at) + INTERVAL 90 DAY`,
	}

	for _, t := range tables {
		if err := conn.Exec(context.Background(), t); err != nil {
			return fmt.Errorf("table creation failed: %w", err)
		}
	}
	return nil
}

// ══════════════════════════════════════════════
//  METRICS HANDLERS
// ══════════════════════════════════════════════

func insertMetrics(metrics []Metric) error {
	batch, err := conn.PrepareBatch(context.Background(),
		"INSERT INTO metrics (timestamp, host, metric_name, value, unit)")
	if err != nil {
		return err
	}
	for _, m := range metrics {
		batch.Append(m.Timestamp, m.Host, m.MetricName, m.Value, m.Unit)
	}
	return batch.Send()
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var metrics []Metric
	if err := json.Unmarshal(body, &metrics); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if err := insertMetrics(metrics); err != nil {
		log.Printf("Insert metrics error: %v", err)
		http.Error(w, "Failed", 500)
		return
	}
	fmt.Printf("[%s] Stored %d metrics ✓\n", time.Now().Format("15:04:05"), len(metrics))
	jsonOK(w, map[string]interface{}{"status": "ok", "ingested": len(metrics)})
}

func handleQuery(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	query := `SELECT timestamp, host, metric_name, value, unit FROM metrics WHERE timestamp > now() - INTERVAL 5 MINUTE`
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, host)
	}
	query += ` ORDER BY timestamp DESC LIMIT 100`
	queryMetrics(w, query)
}

func handleTimeseries(w http.ResponseWriter, r *http.Request) {
	metricName := r.URL.Query().Get("metric")
	if metricName == "" {
		http.Error(w, "Missing 'metric'", 400)
		return
	}
	minutes := r.URL.Query().Get("minutes")
	if minutes == "" {
		minutes = "10"
	}
	host := r.URL.Query().Get("host")

	query := fmt.Sprintf(`SELECT timestamp, host, metric_name, value, unit FROM metrics
		WHERE metric_name = '%s' AND timestamp > now() - INTERVAL %s MINUTE`, metricName, minutes)
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, host)
	}
	query += ` ORDER BY timestamp ASC`
	queryMetrics(w, query)
}

func handleLatest(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	query := `SELECT timestamp, host, metric_name, value, unit FROM metrics WHERE timestamp > now() - INTERVAL 1 MINUTE`
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, host)
	}
	query += ` ORDER BY timestamp DESC LIMIT 50`

	rows, err := conn.Query(context.Background(), query)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	seen := map[string]bool{}
	var results []Metric
	for rows.Next() {
		var m Metric
		rows.Scan(&m.Timestamp, &m.Host, &m.MetricName, &m.Value, &m.Unit)
		key := m.Host + ":" + m.MetricName
		if !seen[key] {
			seen[key] = true
			results = append(results, m)
		}
	}
	jsonOK(w, results)
}

func queryMetrics(w http.ResponseWriter, query string) {
	rows, err := conn.Query(context.Background(), query)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()
	var results []Metric
	for rows.Next() {
		var m Metric
		rows.Scan(&m.Timestamp, &m.Host, &m.MetricName, &m.Value, &m.Unit)
		results = append(results, m)
	}
	jsonOK(w, results)
}

// ─── Multi-Host: List all known hosts ───
func handleHosts(w http.ResponseWriter, r *http.Request) {
	rows, err := conn.Query(context.Background(), `
		SELECT DISTINCT host FROM metrics WHERE timestamp > now() - INTERVAL 1 HOUR ORDER BY host
	`)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	var hosts []string
	for rows.Next() {
		var h string
		rows.Scan(&h)
		hosts = append(hosts, h)
	}
	jsonOK(w, hosts)
}

// ══════════════════════════════════════════════
//  LOG HANDLERS
// ══════════════════════════════════════════════

func insertLogs(logs []LogEntry) error {
	batch, err := conn.PrepareBatch(context.Background(),
		"INSERT INTO logs (timestamp, host, source, severity, message, tags)")
	if err != nil {
		return err
	}
	for _, l := range logs {
		ts := l.Timestamp
		if ts.IsZero() {
			ts = time.Now()
		}
		sev := strings.ToLower(l.Severity)
		if sev == "" {
			sev = "info"
		}
		tags := l.Tags
		if tags == nil {
			tags = map[string]string{}
		}
		batch.Append(ts, l.Host, l.Source, sev, l.Message, tags)
	}
	return batch.Send()
}

func handleLogsIngest(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()
	var batch LogBatch
	if err := json.Unmarshal(body, &batch); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if len(batch.Logs) == 0 {
		http.Error(w, "No logs", 400)
		return
	}
	if err := insertLogs(batch.Logs); err != nil {
		log.Printf("Insert logs error: %v", err)
		http.Error(w, "Failed", 500)
		return
	}
	fmt.Printf("[%s] 📝 Stored %d logs from [%s] ✓\n", time.Now().Format("15:04:05"), len(batch.Logs), batch.AgentID)
	jsonOK(w, map[string]interface{}{"status": "ok", "ingested": len(batch.Logs)})
}

func handleLogsQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", 405)
		return
	}

	search := r.URL.Query().Get("search")
	severity := r.URL.Query().Get("severity")
	source := r.URL.Query().Get("source")
	host := r.URL.Query().Get("host")
	limit := qDefault(r, "limit", "200")

	// Build query — skip time filter to avoid UTC vs local timezone issues
	query := `SELECT timestamp, host, source, severity, message FROM logs WHERE 1=1`
	if search != "" {
		query += fmt.Sprintf(` AND positionCaseInsensitive(message, '%s') > 0`, esc(search))
	}
	if severity != "" {
		query += fmt.Sprintf(` AND severity = '%s'`, strings.ToLower(severity))
	}
	if source != "" {
		query += fmt.Sprintf(` AND source = '%s'`, esc(source))
	}
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, esc(host))
	}
	query += fmt.Sprintf(` ORDER BY timestamp DESC LIMIT %s`, limit)

	log.Printf("[LOG QUERY] %s", query)

	rows, err := conn.Query(context.Background(), query)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type R struct {
		Timestamp string `json:"timestamp"`
		Host      string `json:"host"`
		Source    string `json:"source"`
		Severity  string `json:"severity"`
		Message   string `json:"message"`
	}
	results := make([]R, 0)
	for rows.Next() {
		var l R
		var ts time.Time
		rows.Scan(&ts, &l.Host, &l.Source, &l.Severity, &l.Message)
		l.Timestamp = ts.Format(time.RFC3339Nano)
		results = append(results, l)
	}
	log.Printf("[LOG QUERY] returning %d results", len(results))
	jsonOK(w, results)
}

func handleLogsStats(w http.ResponseWriter, r *http.Request) {
	// Skip time filter to avoid UTC vs local timezone mismatch
	query := `SELECT severity, count() as cnt FROM logs GROUP BY severity ORDER BY cnt DESC`
	rows, err := conn.Query(context.Background(), query)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type R struct {
		Severity string `json:"severity"`
		Count    uint64 `json:"count"`
	}
	results := make([]R, 0)
	for rows.Next() {
		var s R
		rows.Scan(&s.Severity, &s.Count)
		results = append(results, s)
	}
	jsonOK(w, results)
}

// ══════════════════════════════════════════════
//  TRACING HANDLERS
// ══════════════════════════════════════════════

func insertSpans(spans []Span) error {
	batch, err := conn.PrepareBatch(context.Background(),
		"INSERT INTO spans (trace_id, span_id, parent_id, service, operation, host, start_time, duration_ms, status, tags)")
	if err != nil {
		return err
	}
	for _, s := range spans {
		tags := s.Tags
		if tags == nil {
			tags = map[string]string{}
		}
		batch.Append(s.TraceID, s.SpanID, s.ParentID, s.Service, s.Operation, s.Host, s.StartTime, s.Duration, s.Status, tags)
	}
	return batch.Send()
}

// POST /v1/traces — ingest spans
func handleTracesIngest(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()
	var batch TraceBatch
	if err := json.Unmarshal(body, &batch); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if len(batch.Spans) == 0 {
		http.Error(w, "No spans", 400)
		return
	}
	if err := insertSpans(batch.Spans); err != nil {
		log.Printf("Insert spans error: %v", err)
		http.Error(w, "Failed", 500)
		return
	}
	fmt.Printf("[%s] 🔗 Stored %d spans from [%s] ✓\n", time.Now().Format("15:04:05"), len(batch.Spans), batch.AgentID)
	jsonOK(w, map[string]interface{}{"status": "ok", "ingested": len(batch.Spans)})
}

// GET /v1/traces?service=xxx&minutes=30&limit=50 — list recent traces
func handleTracesList(w http.ResponseWriter, r *http.Request) {
	service := r.URL.Query().Get("service")
	minutes := qDefault(r, "minutes", "30")
	limit := qDefault(r, "limit", "50")

	query := fmt.Sprintf(`
		SELECT trace_id, 
			   min(start_time) as trace_start,
			   max(start_time + toIntervalMillisecond(toUInt64(duration_ms))) as trace_end,
			   count() as span_count,
			   groupArray(service) as services,
			   sum(duration_ms) as total_duration,
			   max(if(status='error',1,0)) as has_error
		FROM spans
		WHERE start_time > now() - INTERVAL %s MINUTE
	`, minutes)
	if service != "" {
		query += fmt.Sprintf(` AND service = '%s'`, esc(service))
	}
	query += fmt.Sprintf(` GROUP BY trace_id ORDER BY trace_start DESC LIMIT %s`, limit)

	rows, err := conn.Query(context.Background(), query)
	if err != nil {
		log.Printf("Traces list error: %v", err)
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type TraceOverview struct {
		TraceID       string   `json:"trace_id"`
		StartTime     string   `json:"start_time"`
		EndTime       string   `json:"end_time"`
		SpanCount     uint64   `json:"span_count"`
		Services      []string `json:"services"`
		TotalDuration float64  `json:"total_duration_ms"`
		HasError      bool     `json:"has_error"`
	}

	var results []TraceOverview
	for rows.Next() {
		var t TraceOverview
		var start, end time.Time
		var hasErr uint8
		rows.Scan(&t.TraceID, &start, &end, &t.SpanCount, &t.Services, &t.TotalDuration, &hasErr)
		t.StartTime = start.Format(time.RFC3339Nano)
		t.EndTime = end.Format(time.RFC3339Nano)
		t.HasError = hasErr > 0
		// Deduplicate services
		t.Services = uniqueStrings(t.Services)
		results = append(results, t)
	}
	jsonOK(w, results)
}

// GET /v1/traces/{traceID} — get all spans for a trace
func handleTraceDetail(w http.ResponseWriter, r *http.Request) {
	// Extract trace ID from path: /v1/traces/abc123
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 || parts[3] == "" {
		http.Error(w, "Missing trace_id", 400)
		return
	}
	traceID := parts[3]

	rows, err := conn.Query(context.Background(), fmt.Sprintf(`
		SELECT trace_id, span_id, parent_id, service, operation, host, start_time, duration_ms, status, tags
		FROM spans WHERE trace_id = '%s' ORDER BY start_time ASC
	`, esc(traceID)))
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	var spans []Span
	for rows.Next() {
		var s Span
		rows.Scan(&s.TraceID, &s.SpanID, &s.ParentID, &s.Service, &s.Operation, &s.Host, &s.StartTime, &s.Duration, &s.Status, &s.Tags)
		spans = append(spans, s)
	}
	jsonOK(w, spans)
}

// GET /v1/traces/services — list all known services
func handleTraceServices(w http.ResponseWriter, r *http.Request) {
	rows, err := conn.Query(context.Background(), `
		SELECT DISTINCT service FROM spans WHERE start_time > now() - INTERVAL 1 HOUR ORDER BY service
	`)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()
	var services []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		services = append(services, s)
	}
	jsonOK(w, services)
}

// ══════════════════════════════════════════════
//  ALERTING
// ══════════════════════════════════════════════

func loadAlertRules() {
	rows, err := conn.Query(context.Background(), `
		SELECT id, name, metric_name, condition, threshold, duration_min, severity, enabled, host
		FROM alert_rules FINAL
	`)
	if err != nil {
		log.Printf("Failed to load alert rules: %v", err)
		return
	}
	defer rows.Close()

	alertRulesMu.Lock()
	defer alertRulesMu.Unlock()
	alertRules = nil

	for rows.Next() {
		var r AlertRule
		var enabled uint8
		rows.Scan(&r.ID, &r.Name, &r.MetricName, &r.Condition, &r.Threshold, &r.Duration, &r.Severity, &enabled, &r.Host)
		r.Enabled = enabled == 1
		alertRules = append(alertRules, r)
	}
	fmt.Printf("[%s] 🔔 Loaded %d alert rules\n", time.Now().Format("15:04:05"), len(alertRules))
}

func saveAlertRule(rule AlertRule) error {
	enabled := uint8(0)
	if rule.Enabled {
		enabled = 1
	}
	return conn.Exec(context.Background(),
		"INSERT INTO alert_rules (id, name, metric_name, condition, threshold, duration_min, severity, enabled, host) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		rule.ID, rule.Name, rule.MetricName, rule.Condition, rule.Threshold, uint32(rule.Duration), rule.Severity, enabled, rule.Host)
}

func saveAlertHistory(a *Alert) error {
	return conn.Exec(context.Background(),
		"INSERT INTO alert_history (id, rule_id, rule_name, metric_name, host, value, threshold, condition, severity, status, fired_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		a.ID, a.RuleID, a.RuleName, a.MetricName, a.Host, a.Value, a.Threshold, a.Condition, a.Severity, a.Status, a.FiredAt, a.ResolvedAt)
}

func evaluateCondition(value float64, cond string, threshold float64) bool {
	switch cond {
	case "gt":
		return value > threshold
	case "gte":
		return value >= threshold
	case "lt":
		return value < threshold
	case "lte":
		return value <= threshold
	case "eq":
		return value == threshold
	}
	return false
}

// alertEngine runs every 10 seconds, checks alert rules against recent metrics
func alertEngine() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		alertRulesMu.RLock()
		rules := make([]AlertRule, len(alertRules))
		copy(rules, alertRules)
		alertRulesMu.RUnlock()

		for _, rule := range rules {
			if !rule.Enabled {
				continue
			}
			checkAlertRule(rule)
		}
	}
}

func checkAlertRule(rule AlertRule) {
	durMin := rule.Duration
	if durMin < 1 {
		durMin = 1
	}

	query := fmt.Sprintf(`
		SELECT avg(value) FROM metrics
		WHERE metric_name = '%s' AND timestamp > now() - INTERVAL %d MINUTE
	`, esc(rule.MetricName), durMin)
	if rule.Host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, esc(rule.Host))
	}

	var avgVal float64
	row := conn.QueryRow(context.Background(), query)
	if err := row.Scan(&avgVal); err != nil {
		return
	}

	// Get hosts for this metric
	hostQuery := fmt.Sprintf(`SELECT DISTINCT host FROM metrics WHERE metric_name = '%s' AND timestamp > now() - INTERVAL %d MINUTE`, esc(rule.MetricName), durMin)
	if rule.Host != "" {
		hostQuery += fmt.Sprintf(` AND host = '%s'`, esc(rule.Host))
	}

	hostRows, err := conn.Query(context.Background(), hostQuery)
	if err != nil {
		return
	}
	defer hostRows.Close()

	for hostRows.Next() {
		var h string
		hostRows.Scan(&h)

		// Get avg for this specific host
		hQuery := fmt.Sprintf(`SELECT avg(value) FROM metrics WHERE metric_name = '%s' AND host = '%s' AND timestamp > now() - INTERVAL %d MINUTE`, esc(rule.MetricName), esc(h), durMin)
		var hAvg float64
		hRow := conn.QueryRow(context.Background(), hQuery)
		if err := hRow.Scan(&hAvg); err != nil {
			continue
		}

		alertKey := rule.ID + ":" + h
		firing := evaluateCondition(hAvg, rule.Condition, rule.Threshold)

		firingAlertsMu.Lock()
		existing, exists := firingAlerts[alertKey]

		if firing && !exists {
			// New alert
			alert := &Alert{
				ID:         generateID(),
				RuleID:     rule.ID,
				RuleName:   rule.Name,
				MetricName: rule.MetricName,
				Host:       h,
				Value:      hAvg,
				Threshold:  rule.Threshold,
				Condition:  rule.Condition,
				Severity:   rule.Severity,
				Status:     "firing",
				FiredAt:    time.Now(),
			}
			firingAlerts[alertKey] = alert
			saveAlertHistory(alert)
			fmt.Printf("[%s] 🚨 ALERT FIRING: %s on %s (%.2f %s %.2f)\n",
				time.Now().Format("15:04:05"), rule.Name, h, hAvg, rule.Condition, rule.Threshold)
		} else if !firing && exists {
			// Resolve
			now := time.Now()
			existing.Status = "resolved"
			existing.ResolvedAt = &now
			saveAlertHistory(existing)
			delete(firingAlerts, alertKey)
			fmt.Printf("[%s] ✅ ALERT RESOLVED: %s on %s\n",
				time.Now().Format("15:04:05"), rule.Name, h)
		}
		firingAlertsMu.Unlock()
	}
}

// ─── Alert API Handlers ───

// GET /v1/alerts/rules
func handleAlertRulesList(w http.ResponseWriter, r *http.Request) {
	alertRulesMu.RLock()
	defer alertRulesMu.RUnlock()
	jsonOK(w, alertRules)
}

// POST /v1/alerts/rules
func handleAlertRulesCreate(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()
	var rule AlertRule
	if err := json.Unmarshal(body, &rule); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if rule.ID == "" {
		rule.ID = generateID()
	}
	if rule.Condition == "" {
		rule.Condition = "gt"
	}
	if rule.Severity == "" {
		rule.Severity = "warning"
	}

	if err := saveAlertRule(rule); err != nil {
		log.Printf("Save alert rule error: %v", err)
		http.Error(w, "Failed", 500)
		return
	}

	alertRulesMu.Lock()
	alertRules = append(alertRules, rule)
	alertRulesMu.Unlock()

	fmt.Printf("[%s] 🔔 Created alert rule: %s\n", time.Now().Format("15:04:05"), rule.Name)
	jsonOK(w, rule)
}

// DELETE /v1/alerts/rules?id=xxx
func handleAlertRulesDelete(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing id", 400)
		return
	}

	// Remove from ClickHouse by inserting disabled version (ReplacingMergeTree)
	conn.Exec(context.Background(), fmt.Sprintf(`ALTER TABLE alert_rules DELETE WHERE id = '%s'`, esc(id)))

	alertRulesMu.Lock()
	for i, r := range alertRules {
		if r.ID == id {
			alertRules = append(alertRules[:i], alertRules[i+1:]...)
			break
		}
	}
	alertRulesMu.Unlock()

	jsonOK(w, map[string]string{"status": "deleted"})
}

// GET /v1/alerts/firing
func handleAlertsFiring(w http.ResponseWriter, r *http.Request) {
	firingAlertsMu.RLock()
	defer firingAlertsMu.RUnlock()
	var alerts []Alert
	for _, a := range firingAlerts {
		alerts = append(alerts, *a)
	}
	jsonOK(w, alerts)
}

// GET /v1/alerts/history?minutes=60&limit=100
func handleAlertsHistory(w http.ResponseWriter, r *http.Request) {
	minutes := qDefault(r, "minutes", "60")
	limit := qDefault(r, "limit", "100")

	rows, err := conn.Query(context.Background(), fmt.Sprintf(`
		SELECT id, rule_id, rule_name, metric_name, host, value, threshold, condition, severity, status, fired_at, resolved_at
		FROM alert_history WHERE fired_at > now() - INTERVAL %s MINUTE ORDER BY fired_at DESC LIMIT %s
	`, minutes, limit))
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	var results []Alert
	for rows.Next() {
		var a Alert
		var resolvedAt *time.Time
		rows.Scan(&a.ID, &a.RuleID, &a.RuleName, &a.MetricName, &a.Host, &a.Value, &a.Threshold, &a.Condition, &a.Severity, &a.Status, &a.FiredAt, &resolvedAt)
		a.ResolvedAt = resolvedAt
		results = append(results, a)
	}
	jsonOK(w, results)
}

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════

func jsonOK(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func qDefault(r *http.Request, key, def string) string {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	return v
}

func esc(s string) string {
	return strings.ReplaceAll(s, "'", "\\'")
}

func generateID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 12)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func uniqueStrings(input []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range input {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(200)
			return
		}
		next(w, r)
	}
}

// ══════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════

func main() {
	var err error
	conn, err = connectClickHouse()
	if err != nil {
		log.Fatalf("ClickHouse connection failed: %v", err)
	}
	fmt.Println("Connected to ClickHouse ✓")

	if err := initTables(); err != nil {
		log.Fatalf("Failed to init tables: %v", err)
	}
	fmt.Println("Tables initialized ✓")

	// Load alert rules from DB
	loadAlertRules()

	// Start alert evaluation engine
	go alertEngine()
	fmt.Println("Alert engine started ✓")

	// ── Metrics ──
	http.HandleFunc("/v1/metrics", corsMiddleware(handleMetrics))
	http.HandleFunc("/v1/query", corsMiddleware(handleQuery))
	http.HandleFunc("/v1/query/timeseries", corsMiddleware(handleTimeseries))
	http.HandleFunc("/v1/query/latest", corsMiddleware(handleLatest))
	http.HandleFunc("/v1/hosts", corsMiddleware(handleHosts))

	// ── Logs ── (stats must be registered BEFORE /v1/logs to avoid prefix match)
	http.HandleFunc("/v1/logs/stats", corsMiddleware(handleLogsStats))
	http.HandleFunc("/v1/logs", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		// Strip trailing slash edge case
		if strings.HasSuffix(r.URL.Path, "/stats") {
			handleLogsStats(w, r)
			return
		}
		switch r.Method {
		case http.MethodPost:
			handleLogsIngest(w, r)
		case http.MethodGet:
			handleLogsQuery(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))

	// ── Traces ──
	http.HandleFunc("/v1/traces", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			handleTracesIngest(w, r)
		case http.MethodGet:
			handleTracesList(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))
	http.HandleFunc("/v1/traces/services", corsMiddleware(handleTraceServices))
	http.HandleFunc("/v1/traces/", corsMiddleware(handleTraceDetail)) // /v1/traces/{id}

	// ── Alerts ──
	http.HandleFunc("/v1/alerts/rules", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleAlertRulesList(w, r)
		case http.MethodPost:
			handleAlertRulesCreate(w, r)
		case http.MethodDelete:
			handleAlertRulesDelete(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))
	http.HandleFunc("/v1/alerts/firing", corsMiddleware(handleAlertsFiring))
	http.HandleFunc("/v1/alerts/history", corsMiddleware(handleAlertsHistory))

	http.HandleFunc("/health", corsMiddleware(handleHealth))

	fmt.Println("=================================")
	fmt.Println("  Observo Server v2.0")
	fmt.Println("  Listening on :8080")
	fmt.Println("  ── Metrics ──")
	fmt.Println("  POST /v1/metrics")
	fmt.Println("  GET  /v1/query")
	fmt.Println("  GET  /v1/query/timeseries")
	fmt.Println("  GET  /v1/query/latest")
	fmt.Println("  GET  /v1/hosts")
	fmt.Println("  ── Logs ──")
	fmt.Println("  POST /v1/logs")
	fmt.Println("  GET  /v1/logs")
	fmt.Println("  GET  /v1/logs/stats")
	fmt.Println("  ── Traces ──")
	fmt.Println("  POST /v1/traces")
	fmt.Println("  GET  /v1/traces")
	fmt.Println("  GET  /v1/traces/{id}")
	fmt.Println("  GET  /v1/traces/services")
	fmt.Println("  ── Alerts ──")
	fmt.Println("  GET/POST/DELETE /v1/alerts/rules")
	fmt.Println("  GET  /v1/alerts/firing")
	fmt.Println("  GET  /v1/alerts/history")
	fmt.Println("=================================")

	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "healthy"})
}
