package main

// OpenTelemetry Protocol (OTLP) HTTP/JSON receiver
// Compatible with any OTEL SDK, OTEL Collector, and cloud-native apps.
//
// Endpoints:
//   POST /v1/otlp/v1/traces  — OTLP traces (JSON)
//   POST /v1/otlp/v1/metrics — OTLP metrics (JSON)
//   POST /v1/otlp/v1/logs    — OTLP logs (JSON)

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ── OTLP JSON structures (simplified subset) ──────────────────────────────────

type OTLPAnyValue struct {
	StringValue *string  `json:"stringValue,omitempty"`
	IntValue    *string  `json:"intValue,omitempty"` // OTLP sends int64 as string
	DoubleValue *float64 `json:"doubleValue,omitempty"`
	BoolValue   *bool    `json:"boolValue,omitempty"`
}

func (v OTLPAnyValue) String() string {
	if v.StringValue != nil {
		return *v.StringValue
	}
	if v.IntValue != nil {
		return *v.IntValue
	}
	if v.DoubleValue != nil {
		return fmt.Sprintf("%g", *v.DoubleValue)
	}
	if v.BoolValue != nil {
		if *v.BoolValue {
			return "true"
		}
		return "false"
	}
	return ""
}

type OTLPAttribute struct {
	Key   string       `json:"key"`
	Value OTLPAnyValue `json:"value"`
}

type OTLPResource struct {
	Attributes []OTLPAttribute `json:"attributes"`
}

func otlpAttrs(attrs []OTLPAttribute) map[string]string {
	m := make(map[string]string)
	for _, a := range attrs {
		m[a.Key] = a.Value.String()
	}
	return m
}

func attrGet(attrs []OTLPAttribute, key string) string {
	for _, a := range attrs {
		if a.Key == key {
			return a.Value.String()
		}
	}
	return ""
}

// unixNanoToTime converts OTLP nanosecond timestamp (string or number) to time.Time
func unixNanoToTime(ns string) time.Time {
	if ns == "" {
		return time.Now()
	}
	n, err := strconv.ParseInt(ns, 10, 64)
	if err != nil {
		return time.Now()
	}
	return time.Unix(0, n)
}

// hexToShort trims a hex trace/span ID to 16 chars for storage
func hexToShort(h string) string {
	h = strings.ReplaceAll(h, "-", "")
	if len(h) > 32 {
		return h[:32]
	}
	return h
}

// ── OTLP Traces ──────────────────────────────────────────────────────────────

