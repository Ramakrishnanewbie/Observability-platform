package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ══════════════════════════════════════════════
//  TYPES
// ══════════════════════════════════════════════

type Metric struct {
	Timestamp  time.Time         `json:"timestamp"`
	Host       string            `json:"host"`
	MetricName string            `json:"metric_name"`
	Value      float64           `json:"value"`
	Unit       string            `json:"unit"`
	Tags       map[string]string `json:"tags,omitempty"`
}

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

type Span struct {
	TraceID   string            `json:"trace_id"`
	SpanID    string            `json:"span_id"`
	ParentID  string            `json:"parent_id"`
	Service   string            `json:"service"`
	Operation string            `json:"operation"`
	Host      string            `json:"host"`
	StartTime time.Time         `json:"start_time"`
	Duration  float64           `json:"duration_ms"`
	Status    string            `json:"status"`
	Tags      map[string]string `json:"tags,omitempty"`
}

type TraceBatch struct {
	AgentID string `json:"agent_id"`
	Spans   []Span `json:"spans"`
}

type AlertRule struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	MetricName string  `json:"metric_name"`
	Condition  string  `json:"condition"`
	Threshold  float64 `json:"threshold"`
	Duration   int     `json:"duration_minutes"`
	Severity   string  `json:"severity"`
	Enabled    bool    `json:"enabled"`
	Host       string  `json:"host,omitempty"`
}

type Alert struct {
	ID           string     `json:"id"`
	RuleID       string     `json:"rule_id"`
	RuleName     string     `json:"rule_name"`
	MetricName   string     `json:"metric_name"`
	Host         string     `json:"host"`
	Value        float64    `json:"value"`
	Threshold    float64    `json:"threshold"`
	Condition    string     `json:"condition"`
	Severity     string     `json:"severity"`
	Status       string     `json:"status"`
	FiredAt      time.Time  `json:"fired_at"`
	ResolvedAt   *time.Time `json:"resolved_at,omitempty"`
	Acknowledged bool       `json:"acknowledged"`
}

type HeartbeatPayload struct {
	AgentID  string            `json:"agent_id"`
	Host     string            `json:"host"`
	Platform string            `json:"platform"`
	Version  string            `json:"version"`
	Tags     map[string]string `json:"tags,omitempty"`
}

type ProcessMetric struct {
	Timestamp  time.Time `json:"timestamp"`
	Host       string    `json:"host"`
	PID        uint32    `json:"pid"`
	Name       string    `json:"name"`
	CPUPercent float64   `json:"cpu_percent"`
	MemPercent float64   `json:"mem_percent"`
	MemBytes   uint64    `json:"mem_bytes"`
	Status     string    `json:"status"`
}

type ProcessBatch struct {
	AgentID   string          `json:"agent_id"`
	Processes []ProcessMetric `json:"processes"`
}

type NetworkMetric struct {
	Timestamp   time.Time `json:"timestamp"`
	Host        string    `json:"host"`
	Interface   string    `json:"interface"`
	BytesSent   uint64    `json:"bytes_sent"`
	BytesRecv   uint64    `json:"bytes_recv"`
	PacketsSent uint64    `json:"packets_sent"`
	PacketsRecv uint64    `json:"packets_recv"`
	ErrIn       uint64    `json:"errin"`
	ErrOut      uint64    `json:"errout"`
}

type NetworkBatch struct {
	AgentID string          `json:"agent_id"`
	Network []NetworkMetric `json:"network"`
}

type NotificationChannel struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	URL     string `json:"url"`
	Enabled bool   `json:"enabled"`
}

type Anomaly struct {
	MetricName string  `json:"metric_name"`
	Host       string  `json:"host"`
	Mean       float64 `json:"mean"`
	StdDev     float64 `json:"stddev"`
	Latest     float64 `json:"latest"`
	ZScore     float64 `json:"z_score"`
	MaxVal     float64 `json:"max_val"`
	MinVal     float64 `json:"min_val"`
	Samples    int64   `json:"samples"`
	Severity   string  `json:"severity"`
}

// ══════════════════════════════════════════════
//  GLOBALS
// ══════════════════════════════════════════════

var db *pgxpool.Pool

var (
	alertRules     []AlertRule
	alertRulesMu   sync.RWMutex
	firingAlerts   map[string]*Alert
	firingAlertsMu sync.RWMutex
)

var (
	agentRegistry   map[string]HeartbeatPayload
	agentRegistryTs map[string]time.Time
	agentRegistryMu sync.RWMutex
)

var (
	notifChannels   []NotificationChannel
	notifChannelsMu sync.RWMutex
)

func init() {
	firingAlerts = make(map[string]*Alert)
	agentRegistry = make(map[string]HeartbeatPayload)
	agentRegistryTs = make(map[string]time.Time)
}

// ══════════════════════════════════════════════
//  DATABASE
// ══════════════════════════════════════════════

