package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

const (
	serverURL       = "http://localhost:8080"
	collectInterval = 5 * time.Second
)

// ─── Metric Types ───

type Metric struct {
	Timestamp  time.Time `json:"timestamp"`
	Host       string    `json:"host"`
	MetricName string    `json:"metric_name"`
	Value      float64   `json:"value"`
	Unit       string    `json:"unit"`
}

// ─── Log Types ───

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

// ─── Trace Types ───

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

// PowerShell JSON struct
type PSEventLog struct {
	TimeCreated      string `json:"TimeCreated"`
	ProviderName     string `json:"ProviderName"`
	LevelDisplayName string `json:"LevelDisplayName"`
	Message          string `json:"Message"`
	LogName          string `json:"LogName"`
}

// ─── Metric Collection ───

func collectMetrics(hostname string) ([]Metric, error) {
	now := time.Now()
	var metrics []Metric

	cpuPercent, err := cpu.Percent(1*time.Second, false)
	if err != nil {
		return nil, fmt.Errorf("failed to read CPU: %w", err)
	}
	metrics = append(metrics, Metric{
		Timestamp: now, Host: hostname, MetricName: "cpu.usage_percent",
		Value: cpuPercent[0], Unit: "percent",
	})

	memInfo, err := mem.VirtualMemory()
	if err != nil {
		return nil, fmt.Errorf("failed to read memory: %w", err)
	}
	metrics = append(metrics, Metric{Timestamp: now, Host: hostname, MetricName: "memory.usage_percent", Value: memInfo.UsedPercent, Unit: "percent"})
	metrics = append(metrics, Metric{Timestamp: now, Host: hostname, MetricName: "memory.used_bytes", Value: float64(memInfo.Used), Unit: "bytes"})
	metrics = append(metrics, Metric{Timestamp: now, Host: hostname, MetricName: "memory.total_bytes", Value: float64(memInfo.Total), Unit: "bytes"})

	diskInfo, err := disk.Usage("C:")
	if err != nil {
		diskInfo, err = disk.Usage("/")
		if err != nil {
			return nil, fmt.Errorf("failed to read disk: %w", err)
		}
	}
	metrics = append(metrics, Metric{Timestamp: now, Host: hostname, MetricName: "disk.usage_percent", Value: diskInfo.UsedPercent, Unit: "percent"})

	return metrics, nil
}

// ─── Windows Log Collection ───

func collectWindowsLogs(hostname string) []LogEntry {
	psScript := `
$events = @()
foreach ($logName in @('System', 'Application')) {
    try {
        $evts = Get-WinEvent -LogName $logName -MaxEvents 15 -ErrorAction Stop
        foreach ($e in $evts) {
            $events += @{
                TimeCreated = $e.TimeCreated.ToString('o')
                ProviderName = $e.ProviderName
                LevelDisplayName = if ($e.LevelDisplayName) { $e.LevelDisplayName } else { 'Information' }
                Message = if ($e.Message.Length -gt 500) { $e.Message.Substring(0, 500) } else { $e.Message }
                LogName = $logName
            }
        }
    } catch {}
}
$events | ConvertTo-Json -Compress
`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psScript)
	cmd.Env = append(os.Environ(), "POWERSHELL_TELEMETRY_OPTOUT=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("[%s] ⚠️  PowerShell failed: %v\n", time.Now().Format("15:04:05"), err)
		return nil
	}

	outStr := strings.TrimSpace(string(output))
	if outStr == "" || outStr == "null" {
		return nil
	}

	var events []PSEventLog
	if err := json.Unmarshal([]byte(outStr), &events); err != nil {
		var single PSEventLog
		if err2 := json.Unmarshal([]byte(outStr), &single); err2 != nil {
			return nil
		}
		events = []PSEventLog{single}
	}

	var logs []LogEntry
	for _, e := range events {
		ts, err := time.Parse(time.RFC3339Nano, e.TimeCreated)
		if err != nil {
			ts = time.Now()
		}
		severity := mapWindowsSeverity(e.LevelDisplayName)
		message := strings.ReplaceAll(e.Message, "\r\n", " ")
		message = strings.ReplaceAll(message, "\n", " ")
		message = strings.TrimSpace(message)
		if message == "" {
			continue
		}

		logs = append(logs, LogEntry{
			Timestamp: ts, Host: hostname, Source: "eventlog:" + e.LogName,
			Severity: severity, Message: message,
			Tags: map[string]string{"provider": e.ProviderName, "platform": "windows", "log": e.LogName},
		})
	}
	return logs
}