type OTLPSpan struct {
	TraceID           string          `json:"traceId"`
	SpanID            string          `json:"spanId"`
	ParentSpanID      string          `json:"parentSpanId"`
	Name              string          `json:"name"`
	StartTimeUnixNano string          `json:"startTimeUnixNano"`
	EndTimeUnixNano   string          `json:"endTimeUnixNano"`
	Attributes        []OTLPAttribute `json:"attributes"`
	Status            struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"status"`
	Kind int `json:"kind"`
}

type OTLPScopeSpans struct {
	Spans []OTLPSpan `json:"spans"`
}

type OTLPResourceSpans struct {
	Resource   OTLPResource     `json:"resource"`
	ScopeSpans []OTLPScopeSpans `json:"scopeSpans"`
}

type OTLPTracesPayload struct {
	ResourceSpans []OTLPResourceSpans `json:"resourceSpans"`
}

func handleOTLPTraces(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var payload OTLPTracesPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Invalid OTLP JSON", 400)
		return
	}

	var spans []Span
	for _, rs := range payload.ResourceSpans {
		resAttrs := otlpAttrs(rs.Resource.Attributes)
		service := resAttrs["service.name"]
		if service == "" {
			service = resAttrs["host.name"]
		}
		if service == "" {
			service = "unknown"
		}
		host := resAttrs["host.name"]
		if host == "" {
			host = resAttrs["k8s.node.name"]
		}
		if host == "" {
			host = service
		}

		for _, ss := range rs.ScopeSpans {
			for _, s := range ss.Spans {
				start := unixNanoToTime(s.StartTimeUnixNano)
				end := unixNanoToTime(s.EndTimeUnixNano)
				durationMs := float64(end.Sub(start).Nanoseconds()) / 1e6

				status := "ok"
				// OTLP status codes: 0=UNSET, 1=OK, 2=ERROR
				if s.Status.Code == 2 {
					status = "error"
				}

				tags := otlpAttrs(s.Attributes)
				for k, v := range resAttrs {
					tags["resource."+k] = v
				}

				spans = append(spans, Span{
					TraceID:   hexToShort(s.TraceID),
					SpanID:    hexToShort(s.SpanID),
					ParentID:  hexToShort(s.ParentSpanID),
					Service:   service,
					Operation: s.Name,
					Host:      host,
					StartTime: start,
					Duration:  durationMs,
					Status:    status,
					Tags:      tags,
				})
			}
		}
	}

	if len(spans) > 0 {
		if err := insertSpans(spans); err != nil {
			log.Printf("OTLP traces insert error: %v", err)
		}
	}

	// OTLP expects an empty JSON object response
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{}"))
	fmt.Printf("[%s] OTLP: received %d spans\n", time.Now().Format("15:04:05"), len(spans))
}

// ── OTLP Metrics ─────────────────────────────────────────────────────────────

type OTLPNumberDataPoint struct {
	TimeUnixNano string          `json:"timeUnixNano"`
	AsDouble     *float64        `json:"asDouble,omitempty"`
	AsInt        *string         `json:"asInt,omitempty"` // int64 as string
	Attributes   []OTLPAttribute `json:"attributes"`
}

func (p OTLPNumberDataPoint) Value() float64 {
	if p.AsDouble != nil {
		return *p.AsDouble
	}
	if p.AsInt != nil {
		v, _ := strconv.ParseFloat(*p.AsInt, 64)
		return v
	}
	return 0
}

type OTLPGauge struct {
	DataPoints []OTLPNumberDataPoint `json:"dataPoints"`
}
type OTLPSum struct {
	DataPoints []OTLPNumberDataPoint `json:"dataPoints"`
}

type OTLPMetric struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Unit        string      `json:"unit"`
	Gauge       *OTLPGauge  `json:"gauge,omitempty"`
	Sum         *OTLPSum    `json:"sum,omitempty"`
}

type OTLPScopeMetrics struct {
	Metrics []OTLPMetric `json:"metrics"`
}

type OTLPResourceMetrics struct {
	Resource     OTLPResource       `json:"resource"`
	ScopeMetrics []OTLPScopeMetrics `json:"scopeMetrics"`
}

type OTLPMetricsPayload struct {
	ResourceMetrics []OTLPResourceMetrics `json:"resourceMetrics"`
}

func handleOTLPMetrics(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var payload OTLPMetricsPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Invalid OTLP JSON", 400)
		return
	}

	var metrics []Metric
	for _, rm := range payload.ResourceMetrics {
		resAttrs := otlpAttrs(rm.Resource.Attributes)
		host := resAttrs["host.name"]
		if host == "" {
			host = resAttrs["k8s.node.name"]
		}
		if host == "" {
			host = resAttrs["service.name"]
		}
		if host == "" {
			host = "otel"
		}

		for _, sm := range rm.ScopeMetrics {
			for _, m := range sm.Metrics {
				unit := m.Unit
				if unit == "" {
					unit = "unit"
				}

				var dataPoints []OTLPNumberDataPoint
				if m.Gauge != nil {
					dataPoints = m.Gauge.DataPoints
				} else if m.Sum != nil {
					dataPoints = m.Sum.DataPoints
				}

				for _, dp := range dataPoints {
					ts := unixNanoToTime(dp.TimeUnixNano)
					tags := otlpAttrs(dp.Attributes)
					for k, v := range resAttrs {
						tags[k] = v
					}
					metrics = append(metrics, Metric{
						Timestamp:  ts,
						Host:       host,
						MetricName: m.Name,
						Value:      dp.Value(),
						Unit:       unit,
						Tags:       tags,
					})
				}
			}
		}
	}

	if len(metrics) > 0 {
		if err := insertMetrics(metrics); err != nil {
			log.Printf("OTLP metrics insert error: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{}"))
	fmt.Printf("[%s] OTLP: received %d metric points\n", time.Now().Format("15:04:05"), len(metrics))
}

// ── OTLP Logs ────────────────────────────────────────────────────────────────

type OTLPLogRecord struct {
	TimeUnixNano   string          `json:"timeUnixNano"`
	SeverityText   string          `json:"severityText"`
	SeverityNumber int             `json:"severityNumber"`
	Body           OTLPAnyValue    `json:"body"`
	Attributes     []OTLPAttribute `json:"attributes"`
	TraceID        string          `json:"traceId,omitempty"`
	SpanID         string          `json:"spanId,omitempty"`
}

type OTLPScopeLogs struct {
	LogRecords []OTLPLogRecord `json:"logRecords"`
}

type OTLPResourceLogs struct {
	Resource  OTLPResource    `json:"resource"`
	ScopeLogs []OTLPScopeLogs `json:"scopeLogs"`
}

type OTLPLogsPayload struct {
	ResourceLogs []OTLPResourceLogs `json:"resourceLogs"`
}

func otlpSeverityToLevel(num int, text string) string {
	// Map OTLP severity numbers to our levels
	// TRACE=1-4, DEBUG=5-8, INFO=9-12, WARN=13-16, ERROR=17-20, FATAL=21-24
	if text != "" {
		lower := strings.ToLower(text)
		switch {
		case strings.Contains(lower, "fatal"), strings.Contains(lower, "panic"):
			return "fatal"
		case strings.Contains(lower, "error"):
			return "error"
		case strings.Contains(lower, "warn"):
			return "warn"
		case strings.Contains(lower, "debug"), strings.Contains(lower, "trace"):
			return "debug"
		default:
			return "info"
		}
	}
	switch {
	case num >= 21:
		return "fatal"
	case num >= 17:
		return "error"
	case num >= 13:
		return "warn"
	case num >= 5:
		return "debug"
	default:
		return "info"
	}
}

func handleOTLPLogs(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var payload OTLPLogsPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Invalid OTLP JSON", 400)
		return
	}

	var logs []LogEntry
	for _, rl := range payload.ResourceLogs {
		resAttrs := otlpAttrs(rl.Resource.Attributes)
		host := resAttrs["host.name"]
		if host == "" {
			host = resAttrs["service.name"]
		}
		if host == "" {
			host = "otel"
		}
		source := resAttrs["service.name"]
		if source == "" {
			source = "otel"
		}

		for _, sl := range rl.ScopeLogs {
			for _, rec := range sl.LogRecords {
				ts := unixNanoToTime(rec.TimeUnixNano)
				severity := otlpSeverityToLevel(rec.SeverityNumber, rec.SeverityText)
				message := rec.Body.String()

				tags := otlpAttrs(rec.Attributes)
				for k, v := range resAttrs {
					tags[k] = v
				}
				if rec.TraceID != "" {
					tags["trace_id"] = hexToShort(rec.TraceID)
				}
				if rec.SpanID != "" {
					tags["span_id"] = hexToShort(rec.SpanID)
				}

				logs = append(logs, LogEntry{
					Timestamp: ts,
					Host:      host,
					Source:    source,
					Severity:  severity,
					Message:   message,
					Tags:      tags,
				})
			}
		}
	}

	if len(logs) > 0 {
		if err := insertLogs(logs); err != nil {
			log.Printf("OTLP logs insert error: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{}"))
	fmt.Printf("[%s] OTLP: received %d log records\n", time.Now().Format("15:04:05"), len(logs))
}