func connectDB() (*pgxpool.Pool, error) {
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		pgUser, pgPass, pgHost, pgPort, pgDB)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func initTables() error {
	ctx := context.Background()

	// Enable TimescaleDB (best-effort — gracefully degrades to plain PostgreSQL)
	if _, err := db.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`); err != nil {
		log.Printf("TimescaleDB extension not available, continuing with plain PostgreSQL: %v", err)
	}

	tables := []string{
		`CREATE TABLE IF NOT EXISTS metrics (
			timestamp   TIMESTAMPTZ NOT NULL,
			host        TEXT NOT NULL,
			metric_name TEXT NOT NULL,
			value       DOUBLE PRECISION NOT NULL,
			unit        TEXT NOT NULL DEFAULT '',
			tags        JSONB NOT NULL DEFAULT '{}'
		)`,
		`CREATE TABLE IF NOT EXISTS logs (
			timestamp  TIMESTAMPTZ NOT NULL,
			host       TEXT NOT NULL,
			source     TEXT NOT NULL,
			severity   TEXT NOT NULL,
			message    TEXT NOT NULL,
			tags       JSONB NOT NULL DEFAULT '{}'
		)`,
		`CREATE TABLE IF NOT EXISTS spans (
			trace_id    TEXT NOT NULL,
			span_id     TEXT NOT NULL,
			parent_id   TEXT NOT NULL DEFAULT '',
			service     TEXT NOT NULL,
			operation   TEXT NOT NULL,
			host        TEXT NOT NULL,
			start_time  TIMESTAMPTZ NOT NULL,
			duration_ms DOUBLE PRECISION NOT NULL,
			status      TEXT NOT NULL,
			tags        JSONB NOT NULL DEFAULT '{}'
		)`,
		`CREATE TABLE IF NOT EXISTS alert_rules (
			id           TEXT PRIMARY KEY,
			name         TEXT NOT NULL,
			metric_name  TEXT NOT NULL,
			condition    TEXT NOT NULL,
			threshold    DOUBLE PRECISION NOT NULL,
			duration_min INTEGER NOT NULL,
			severity     TEXT NOT NULL,
			enabled      BOOLEAN NOT NULL DEFAULT TRUE,
			host         TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS alert_history (
			id          TEXT NOT NULL,
			rule_id     TEXT NOT NULL,
			rule_name   TEXT NOT NULL,
			metric_name TEXT NOT NULL,
			host        TEXT NOT NULL,
			value       DOUBLE PRECISION NOT NULL,
			threshold   DOUBLE PRECISION NOT NULL,
			condition   TEXT NOT NULL,
			severity    TEXT NOT NULL,
			status      TEXT NOT NULL,
			fired_at    TIMESTAMPTZ NOT NULL,
			resolved_at TIMESTAMPTZ
		)`,
		`CREATE TABLE IF NOT EXISTS process_metrics (
			timestamp   TIMESTAMPTZ NOT NULL,
			host        TEXT NOT NULL,
			pid         INTEGER NOT NULL,
			name        TEXT NOT NULL,
			cpu_percent DOUBLE PRECISION NOT NULL,
			mem_percent DOUBLE PRECISION NOT NULL,
			mem_bytes   BIGINT NOT NULL,
			status      TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS network_metrics (
			timestamp    TIMESTAMPTZ NOT NULL,
			host         TEXT NOT NULL,
			interface    TEXT NOT NULL,
			bytes_sent   BIGINT NOT NULL,
			bytes_recv   BIGINT NOT NULL,
			packets_sent BIGINT NOT NULL,
			packets_recv BIGINT NOT NULL,
			errin        BIGINT NOT NULL,
			errout       BIGINT NOT NULL
		)`,
	}

	for _, t := range tables {
		if _, err := db.Exec(ctx, t); err != nil {
			return fmt.Errorf("table creation failed: %w", err)
		}
	}

	// Convert to TimescaleDB hypertables (best-effort)
	for _, stmt := range []string{
		`SELECT create_hypertable('metrics', 'timestamp', if_not_exists => TRUE)`,
		`SELECT create_hypertable('logs', 'timestamp', if_not_exists => TRUE)`,
		`SELECT create_hypertable('spans', 'start_time', if_not_exists => TRUE)`,
		`SELECT create_hypertable('alert_history', 'fired_at', if_not_exists => TRUE)`,
		`SELECT create_hypertable('process_metrics', 'timestamp', if_not_exists => TRUE)`,
		`SELECT create_hypertable('network_metrics', 'timestamp', if_not_exists => TRUE)`,
	} {
		db.Exec(ctx, stmt)
	}

	// Indexes
	for _, idx := range []string{
		`CREATE INDEX IF NOT EXISTS idx_metrics_name_host ON metrics (metric_name, host, timestamp DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_logs_host_ts ON logs (host, timestamp DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_logs_severity ON logs (severity)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans (trace_id, start_time)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_service ON spans (service, start_time DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans (parent_id)`,
	} {
		db.Exec(ctx, idx)
	}

	return nil
}

// ══════════════════════════════════════════════
//  METRICS HANDLERS
// ══════════════════════════════════════════════

func insertMetrics(metrics []Metric) error {
	batch := &pgx.Batch{}
	for _, m := range metrics {
		tags := m.Tags
		if tags == nil {
			tags = map[string]string{}
		}
		tagsJSON, _ := json.Marshal(tags)
		batch.Queue(
			`INSERT INTO metrics (timestamp, host, metric_name, value, unit, tags) VALUES ($1, $2, $3, $4, $5, $6)`,
			m.Timestamp, m.Host, m.MetricName, m.Value, m.Unit, tagsJSON,
		)
	}
	return db.SendBatch(context.Background(), batch).Close()
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
	query := `SELECT timestamp, host, metric_name, value, unit FROM metrics WHERE timestamp > NOW() - INTERVAL '5 minutes'`
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, esc(host))
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
		WHERE metric_name = '%s' AND timestamp > NOW() - INTERVAL '%s minutes'`, esc(metricName), minutes)
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, esc(host))
	}
	query += ` ORDER BY timestamp ASC`
	queryMetrics(w, query)
}

func handleLatest(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	query := `SELECT timestamp, host, metric_name, value, unit FROM metrics WHERE timestamp > NOW() - INTERVAL '1 minute'`
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, esc(host))
	}
	query += ` ORDER BY timestamp DESC LIMIT 50`

	rows, err := db.Query(context.Background(), query)
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
	rows, err := db.Query(context.Background(), query)
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

func handleHosts(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(context.Background(), `
		SELECT DISTINCT host FROM metrics WHERE timestamp > NOW() - INTERVAL '1 hour' ORDER BY host
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

func handleMetricNames(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(context.Background(), `
		SELECT DISTINCT metric_name FROM metrics WHERE timestamp > NOW() - INTERVAL '1 hour' ORDER BY metric_name
	`)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var n string
		rows.Scan(&n)
		names = append(names, n)
	}
	jsonOK(w, names)
}

// ══════════════════════════════════════════════
//  LOG HANDLERS
// ══════════════════════════════════════════════

func insertLogs(logs []LogEntry) error {
	batch := &pgx.Batch{}
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
		tagsJSON, _ := json.Marshal(tags)
		batch.Queue(
			`INSERT INTO logs (timestamp, host, source, severity, message, tags) VALUES ($1, $2, $3, $4, $5, $6)`,
			ts, l.Host, l.Source, sev, l.Message, tagsJSON,
		)
	}
	return db.SendBatch(context.Background(), batch).Close()
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
	fmt.Printf("[%s] Stored %d logs from [%s] ✓\n", time.Now().Format("15:04:05"), len(batch.Logs), batch.AgentID)
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
	minutes := r.URL.Query().Get("minutes")

	query := `SELECT timestamp, host, source, severity, message FROM logs WHERE 1=1`
	if minutes != "" {
		query += fmt.Sprintf(` AND timestamp > NOW() - INTERVAL '%s minutes'`, minutes)
	}
	if search != "" {
		query += fmt.Sprintf(` AND message ILIKE '%%%s%%'`, esc(search))
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

	rows, err := db.Query(context.Background(), query)
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
	jsonOK(w, results)
}

func handleLogsStats(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(context.Background(), `SELECT severity, COUNT(*) as cnt FROM logs GROUP BY severity ORDER BY cnt DESC`)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type R struct {
		Severity string `json:"severity"`
		Count    int64  `json:"count"`
	}
	results := make([]R, 0)
	for rows.Next() {
		var s R
		rows.Scan(&s.Severity, &s.Count)
		results = append(results, s)
	}
	jsonOK(w, results)
}

func handleLogSources(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(context.Background(), `
		SELECT source, COUNT(*) as cnt FROM logs
		WHERE timestamp > NOW() - INTERVAL '24 hours'
		GROUP BY source ORDER BY cnt DESC LIMIT 50
	`)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()
	type R struct {
		Source string `json:"source"`
		Count  int64  `json:"count"`
	}
	var results []R
	for rows.Next() {
		var s R
		rows.Scan(&s.Source, &s.Count)
		results = append(results, s)
	}
	jsonOK(w, results)
}

func handleLogsRate(w http.ResponseWriter, r *http.Request) {
	minutes := qDefault(r, "minutes", "60")
	rows, err := db.Query(context.Background(), fmt.Sprintf(`
		SELECT
			DATE_TRUNC('minute', timestamp) as minute,
			COUNT(*) FILTER (WHERE severity = 'error') as errors,
			COUNT(*) FILTER (WHERE severity = 'warn') as warnings,
			COUNT(*) as total
		FROM logs
		WHERE timestamp > NOW() - INTERVAL '%s minutes'
		GROUP BY minute ORDER BY minute ASC
	`, minutes))
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()
	type R struct {
		Minute   string `json:"minute"`
		Errors   int64  `json:"errors"`
		Warnings int64  `json:"warnings"`
		Total    int64  `json:"total"`
	}
	var results []R
	for rows.Next() {
		var rec R
		var t time.Time
		rows.Scan(&t, &rec.Errors, &rec.Warnings, &rec.Total)
		rec.Minute = t.Format(time.RFC3339)
		results = append(results, rec)
	}
	jsonOK(w, results)
}

// ══════════════════════════════════════════════
//  TRACING HANDLERS
// ══════════════════════════════════════════════

func insertSpans(spans []Span) error {
	batch := &pgx.Batch{}
	for _, s := range spans {
		tags := s.Tags
		if tags == nil {
			tags = map[string]string{}
		}
		tagsJSON, _ := json.Marshal(tags)
		batch.Queue(
			`INSERT INTO spans (trace_id, span_id, parent_id, service, operation, host, start_time, duration_ms, status, tags) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			s.TraceID, s.SpanID, s.ParentID, s.Service, s.Operation, s.Host, s.StartTime, s.Duration, s.Status, tagsJSON,
		)
	}
	return db.SendBatch(context.Background(), batch).Close()
}

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
	fmt.Printf("[%s] Stored %d spans from [%s] ✓\n", time.Now().Format("15:04:05"), len(batch.Spans), batch.AgentID)
	jsonOK(w, map[string]interface{}{"status": "ok", "ingested": len(batch.Spans)})
}