func mapWindowsSeverity(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "critical":
		return "fatal"
	case "error":
		return "error"
	case "warning":
		return "warn"
	default:
		return "info"
	}
}

func collectLinuxLogs(hostname string) []LogEntry {
	cmd := exec.Command("journalctl", "--no-pager", "-o", "short-iso", "-n", "30", "--since", "30s ago")
	output, err := cmd.Output()
	if err != nil {
		return nil
	}
	var logs []LogEntry
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		logs = append(logs, classifyLogLine(hostname, "journald", line))
	}
	return logs
}

func classifyLogLine(hostname, source, line string) LogEntry {
	severity := "info"
	lower := strings.ToLower(line)
	if strings.Contains(lower, "error") || strings.Contains(lower, "failed") {
		severity = "error"
	} else if strings.Contains(lower, "warn") {
		severity = "warn"
	} else if strings.Contains(lower, "critical") || strings.Contains(lower, "fatal") {
		severity = "fatal"
	} else if strings.Contains(lower, "debug") {
		severity = "debug"
	}
	if len(line) > 2000 {
		line = line[:2000]
	}
	return LogEntry{
		Timestamp: time.Now(), Host: hostname, Source: source,
		Severity: severity, Message: line,
		Tags: map[string]string{"platform": runtime.GOOS},
	}
}

func collectPlatformLogs(hostname string) []LogEntry {
	switch runtime.GOOS {
	case "windows":
		return collectWindowsLogs(hostname)
	case "linux":
		return collectLinuxLogs(hostname)
	default:
		return nil
	}
}

// ─── Distributed Trace Simulation ───
// Generates realistic trace data simulating a microservices environment

func generateTraceData(hostname string) []Span {
	// Simulate different request flows through microservices
	flows := []struct {
		name    string
		steps   []struct{ service, operation string }
		weight  int
	}{
		{
			name: "api-request",
			steps: []struct{ service, operation string }{
				{"api-gateway", "HTTP GET /api/users"},
				{"auth-service", "ValidateToken"},
				{"user-service", "GetUserByID"},
				{"postgres", "SELECT users"},
				{"cache", "GET user:cache"},
			},
			weight: 40,
		},
		{
			name: "order-flow",
			steps: []struct{ service, operation string }{
				{"api-gateway", "HTTP POST /api/orders"},
				{"auth-service", "ValidateToken"},
				{"order-service", "CreateOrder"},
				{"inventory-service", "CheckStock"},
				{"postgres", "INSERT orders"},
				{"notification-service", "SendEmail"},
			},
			weight: 25,
		},
		{
			name: "search",
			steps: []struct{ service, operation string }{
				{"api-gateway", "HTTP GET /api/search"},
				{"search-service", "FullTextSearch"},
				{"elasticsearch", "Query"},
				{"cache", "SET search:result"},
			},
			weight: 20,
		},
		{
			name: "health-check",
			steps: []struct{ service, operation string }{
				{"api-gateway", "HTTP GET /health"},
				{"user-service", "Ping"},
				{"order-service", "Ping"},
			},
			weight: 15,
		},
	}

	// Pick a random flow based on weight
	totalWeight := 0
	for _, f := range flows {
		totalWeight += f.weight
	}
	pick := rand.Intn(totalWeight)
	var selectedFlow int
	cum := 0
	for i, f := range flows {
		cum += f.weight
		if pick < cum {
			selectedFlow = i
			break
		}
	}

	flow := flows[selectedFlow]
	traceID := generateID()
	now := time.Now()

	var spans []Span
	parentID := ""
	elapsed := 0.0

	for _, step := range flow.steps {
		spanID := generateID()
		duration := 5 + rand.Float64()*100 // 5-105ms

		// Occasional errors (5% chance)
		status := "ok"
		if rand.Intn(20) == 0 {
			status = "error"
		}

		spans = append(spans, Span{
			TraceID:   traceID,
			SpanID:    spanID,
			ParentID:  parentID,
			Service:   step.service,
			Operation: step.operation,
			Host:      hostname,
			StartTime: now.Add(time.Duration(elapsed) * time.Millisecond),
			Duration:  duration,
			Status:    status,
			Tags: map[string]string{
				"flow": flow.name,
			},
		})

		parentID = spanID
		elapsed += duration * 0.8 // Overlapping spans
	}

	return spans
}