func handleTracesList(w http.ResponseWriter, r *http.Request) {
	service := r.URL.Query().Get("service")
	minutes := qDefault(r, "minutes", "30")
	limit := qDefault(r, "limit", "50")
	status := r.URL.Query().Get("status")

	query := fmt.Sprintf(`
		SELECT trace_id,
			MIN(start_time) as trace_start,
			MAX(start_time + (duration_ms * INTERVAL '1 millisecond')) as trace_end,
			COUNT(*) as span_count,
			ARRAY_TO_STRING(ARRAY_AGG(DISTINCT service), '|') as services,
			SUM(duration_ms) as total_duration,
			MAX(CASE WHEN status='error' THEN 1 ELSE 0 END) as has_error
		FROM spans
		WHERE start_time > NOW() - INTERVAL '%s minutes'
	`, minutes)
	if service != "" {
		query += fmt.Sprintf(` AND service = '%s'`, esc(service))
	}
	if status == "error" {
		query += ` AND trace_id IN (SELECT DISTINCT trace_id FROM spans WHERE status = 'error')`
	}
	query += fmt.Sprintf(` GROUP BY trace_id ORDER BY trace_start DESC LIMIT %s`, limit)

	rows, err := db.Query(context.Background(), query)
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
		SpanCount     int64    `json:"span_count"`
		Services      []string `json:"services"`
		TotalDuration float64  `json:"total_duration_ms"`
		HasError      bool     `json:"has_error"`
	}

	var results []TraceOverview
	for rows.Next() {
		var t TraceOverview
		var start, end time.Time
		var hasErr int
		var servicesStr string
		rows.Scan(&t.TraceID, &start, &end, &t.SpanCount, &servicesStr, &t.TotalDuration, &hasErr)
		t.StartTime = start.Format(time.RFC3339Nano)
		t.EndTime = end.Format(time.RFC3339Nano)
		t.HasError = hasErr > 0
		if servicesStr != "" {
			t.Services = uniqueStrings(strings.Split(servicesStr, "|"))
		}
		results = append(results, t)
	}
	jsonOK(w, results)
}

func handleTraceDetail(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 || parts[3] == "" {
		http.Error(w, "Missing trace_id", 400)
		return
	}
	traceID := parts[3]

	rows, err := db.Query(context.Background(), fmt.Sprintf(`
		SELECT trace_id, span_id, parent_id, service, operation, host, start_time, duration_ms, status
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
		rows.Scan(&s.TraceID, &s.SpanID, &s.ParentID, &s.Service, &s.Operation, &s.Host, &s.StartTime, &s.Duration, &s.Status)
		spans = append(spans, s)
	}
	jsonOK(w, spans)
}

func handleTraceServices(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(context.Background(), `
		SELECT DISTINCT service FROM spans WHERE start_time > NOW() - INTERVAL '1 hour' ORDER BY service
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
//  APM — SERVICE PERFORMANCE STATS
// ══════════════════════════════════════════════

func handleAPMServices(w http.ResponseWriter, r *http.Request) {
	minutes := qDefault(r, "minutes", "60")

	rows, err := db.Query(context.Background(), fmt.Sprintf(`
		SELECT
			service,
			COUNT(*) as requests,
			COUNT(*) FILTER (WHERE status = 'error') as errors,
			AVG(duration_ms) as avg_latency,
			PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms) as p50,
			PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95,
			PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99,
			MAX(duration_ms) as max_latency,
			MIN(duration_ms) as min_latency
		FROM spans
		WHERE start_time > NOW() - INTERVAL '%s minutes'
		GROUP BY service
		ORDER BY requests DESC
	`, minutes))
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type ServiceStats struct {
		Service    string  `json:"service"`
		Requests   int64   `json:"requests"`
		Errors     int64   `json:"errors"`
		ErrorRate  float64 `json:"error_rate"`
		Throughput float64 `json:"throughput_rpm"`
		AvgLatency float64 `json:"avg_latency_ms"`
		P50        float64 `json:"p50_ms"`
		P95        float64 `json:"p95_ms"`
		P99        float64 `json:"p99_ms"`
		MaxLatency float64 `json:"max_latency_ms"`
		MinLatency float64 `json:"min_latency_ms"`
	}

	mins, _ := parseFloat(minutes)
	if mins <= 0 {
		mins = 60
	}

	var results []ServiceStats
	for rows.Next() {
		var s ServiceStats
		rows.Scan(&s.Service, &s.Requests, &s.Errors, &s.AvgLatency, &s.P50, &s.P95, &s.P99, &s.MaxLatency, &s.MinLatency)
		if s.Requests > 0 {
			s.ErrorRate = float64(s.Errors) / float64(s.Requests) * 100
		}
		s.Throughput = float64(s.Requests) / mins
		results = append(results, s)
	}
	jsonOK(w, results)
}

func handleAPMServiceTimeseries(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/apm/services/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Missing service name", 400)
		return
	}
	service := parts[0]
	minutes := qDefault(r, "minutes", "60")

	rows, err := db.Query(context.Background(), fmt.Sprintf(`
		SELECT
			DATE_TRUNC('minute', start_time) as minute,
			COUNT(*) as requests,
			COUNT(*) FILTER (WHERE status = 'error') as errors,
			AVG(duration_ms) as avg_latency,
			PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95
		FROM spans
		WHERE service = '%s' AND start_time > NOW() - INTERVAL '%s minutes'
		GROUP BY minute ORDER BY minute ASC
	`, esc(service), minutes))
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type Point struct {
		Minute     string  `json:"minute"`
		Requests   int64   `json:"requests"`
		Errors     int64   `json:"errors"`
		AvgLatency float64 `json:"avg_latency_ms"`
		P95        float64 `json:"p95_ms"`
	}
	var results []Point
	for rows.Next() {
		var p Point
		var t time.Time
		rows.Scan(&t, &p.Requests, &p.Errors, &p.AvgLatency, &p.P95)
		p.Minute = t.Format(time.RFC3339)
		results = append(results, p)
	}
	jsonOK(w, results)
}

// ══════════════════════════════════════════════
//  SERVICE MAP / DEPENDENCY GRAPH
// ══════════════════════════════════════════════

func handleServiceGraph(w http.ResponseWriter, r *http.Request) {
	minutes := qDefault(r, "minutes", "60")

	rows, err := db.Query(context.Background(), fmt.Sprintf(`
		SELECT
			s.service as callee,
			p.service as caller,
			COUNT(*) as calls,
			COUNT(*) FILTER (WHERE s.status = 'error') as errors,
			AVG(s.duration_ms) as avg_duration
		FROM spans s
		JOIN spans p ON s.parent_id = p.span_id AND s.trace_id = p.trace_id
		WHERE s.start_time > NOW() - INTERVAL '%s minutes'
		  AND s.parent_id != ''
		GROUP BY caller, callee
		ORDER BY calls DESC
		LIMIT 200
	`, minutes))
	if err != nil {
		handleServiceGraphFallback(w, r, minutes)
		return
	}
	defer rows.Close()

	type Edge struct {
		Caller      string  `json:"caller"`
		Callee      string  `json:"callee"`
		Calls       int64   `json:"calls"`
		Errors      int64   `json:"errors"`
		ErrorRate   float64 `json:"error_rate"`
		AvgDuration float64 `json:"avg_duration_ms"`
	}

	services := map[string]bool{}
	var edges []Edge
	for rows.Next() {
		var e Edge
		rows.Scan(&e.Callee, &e.Caller, &e.Calls, &e.Errors, &e.AvgDuration)
		if e.Calls > 0 {
			e.ErrorRate = float64(e.Errors) / float64(e.Calls) * 100
		}
		edges = append(edges, e)
		services[e.Caller] = true
		services[e.Callee] = true
	}

	type Node struct {
		ID string `json:"id"`
	}
	var nodes []Node
	for s := range services {
		nodes = append(nodes, Node{ID: s})
	}

	jsonOK(w, map[string]interface{}{"nodes": nodes, "edges": edges})
}

func handleServiceGraphFallback(w http.ResponseWriter, r *http.Request, minutes string) {
	rows, err := db.Query(context.Background(), fmt.Sprintf(`
		SELECT service, COUNT(*) as calls, COUNT(*) FILTER (WHERE status='error') as errors
		FROM spans
		WHERE start_time > NOW() - INTERVAL '%s minutes'
		GROUP BY service ORDER BY calls DESC LIMIT 50
	`, minutes))
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type Node struct {
		ID        string  `json:"id"`
		Calls     int64   `json:"calls"`
		Errors    int64   `json:"errors"`
		ErrorRate float64 `json:"error_rate"`
	}
	var nodes []Node
	for rows.Next() {
		var n Node
		rows.Scan(&n.ID, &n.Calls, &n.Errors)
		if n.Calls > 0 {
			n.ErrorRate = float64(n.Errors) / float64(n.Calls) * 100
		}
		nodes = append(nodes, n)
	}
	jsonOK(w, map[string]interface{}{"nodes": nodes, "edges": []interface{}{}})
}

// ══════════════════════════════════════════════
//  PROCESS METRICS
// ══════════════════════════════════════════════

func handleProcessIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var pb ProcessBatch
	if err := json.Unmarshal(body, &pb); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if len(pb.Processes) == 0 {
		jsonOK(w, map[string]interface{}{"status": "ok", "ingested": 0})
		return
	}

	batch := &pgx.Batch{}
	for _, p := range pb.Processes {
		ts := p.Timestamp
		if ts.IsZero() {
			ts = time.Now()
		}
		batch.Queue(
			`INSERT INTO process_metrics (timestamp, host, pid, name, cpu_percent, mem_percent, mem_bytes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			ts, p.Host, int32(p.PID), p.Name, p.CPUPercent, p.MemPercent, int64(p.MemBytes), p.Status,
		)
	}
	if err := db.SendBatch(context.Background(), batch).Close(); err != nil {
		log.Printf("Insert process metrics error: %v", err)
		http.Error(w, "Failed", 500)
		return
	}
	jsonOK(w, map[string]interface{}{"status": "ok", "ingested": len(pb.Processes)})
}

func handleProcessQuery(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	limit := qDefault(r, "limit", "25")

	query := `
		SELECT timestamp, host, pid, name, cpu_percent, mem_percent, mem_bytes, status
		FROM process_metrics
		WHERE timestamp > NOW() - INTERVAL '2 minutes'
	`
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, esc(host))
	}
	query += fmt.Sprintf(` ORDER BY cpu_percent DESC LIMIT %s`, limit)

	rows, err := db.Query(context.Background(), query)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type R struct {
		Timestamp  string  `json:"timestamp"`
		Host       string  `json:"host"`
		PID        int32   `json:"pid"`
		Name       string  `json:"name"`
		CPUPercent float64 `json:"cpu_percent"`
		MemPercent float64 `json:"mem_percent"`
		MemBytes   int64   `json:"mem_bytes"`
		Status     string  `json:"status"`
	}
	seen := map[string]bool{}
	var results []R
	for rows.Next() {
		var p R
		var ts time.Time
		rows.Scan(&ts, &p.Host, &p.PID, &p.Name, &p.CPUPercent, &p.MemPercent, &p.MemBytes, &p.Status)
		p.Timestamp = ts.Format(time.RFC3339)
		key := fmt.Sprintf("%s:%d", p.Host, p.PID)
		if !seen[key] {
			seen[key] = true
			results = append(results, p)
		}
	}
	jsonOK(w, results)
}

// ══════════════════════════════════════════════
//  NETWORK METRICS
// ══════════════════════════════════════════════

func handleNetworkIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var nb NetworkBatch
	if err := json.Unmarshal(body, &nb); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if len(nb.Network) == 0 {
		jsonOK(w, map[string]interface{}{"status": "ok", "ingested": 0})
		return
	}

	batch := &pgx.Batch{}
	for _, n := range nb.Network {
		ts := n.Timestamp
		if ts.IsZero() {
			ts = time.Now()
		}
		batch.Queue(
			`INSERT INTO network_metrics (timestamp, host, interface, bytes_sent, bytes_recv, packets_sent, packets_recv, errin, errout) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			ts, n.Host, n.Interface, int64(n.BytesSent), int64(n.BytesRecv), int64(n.PacketsSent), int64(n.PacketsRecv), int64(n.ErrIn), int64(n.ErrOut),
		)
	}
	if err := db.SendBatch(context.Background(), batch).Close(); err != nil {
		log.Printf("Insert network metrics error: %v", err)
		http.Error(w, "Failed", 500)
		return
	}
	jsonOK(w, map[string]interface{}{"status": "ok", "ingested": len(nb.Network)})
}

func handleNetworkQuery(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	minutes := qDefault(r, "minutes", "10")

	query := fmt.Sprintf(`
		SELECT timestamp, host, interface, bytes_sent, bytes_recv, packets_sent, packets_recv, errin, errout
		FROM network_metrics
		WHERE timestamp > NOW() - INTERVAL '%s minutes'
	`, minutes)
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, esc(host))
	}
	query += ` ORDER BY timestamp DESC LIMIT 500`

	rows, err := db.Query(context.Background(), query)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type R struct {
		Timestamp   string `json:"timestamp"`
		Host        string `json:"host"`
		Interface   string `json:"interface"`
		BytesSent   int64  `json:"bytes_sent"`
		BytesRecv   int64  `json:"bytes_recv"`
		PacketsSent int64  `json:"packets_sent"`
		PacketsRecv int64  `json:"packets_recv"`
		ErrIn       int64  `json:"errin"`
		ErrOut      int64  `json:"errout"`
	}
	var results []R
	for rows.Next() {
		var n R
		var ts time.Time
		rows.Scan(&ts, &n.Host, &n.Interface, &n.BytesSent, &n.BytesRecv, &n.PacketsSent, &n.PacketsRecv, &n.ErrIn, &n.ErrOut)
		n.Timestamp = ts.Format(time.RFC3339)
		results = append(results, n)
	}
	jsonOK(w, results)
}