func generateID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 16)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// ─── Sending ───

func sendMetrics(metrics []Metric) {
	jsonData, _ := json.Marshal(metrics)
	resp, err := http.Post(serverURL+"/v1/metrics", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("❌ Failed to send metrics: %v", err)
		return
	}
	defer resp.Body.Close()
	fmt.Printf("[%s] ✅ Sent %d metrics\n", time.Now().Format("15:04:05"), len(metrics))
}

func sendLogs(agentID string, logs []LogEntry) {
	if len(logs) == 0 {
		fmt.Printf("[%s] 📝 No logs this cycle\n", time.Now().Format("15:04:05"))
		return
	}
	batch := LogBatch{AgentID: agentID, Logs: logs}
	jsonData, _ := json.Marshal(batch)
	resp, err := http.Post(serverURL+"/v1/logs", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("❌ Failed to send logs: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		fmt.Printf("[%s] 📝 Sent %d logs\n", time.Now().Format("15:04:05"), len(logs))
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("[%s] ⚠️  Logs: %d: %s\n", time.Now().Format("15:04:05"), resp.StatusCode, string(body))
	}
}

func sendTraces(agentID string, spans []Span) {
	if len(spans) == 0 {
		return
	}
	batch := TraceBatch{AgentID: agentID, Spans: spans}
	jsonData, _ := json.Marshal(batch)
	resp, err := http.Post(serverURL+"/v1/traces", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("❌ Failed to send traces: %v", err)
		return
	}
	defer resp.Body.Close()
	fmt.Printf("[%s] 🔗 Sent %d spans\n", time.Now().Format("15:04:05"), len(spans))
}

// ─── Main ───

func main() {
	rand.Seed(time.Now().UnixNano())

	hostInfo, err := host.Info()
	if err != nil {
		log.Fatalf("Failed to get host info: %v", err)
	}
	hostname := hostInfo.Hostname
	agentID := fmt.Sprintf("agent-%s", hostname)

	fmt.Println("=================================")
	fmt.Println("  Observo Agent v2.0")
	fmt.Printf("  Host: %s\n", hostname)
	fmt.Printf("  OS:   %s/%s\n", runtime.GOOS, runtime.GOARCH)
	fmt.Printf("  Sending to %s\n", serverURL)
	fmt.Println("  Collecting: metrics + logs + traces")
	fmt.Println("=================================")
	fmt.Println()

	// First collection
	if metrics, err := collectMetrics(hostname); err == nil {
		sendMetrics(metrics)
	}
	sendLogs(agentID, collectPlatformLogs(hostname))
	sendTraces(agentID, generateTraceData(hostname))

	ticker := time.NewTicker(collectInterval)
	defer ticker.Stop()

	traceCounter := 0
	for range ticker.C {
		if metrics, err := collectMetrics(hostname); err == nil {
			sendMetrics(metrics)
		}
		sendLogs(agentID, collectPlatformLogs(hostname))

		// Generate 1-3 traces per cycle
		traceCounter++
		traceCount := 1 + rand.Intn(3)
		for i := 0; i < traceCount; i++ {
			sendTraces(agentID, generateTraceData(hostname))
		}
	}
}