func handleNetworkLatest(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")

	query := `
		SELECT timestamp, host, interface, bytes_sent, bytes_recv, packets_sent, packets_recv, errin, errout
		FROM network_metrics
		WHERE timestamp > NOW() - INTERVAL '2 minutes'
	`
	if host != "" {
		query += fmt.Sprintf(` AND host = '%s'`, esc(host))
	}
	query += ` ORDER BY timestamp DESC LIMIT 100`

	rows, err := db.Query(context.Background(), query)
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	type R struct {
		Timestamp   string `json:"timestamp"`
		Host        string `json:"host"`
		Interface   string `json:"interface"`
		BytesSent   int64  `json:"bytes_sent"`
		BytesRecv   int64  `json:"bytes_recv"`
		PacketsSent int64  `json:"packets_sent"`
		PacketsRecv int64  `json:"packets_recv"`
		ErrIn       int64  `json:"errin"`
		ErrOut      int64  `json:"errout"`
	}
	seen := map[string]bool{}
	var results []R
	for rows.Next() {
		var n R
		var ts time.Time
		rows.Scan(&ts, &n.Host, &n.Interface, &n.BytesSent, &n.BytesRecv, &n.PacketsSent, &n.PacketsRecv, &n.ErrIn, &n.ErrOut)
		n.Timestamp = ts.Format(time.RFC3339)
		key := n.Host + ":" + n.Interface
		if !seen[key] {
			seen[key] = true
			results = append(results, n)
		}
	}
	jsonOK(w, results)
}

// ══════════════════════════════════════════════
//  AGENT HEARTBEATS
// ══════════════════════════════════════════════

func handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var hb HeartbeatPayload
	if err := json.Unmarshal(body, &hb); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	agentRegistryMu.Lock()
	agentRegistry[hb.AgentID] = hb
	agentRegistryTs[hb.AgentID] = time.Now()
	agentRegistryMu.Unlock()

	jsonOK(w, map[string]interface{}{"status": "ok", "agent_id": hb.AgentID})
}

func handleAgents(w http.ResponseWriter, r *http.Request) {
	agentRegistryMu.RLock()
	defer agentRegistryMu.RUnlock()

	type AgentStatus struct {
		AgentID    string    `json:"agent_id"`
		Host       string    `json:"host"`
		Platform   string    `json:"platform"`
		Version    string    `json:"version"`
		LastSeen   time.Time `json:"last_seen"`
		Status     string    `json:"status"`
		SecondsAgo float64   `json:"seconds_ago"`
	}

	now := time.Now()
	var agents []AgentStatus
	for id, hb := range agentRegistry {
		ts := agentRegistryTs[id]
		ago := now.Sub(ts).Seconds()
		status := "healthy"
		if ago > 60 {
			status = "stale"
		}
		if ago > 300 {
			status = "offline"
		}
		agents = append(agents, AgentStatus{
			AgentID: id, Host: hb.Host, Platform: hb.Platform,
			Version: hb.Version, LastSeen: ts, Status: status, SecondsAgo: ago,
		})
	}

	sort.Slice(agents, func(i, j int) bool {
		return agents[i].LastSeen.After(agents[j].LastSeen)
	})

	jsonOK(w, agents)
}

// ══════════════════════════════════════════════
//  ANOMALY DETECTION
// ══════════════════════════════════════════════

func handleAnomalies(w http.ResponseWriter, r *http.Request) {
	minutes := qDefault(r, "minutes", "60")
	threshold := 2.5

	rows, err := db.Query(context.Background(), fmt.Sprintf(`
		SELECT
			metric_name,
			host,
			AVG(value) as mean,
			STDDEV_POP(value) as stddev,
			MAX(value) as max_val,
			MIN(value) as min_val,
			COUNT(*) as samples,
			(ARRAY_AGG(value ORDER BY timestamp DESC))[1] as latest
		FROM metrics
		WHERE timestamp > NOW() - INTERVAL '%s minutes'
		GROUP BY metric_name, host
		HAVING COUNT(*) > 5
		ORDER BY metric_name, host
	`, minutes))
	if err != nil {
		http.Error(w, "Query failed", 500)
		return
	}
	defer rows.Close()

	var anomalies []Anomaly
	for rows.Next() {
		var a Anomaly
		rows.Scan(&a.MetricName, &a.Host, &a.Mean, &a.StdDev, &a.MaxVal, &a.MinVal, &a.Samples, &a.Latest)
		if a.StdDev > 0 {
			a.ZScore = math.Abs((a.Latest - a.Mean) / a.StdDev)
			if a.ZScore >= threshold {
				if a.ZScore >= threshold*1.5 {
					a.Severity = "critical"
				} else {
					a.Severity = "warning"
				}
				anomalies = append(anomalies, a)
			}
		}
	}

	sort.Slice(anomalies, func(i, j int) bool {
		return anomalies[i].ZScore > anomalies[j].ZScore
	})

	jsonOK(w, anomalies)
}

// ══════════════════════════════════════════════
//  NOTIFICATION CHANNELS
// ══════════════════════════════════════════════

func handleNotifChannelsList(w http.ResponseWriter, r *http.Request) {
	notifChannelsMu.RLock()
	defer notifChannelsMu.RUnlock()
	jsonOK(w, notifChannels)
}

func handleNotifChannelsCreate(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()
	var ch NotificationChannel
	if err := json.Unmarshal(body, &ch); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if ch.ID == "" {
		ch.ID = generateID()
	}

	notifChannelsMu.Lock()
	notifChannels = append(notifChannels, ch)
	notifChannelsMu.Unlock()

	jsonOK(w, ch)
}

func handleNotifChannelsDelete(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing id", 400)
		return
	}
	notifChannelsMu.Lock()
	for i, ch := range notifChannels {
		if ch.ID == id {
			notifChannels = append(notifChannels[:i], notifChannels[i+1:]...)
			break
		}
	}
	notifChannelsMu.Unlock()
	jsonOK(w, map[string]string{"status": "deleted"})
}

func handleNotifTest(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()
	var ch NotificationChannel
	if err := json.Unmarshal(body, &ch); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	err := sendNotification(ch, "Test Alert", "This is a test notification from Observo.", "info")
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed: %v", err), 500)
		return
	}
	jsonOK(w, map[string]string{"status": "sent"})
}

func sendNotification(ch NotificationChannel, title, body, severity string) error {
	if !ch.Enabled {
		return nil
	}
	payload := map[string]interface{}{
		"title": title, "message": body,
		"severity": severity, "source": "observo",
		"time": time.Now().Format(time.RFC3339),
	}

	switch ch.Type {
	case "slack":
		color := "#36a64f"
		if severity == "critical" {
			color = "#e01e5a"
		} else if severity == "warning" {
			color = "#ecb22e"
		}
		slackPayload := map[string]interface{}{
			"attachments": []map[string]interface{}{
				{"color": color, "title": title, "text": body, "footer": "Observo Platform", "ts": time.Now().Unix()},
			},
		}
		return postJSON(ch.URL, slackPayload)
	case "webhook":
		return postJSON(ch.URL, payload)
	}
	return nil
}

func postJSON(url string, payload interface{}) error {
	data, _ := json.Marshal(payload)
	resp, err := http.Post(url, "application/json", bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

// ══════════════════════════════════════════════
//  ALERTING
// ══════════════════════════════════════════════

func loadAlertRules() {
	rows, err := db.Query(context.Background(), `
		SELECT id, name, metric_name, condition, threshold, duration_min, severity, enabled, host
		FROM alert_rules
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
		var rule AlertRule
		rows.Scan(&rule.ID, &rule.Name, &rule.MetricName, &rule.Condition, &rule.Threshold, &rule.Duration, &rule.Severity, &rule.Enabled, &rule.Host)
		alertRules = append(alertRules, rule)
	}
	fmt.Printf("[%s] Loaded %d alert rules\n", time.Now().Format("15:04:05"), len(alertRules))
}

func saveAlertRule(rule AlertRule) error {
	_, err := db.Exec(context.Background(),
		`INSERT INTO alert_rules (id, name, metric_name, condition, threshold, duration_min, severity, enabled, host)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (id) DO UPDATE SET
		   name = EXCLUDED.name, metric_name = EXCLUDED.metric_name,
		   condition = EXCLUDED.condition, threshold = EXCLUDED.threshold,
		   duration_min = EXCLUDED.duration_min, severity = EXCLUDED.severity,
		   enabled = EXCLUDED.enabled, host = EXCLUDED.host`,
		rule.ID, rule.Name, rule.MetricName, rule.Condition, rule.Threshold,
		rule.Duration, rule.Severity, rule.Enabled, rule.Host)
	return err
}

func saveAlertHistory(a *Alert) error {
	_, err := db.Exec(context.Background(),
		`INSERT INTO alert_history (id, rule_id, rule_name, metric_name, host, value, threshold, condition, severity, status, fired_at, resolved_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		a.ID, a.RuleID, a.RuleName, a.MetricName, a.Host, a.Value, a.Threshold,
		a.Condition, a.Severity, a.Status, a.FiredAt, a.ResolvedAt)
	return err
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

	hostQuery := fmt.Sprintf(`SELECT DISTINCT host FROM metrics WHERE metric_name = '%s' AND timestamp > NOW() - INTERVAL '%d minutes'`, esc(rule.MetricName), durMin)
	if rule.Host != "" {
		hostQuery += fmt.Sprintf(` AND host = '%s'`, esc(rule.Host))
	}

	hostRows, err := db.Query(context.Background(), hostQuery)
	if err != nil {
		return
	}
	defer hostRows.Close()

	for hostRows.Next() {
		var h string
		hostRows.Scan(&h)

		hQuery := fmt.Sprintf(`SELECT AVG(value) FROM metrics WHERE metric_name = '%s' AND host = '%s' AND timestamp > NOW() - INTERVAL '%d minutes'`, esc(rule.MetricName), esc(h), durMin)
		var hAvg float64
		if err := db.QueryRow(context.Background(), hQuery).Scan(&hAvg); err != nil {
			continue
		}

		alertKey := rule.ID + ":" + h
		firing := evaluateCondition(hAvg, rule.Condition, rule.Threshold)

		firingAlertsMu.Lock()
		existing, exists := firingAlerts[alertKey]

		if firing && !exists {
			alert := &Alert{
				ID: generateID(), RuleID: rule.ID, RuleName: rule.Name,
				MetricName: rule.MetricName, Host: h, Value: hAvg,
				Threshold: rule.Threshold, Condition: rule.Condition,
				Severity: rule.Severity, Status: "firing", FiredAt: time.Now(),
			}
			firingAlerts[alertKey] = alert
			saveAlertHistory(alert)
			fmt.Printf("[%s] ALERT FIRING: %s on %s (%.2f %s %.2f)\n",
				time.Now().Format("15:04:05"), rule.Name, h, hAvg, rule.Condition, rule.Threshold)
			go fireNotifications(rule.Name, alert)
		} else if !firing && exists {
			now := time.Now()
			existing.Status = "resolved"
			existing.ResolvedAt = &now
			saveAlertHistory(existing)
			delete(firingAlerts, alertKey)
			fmt.Printf("[%s] ALERT RESOLVED: %s on %s\n", time.Now().Format("15:04:05"), rule.Name, h)
		}
		firingAlertsMu.Unlock()
	}
}

func fireNotifications(ruleName string, alert *Alert) {
	notifChannelsMu.RLock()
	channels := make([]NotificationChannel, len(notifChannels))
	copy(channels, notifChannels)
	notifChannelsMu.RUnlock()

	title := fmt.Sprintf("[%s] %s firing on %s", strings.ToUpper(alert.Severity), ruleName, alert.Host)
	body := fmt.Sprintf("Metric %s = %.2f (threshold: %s %.2f)", alert.MetricName, alert.Value, alert.Condition, alert.Threshold)

	for _, ch := range channels {
		if err := sendNotification(ch, title, body, alert.Severity); err != nil {
			log.Printf("Notification failed for channel %s: %v", ch.Name, err)
		}
	}
}

// ─── Alert API Handlers ───

func handleAlertRulesList(w http.ResponseWriter, r *http.Request) {
	alertRulesMu.RLock()
	defer alertRulesMu.RUnlock()
	jsonOK(w, alertRules)
}

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

	fmt.Printf("[%s] Created alert rule: %s\n", time.Now().Format("15:04:05"), rule.Name)
	jsonOK(w, rule)
}

func handleAlertRulesDelete(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing id", 400)
		return
	}

	db.Exec(context.Background(), `DELETE FROM alert_rules WHERE id = $1`, id)

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

func handleAlertsFiring(w http.ResponseWriter, r *http.Request) {
	firingAlertsMu.RLock()
	defer firingAlertsMu.RUnlock()
	var alerts []Alert
	for _, a := range firingAlerts {
		alerts = append(alerts, *a)
	}
	jsonOK(w, alerts)
}

func handleAlertAcknowledge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var req struct {
		AlertID string `json:"alert_id"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	firingAlertsMu.Lock()
	for key, alert := range firingAlerts {
		if alert.ID == req.AlertID {
			firingAlerts[key].Acknowledged = true
			firingAlerts[key].Status = "acknowledged"
			break
		}
	}
	firingAlertsMu.Unlock()

	jsonOK(w, map[string]string{"status": "acknowledged"})
}

func handleAlertsHistory(w http.ResponseWriter, r *http.Request) {
	minutes := qDefault(r, "minutes", "60")
	limit := qDefault(r, "limit", "100")

	rows, err := db.Query(context.Background(), fmt.Sprintf(`
		SELECT id, rule_id, rule_name, metric_name, host, value, threshold, condition, severity, status, fired_at, resolved_at
		FROM alert_history WHERE fired_at > NOW() - INTERVAL '%s minutes' ORDER BY fired_at DESC LIMIT %s
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
//  PLATFORM STATS
// ══════════════════════════════════════════════

func handlePlatformStats(w http.ResponseWriter, r *http.Request) {
	type Stats struct {
		TotalHosts     int     `json:"total_hosts"`
		TotalMetrics   int64   `json:"total_metrics_1h"`
		TotalLogs      int64   `json:"total_logs_1h"`
		TotalSpans     int64   `json:"total_spans_1h"`
		FiringAlerts   int     `json:"firing_alerts"`
		DataIngestRate float64 `json:"events_per_minute"`
	}

	var s Stats

	db.QueryRow(context.Background(), `SELECT COUNT(DISTINCT host) FROM metrics WHERE timestamp > NOW() - INTERVAL '1 hour'`).Scan(&s.TotalHosts)
	db.QueryRow(context.Background(), `SELECT COUNT(*) FROM metrics WHERE timestamp > NOW() - INTERVAL '1 hour'`).Scan(&s.TotalMetrics)
	db.QueryRow(context.Background(), `SELECT COUNT(*) FROM logs WHERE timestamp > NOW() - INTERVAL '1 hour'`).Scan(&s.TotalLogs)
	db.QueryRow(context.Background(), `SELECT COUNT(*) FROM spans WHERE start_time > NOW() - INTERVAL '1 hour'`).Scan(&s.TotalSpans)

	firingAlertsMu.RLock()
	s.FiringAlerts = len(firingAlerts)
	firingAlertsMu.RUnlock()

	totalEvents := s.TotalMetrics + s.TotalLogs + s.TotalSpans
	s.DataIngestRate = float64(totalEvents) / 60.0

	jsonOK(w, s)
}

// ══════════════════════════════════════════════
//  AGENT INSTALL SCRIPTS
// ══════════════════════════════════════════════

func handleInstallLinux(w http.ResponseWriter, r *http.Request) {
	apiKey := r.URL.Query().Get("api_key")
	serverAddr := "http://" + r.Host
	if r.Header.Get("X-Forwarded-Proto") == "https" {
		serverAddr = "https://" + r.Host
	}

	apiKeyLine := ""
	if apiKey != "" {
		apiKeyLine = fmt.Sprintf(`export OBSERVO_API_KEY="%s"`, apiKey)
	}

	script := fmt.Sprintf(`#!/bin/bash
# Observo Agent Installer — Linux/macOS
set -e

OBSERVO_SERVER_URL="%s"
%s

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  armv7l)  ARCH="arm"   ;;
esac

INSTALL_DIR="/usr/local/bin"
SERVICE_FILE="/etc/systemd/system/observo-agent.service"

echo "=== Observo Agent Installer ==="
echo "    Server: $OBSERVO_SERVER_URL"

sudo tee /etc/observo-agent.env > /dev/null <<EOF
OBSERVO_SERVER_URL=$OBSERVO_SERVER_URL
%sOBSERVO_TAGS=os=$OS,arch=$ARCH
EOF

if command -v systemctl &>/dev/null; then
  sudo tee $SERVICE_FILE > /dev/null <<'UNIT'
[Unit]
Description=Observo Monitoring Agent
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/observo-agent.env
ExecStart=/usr/local/bin/observo-agent
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now observo-agent
  echo "=== Done! Agent running as systemd service ==="
else
  nohup env $(cat /etc/observo-agent.env | xargs) observo-agent > /var/log/observo-agent.log 2>&1 &
  echo "    PID: $!"
fi
`,
		serverAddr, apiKeyLine,
		func() string {
			if apiKey != "" {
				return fmt.Sprintf("OBSERVO_API_KEY=%s\n", apiKey)
			}
			return ""
		}(),
	)

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprint(w, script)
}

func handleInstallWindows(w http.ResponseWriter, r *http.Request) {
	apiKey := r.URL.Query().Get("api_key")
	serverAddr := "http://" + r.Host
	if r.Header.Get("X-Forwarded-Proto") == "https" {
		serverAddr = "https://" + r.Host
	}

	script := fmt.Sprintf(`# Observo Agent Installer — Windows
$ErrorActionPreference = "Stop"
$ServerURL = "%s"
$APIKey    = "%s"
$InstallDir = "$env:ProgramFiles\Observo"
$BinaryPath = "$InstallDir\observo-agent.exe"
$ServiceName = "ObservoAgent"
$ConfigFile = "$InstallDir\agent.env"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
@"
OBSERVO_SERVER_URL=$ServerURL
OBSERVO_API_KEY=$APIKey
OBSERVO_TAGS=os=windows,arch=$env:PROCESSOR_ARCHITECTURE
"@ | Set-Content $ConfigFile

$envVars = Get-Content $ConfigFile | ForEach-Object { $k, $v = $_ -split '=', 2; [System.Environment]::SetEnvironmentVariable($k, $v, [System.EnvironmentVariableTarget]::Machine) }
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue; sc.exe delete $ServiceName | Out-Null }
New-Service -Name $ServiceName -BinaryPathName $BinaryPath -DisplayName "Observo Monitoring Agent" -StartupType Automatic | Out-Null
Start-Service -Name $ServiceName
Write-Host "=== Done! Agent running as Windows Service ===" -ForegroundColor Green
`, serverAddr, apiKey)

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprint(w, script)
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

func parseFloat(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscanf(s, "%f", &f)
	return f, err
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, PUT, PATCH")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
		if r.Method == "OPTIONS" {
			w.WriteHeader(200)
			return
		}
		next(w, r)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]interface{}{
		"status":  "ok",
		"version": "3.0",
		"time":    time.Now().Format(time.RFC3339),
	})
}

// ══════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════

func main() {
	var err error
	db, err = connectDB()
	if err != nil {
		log.Fatalf("PostgreSQL connection failed: %v", err)
	}
	fmt.Printf("Connected to PostgreSQL at %s:%s/%s ✓\n", pgHost, pgPort, pgDB)

	if err := initTables(); err != nil {
		log.Fatalf("Failed to init tables: %v", err)
	}
	fmt.Println("Tables initialized ✓")

	initAPIKeysTable()
	loadAPIKeys()
	initDataSourcesTable()
	loadDataSources()
	loadAlertRules()
	go startPollers()
	fmt.Println("Cloud pollers started ✓")

	go alertEngine()
	fmt.Println("Alert engine started ✓")

	// ── Metrics ──
	http.HandleFunc("/v1/metrics", corsMiddleware(handleMetrics))
	http.HandleFunc("/v1/query", corsMiddleware(handleQuery))
	http.HandleFunc("/v1/query/timeseries", corsMiddleware(handleTimeseries))
	http.HandleFunc("/v1/query/latest", corsMiddleware(handleLatest))
	http.HandleFunc("/v1/hosts", corsMiddleware(handleHosts))
	http.HandleFunc("/v1/metrics/names", corsMiddleware(handleMetricNames))

	// ── Logs ──
	http.HandleFunc("/v1/logs/stats", corsMiddleware(handleLogsStats))
	http.HandleFunc("/v1/logs/sources", corsMiddleware(handleLogSources))
	http.HandleFunc("/v1/logs/rate", corsMiddleware(handleLogsRate))
	http.HandleFunc("/v1/logs", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
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
	http.HandleFunc("/v1/traces/graph", corsMiddleware(handleServiceGraph))
	http.HandleFunc("/v1/traces/", corsMiddleware(handleTraceDetail))

	// ── APM ──
	http.HandleFunc("/v1/apm/services", corsMiddleware(handleAPMServices))
	http.HandleFunc("/v1/apm/services/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/timeseries") {
			handleAPMServiceTimeseries(w, r)
		} else {
			http.Error(w, "Not found", 404)
		}
	}))

	// ── Process & Network Metrics ──
	http.HandleFunc("/v1/processes", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			handleProcessIngest(w, r)
		case http.MethodGet:
			handleProcessQuery(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))
	http.HandleFunc("/v1/network", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			handleNetworkIngest(w, r)
		case http.MethodGet:
			handleNetworkQuery(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))
	http.HandleFunc("/v1/network/latest", corsMiddleware(handleNetworkLatest))

	// ── Agent Heartbeats ──
	http.HandleFunc("/v1/heartbeat", corsMiddleware(handleHeartbeat))
	http.HandleFunc("/v1/agents", corsMiddleware(handleAgents))

	// ── Anomaly Detection ──
	http.HandleFunc("/v1/anomalies", corsMiddleware(handleAnomalies))

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
	http.HandleFunc("/v1/alerts/acknowledge", corsMiddleware(handleAlertAcknowledge))

	// ── Notification Channels ──
	http.HandleFunc("/v1/notifications/channels", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleNotifChannelsList(w, r)
		case http.MethodPost:
			handleNotifChannelsCreate(w, r)
		case http.MethodDelete:
			handleNotifChannelsDelete(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))
	http.HandleFunc("/v1/notifications/test", corsMiddleware(handleNotifTest))

	// ── Platform Stats ──
	http.HandleFunc("/v1/stats", corsMiddleware(handlePlatformStats))

	// ── Data Sources ──
	http.HandleFunc("/v1/datasources/test", corsMiddleware(handleDSTest))
	http.HandleFunc("/v1/datasources", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleDSList(w, r)
		case http.MethodPost:
			handleDSCreate(w, r)
		case http.MethodDelete:
			handleDSDelete(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))

	// ── API Keys ──
	http.HandleFunc("/v1/apikeys", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleAPIKeyList(w, r)
		case http.MethodPost:
			handleAPIKeyCreate(w, r)
		case http.MethodDelete:
			handleAPIKeyDelete(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))

	// ── OTLP ──
	http.HandleFunc("/v1/otlp/v1/metrics", authMiddleware(handleOTLPMetrics))
	http.HandleFunc("/v1/otlp/v1/traces", authMiddleware(handleOTLPTraces))
	http.HandleFunc("/v1/otlp/v1/logs", authMiddleware(handleOTLPLogs))

	// ── Health & Installers ──
	http.HandleFunc("/health", handleHealth)
	http.HandleFunc("/install.sh", handleInstallLinux)
	http.HandleFunc("/install.ps1", handleInstallWindows)

	fmt.Printf("[%s] Observo server listening on :%s\n", time.Now().Format("15:04:05"), serverPort)
	log.Fatal(http.ListenAndServe(":"+serverPort, nil))
}
