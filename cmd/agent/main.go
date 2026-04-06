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
	gnet "github.com/shirou/gopsutil/v3/net"
	gproc "github.com/shirou/gopsutil/v3/process"
)

const (
	collectInterval   = 5 * time.Second
	heartbeatInterval = 30 * time.Second
	agentVersion      = "3.0.0"
)

// Config from environment — works for any deployment: on-prem, cloud, SaaS
func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	serverURL  = getEnv("OBSERVO_SERVER_URL", "http://localhost:8080")
	apiKey     = getEnv("OBSERVO_API_KEY", "")     // Bearer token for authenticated instances
	agentTags  = getEnv("OBSERVO_TAGS", "")        // comma-separated key=value tags e.g. env=prod,region=us-east-1
	agentLabel = getEnv("OBSERVO_AGENT_ID", "")    // override auto-generated agent ID
)

// ─── Metric Types ───

type Metric struct {
	Timestamp  time.Time         `json:"timestamp"`
	Host       string            `json:"host"`
	MetricName string            `json:"metric_name"`
	Value      float64           `json:"value"`
	Unit       string            `json:"unit"`
	Tags       map[string]string `json:"tags,omitempty"`
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

// ─── Process Types ───

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

// ─── Network Types ───

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

// ─── Heartbeat Type ───

type HeartbeatPayload struct {
	AgentID  string            `json:"agent_id"`
	Host     string            `json:"host"`
	Platform string            `json:"platform"`
	Version  string            `json:"version"`
	Tags     map[string]string `json:"tags,omitempty"`
}

// PowerShell JSON struct
type PSEventLog struct {
	TimeCreated      string `json:"TimeCreated"`
	ProviderName     string `json:"ProviderName"`
	LevelDisplayName string `json:"LevelDisplayName"`
	Message          string `json:"Message"`
	LogName          string `json:"LogName"`
}

// ─── System Metric Collection ───

func collectMetrics(hostname string) ([]Metric, error) {
	now := time.Now()
	var metrics []Metric

	// CPU
	cpuPercent, err := cpu.Percent(1*time.Second, false)
	if err != nil {
		return nil, fmt.Errorf("failed to read CPU: %w", err)
	}
	metrics = append(metrics, Metric{
		Timestamp: now, Host: hostname, MetricName: "cpu.usage_percent",
		Value: cpuPercent[0], Unit: "percent",
	})

	// Per-CPU cores
	perCPU, err := cpu.Percent(0, true)
	if err == nil {
		for i, pct := range perCPU {
			metrics = append(metrics, Metric{
				Timestamp: now, Host: hostname,
				MetricName: fmt.Sprintf("cpu.core%d_percent", i),
				Value: pct, Unit: "percent",
				Tags: map[string]string{"core": fmt.Sprintf("%d", i)},
			})
		}
	}

	// Memory
	memInfo, err := mem.VirtualMemory()
	if err != nil {
		return nil, fmt.Errorf("failed to read memory: %w", err)
	}
	metrics = append(metrics,
		Metric{Timestamp: now, Host: hostname, MetricName: "memory.usage_percent", Value: memInfo.UsedPercent, Unit: "percent"},
		Metric{Timestamp: now, Host: hostname, MetricName: "memory.used_bytes", Value: float64(memInfo.Used), Unit: "bytes"},
		Metric{Timestamp: now, Host: hostname, MetricName: "memory.total_bytes", Value: float64(memInfo.Total), Unit: "bytes"},
		Metric{Timestamp: now, Host: hostname, MetricName: "memory.available_bytes", Value: float64(memInfo.Available), Unit: "bytes"},
	)

	// Swap memory
	swapInfo, err := mem.SwapMemory()
	if err == nil && swapInfo.Total > 0 {
		metrics = append(metrics, Metric{
			Timestamp: now, Host: hostname, MetricName: "memory.swap_percent",
			Value: swapInfo.UsedPercent, Unit: "percent",
		})
	}

	// Disk usage (root)
	diskRoot := "/"
	if runtime.GOOS == "windows" {
		diskRoot = "C:"
	}
	diskInfo, err := disk.Usage(diskRoot)
	if err == nil {
		metrics = append(metrics,
			Metric{Timestamp: now, Host: hostname, MetricName: "disk.usage_percent", Value: diskInfo.UsedPercent, Unit: "percent"},
			Metric{Timestamp: now, Host: hostname, MetricName: "disk.used_bytes", Value: float64(diskInfo.Used), Unit: "bytes"},
			Metric{Timestamp: now, Host: hostname, MetricName: "disk.free_bytes", Value: float64(diskInfo.Free), Unit: "bytes"},
			Metric{Timestamp: now, Host: hostname, MetricName: "disk.total_bytes", Value: float64(diskInfo.Total), Unit: "bytes"},
		)
	}

	// Disk I/O
	diskIO, err := disk.IOCounters()
	if err == nil {
		var totalRead, totalWrite, totalReadOps, totalWriteOps uint64
		for _, d := range diskIO {
			totalRead += d.ReadBytes
			totalWrite += d.WriteBytes
			totalReadOps += d.ReadCount
			totalWriteOps += d.WriteCount
		}
		metrics = append(metrics,
			Metric{Timestamp: now, Host: hostname, MetricName: "disk.read_bytes_total", Value: float64(totalRead), Unit: "bytes"},
			Metric{Timestamp: now, Host: hostname, MetricName: "disk.write_bytes_total", Value: float64(totalWrite), Unit: "bytes"},
			Metric{Timestamp: now, Host: hostname, MetricName: "disk.read_ops_total", Value: float64(totalReadOps), Unit: "ops"},
			Metric{Timestamp: now, Host: hostname, MetricName: "disk.write_ops_total", Value: float64(totalWriteOps), Unit: "ops"},
		)
	}

	return metrics, nil
}

// ─── Process Metrics Collection ───

func collectProcessMetrics(hostname string) []ProcessMetric {
	procs, err := gproc.Processes()
	if err != nil {
		return nil
	}

	type ProcInfo struct {
		pid        uint32
		name       string
		cpuPercent float64
		memPercent float32
		memBytes   uint64
		status     string
	}

	var infos []ProcInfo
	for _, p := range procs {
		name, err := p.Name()
		if err != nil || name == "" {
			continue
		}
		cpuPct, err := p.CPUPercent()
		if err != nil {
			cpuPct = 0
		}
		memPct, err := p.MemoryPercent()
		if err != nil {
			memPct = 0
		}
		memInfo, err := p.MemoryInfo()
		memBytes := uint64(0)
		if err == nil && memInfo != nil {
			memBytes = memInfo.RSS
		}
		statuses, err := p.Status()
		status := "running"
		if err == nil && len(statuses) > 0 {
			status = statuses[0]
		}
		infos = append(infos, ProcInfo{
			pid: uint32(p.Pid), name: name,
			cpuPercent: cpuPct, memPercent: float32(memPct),
			memBytes: memBytes, status: status,
		})
	}

	// Sort by CPU desc and take top 20
	for i := 0; i < len(infos)-1; i++ {
		for j := i + 1; j < len(infos); j++ {
			if infos[j].cpuPercent > infos[i].cpuPercent {
				infos[i], infos[j] = infos[j], infos[i]
			}
		}
	}
	if len(infos) > 20 {
		infos = infos[:20]
	}

	now := time.Now()
	var results []ProcessMetric
	for _, info := range infos {
		results = append(results, ProcessMetric{
			Timestamp:  now,
			Host:       hostname,
			PID:        info.pid,
			Name:       info.name,
			CPUPercent: info.cpuPercent,
			MemPercent: float64(info.memPercent),
			MemBytes:   info.memBytes,
			Status:     info.status,
		})
	}
	return results
}

// ─── Network Metrics Collection ───

func collectNetworkMetrics(hostname string) []NetworkMetric {
	counters, err := gnet.IOCounters(true) // per interface
	if err != nil {
		return nil
	}

	now := time.Now()
	var results []NetworkMetric
	for _, c := range counters {
		// Skip loopback and zero-traffic interfaces
		if c.Name == "lo" || c.Name == "Loopback Pseudo-Interface 1" {
			continue
		}
		if c.BytesSent == 0 && c.BytesRecv == 0 {
			continue
		}
		results = append(results, NetworkMetric{
			Timestamp:   now,
			Host:        hostname,
			Interface:   c.Name,
			BytesSent:   c.BytesSent,
			BytesRecv:   c.BytesRecv,
			PacketsSent: c.PacketsSent,
			PacketsRecv: c.PacketsRecv,
			ErrIn:       c.Errin,
			ErrOut:      c.Errout,
		})
	}
	return results
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
		fmt.Printf("[%s] PowerShell failed: %v\n", time.Now().Format("15:04:05"), err)
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

func generateTraceData(hostname string) []Span {
	flows := []struct {
		name   string
		steps  []struct{ service, operation string }
		weight int
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
			weight: 30,
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
			weight: 20,
		},
		{
			name: "search",
			steps: []struct{ service, operation string }{
				{"api-gateway", "HTTP GET /api/search"},
				{"search-service", "FullTextSearch"},
				{"elasticsearch", "Query"},
				{"cache", "SET search:result"},
			},
			weight: 15,
		},
		{
			name: "health-check",
			steps: []struct{ service, operation string }{
				{"api-gateway", "HTTP GET /health"},
				{"user-service", "Ping"},
				{"order-service", "Ping"},
			},
			weight: 10,
		},
		{
			name: "payment-flow",
			steps: []struct{ service, operation string }{
				{"api-gateway", "HTTP POST /api/payments"},
				{"auth-service", "ValidateToken"},
				{"payment-service", "ProcessPayment"},
				{"fraud-detection", "CheckFraud"},
				{"postgres", "INSERT payments"},
				{"notification-service", "SendReceipt"},
				{"analytics-service", "TrackEvent"},
			},
			weight: 15,
		},
		{
			name: "user-registration",
			steps: []struct{ service, operation string }{
				{"api-gateway", "HTTP POST /api/register"},
				{"user-service", "CreateUser"},
				{"postgres", "INSERT users"},
				{"email-service", "SendWelcome"},
				{"analytics-service", "TrackSignup"},
			},
			weight: 10,
		},
	}

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
		duration := 5 + rand.Float64()*100

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
				"flow":    flow.name,
				"version": agentVersion,
			},
		})

		parentID = spanID
		elapsed += duration * 0.8
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

func sendJSON(path string, payload interface{}) error {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", serverURL+path, bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// parseTags parses "env=prod,region=us-east-1" into a map
func parseTags(raw string) map[string]string {
	m := map[string]string{}
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		parts := strings.SplitN(pair, "=", 2)
		if len(parts) == 2 {
			m[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}
	return m
}

func sendMetrics(metrics []Metric) {
	if err := sendJSON("/v1/metrics", metrics); err != nil {
		log.Printf("Failed to send metrics: %v", err)
		return
	}
	fmt.Printf("[%s] Sent %d metrics\n", time.Now().Format("15:04:05"), len(metrics))
}

func sendLogs(agentID string, logs []LogEntry) {
	if len(logs) == 0 {
		return
	}
	batch := LogBatch{AgentID: agentID, Logs: logs}
	if err := sendJSON("/v1/logs", batch); err != nil {
		log.Printf("Failed to send logs: %v", err)
		return
	}
	fmt.Printf("[%s] Sent %d logs\n", time.Now().Format("15:04:05"), len(logs))
}

func sendTraces(agentID string, spans []Span) {
	if len(spans) == 0 {
		return
	}
	batch := TraceBatch{AgentID: agentID, Spans: spans}
	if err := sendJSON("/v1/traces", batch); err != nil {
		log.Printf("Failed to send traces: %v", err)
		return
	}
	fmt.Printf("[%s] Sent %d spans\n", time.Now().Format("15:04:05"), len(spans))
}

func sendProcessMetrics(agentID string, procs []ProcessMetric) {
	if len(procs) == 0 {
		return
	}
	batch := ProcessBatch{AgentID: agentID, Processes: procs}
	if err := sendJSON("/v1/processes", batch); err != nil {
		log.Printf("Failed to send process metrics: %v", err)
		return
	}
	fmt.Printf("[%s] Sent %d process metrics\n", time.Now().Format("15:04:05"), len(procs))
}

func sendNetworkMetrics(agentID string, nets []NetworkMetric) {
	if len(nets) == 0 {
		return
	}
	batch := NetworkBatch{AgentID: agentID, Network: nets}
	if err := sendJSON("/v1/network", batch); err != nil {
		log.Printf("Failed to send network metrics: %v", err)
		return
	}
	fmt.Printf("[%s] Sent %d network stats\n", time.Now().Format("15:04:05"), len(nets))
}

func sendHeartbeat(agentID, hostname, platform string) {
	tags := map[string]string{
		"os":   runtime.GOOS,
		"arch": runtime.GOARCH,
	}
	// Merge user-defined tags from OBSERVO_TAGS env var
	for k, v := range parseTags(agentTags) {
		tags[k] = v
	}
	hb := HeartbeatPayload{
		AgentID:  agentID,
		Host:     hostname,
		Platform: platform,
		Version:  agentVersion,
		Tags:     tags,
	}
	if err := sendJSON("/v1/heartbeat", hb); err != nil {
		log.Printf("Failed to send heartbeat: %v", err)
		return
	}
	fmt.Printf("[%s] Heartbeat sent\n", time.Now().Format("15:04:05"))
}

// ─── Main ───

func main() {
	rand.Seed(time.Now().UnixNano())

	hostInfo, err := host.Info()
	if err != nil {
		log.Fatalf("Failed to get host info: %v", err)
	}
	hostname := hostInfo.Hostname
	platform := hostInfo.Platform + " " + hostInfo.PlatformVersion
	agentID := fmt.Sprintf("agent-%s", hostname)
	if agentLabel != "" {
		agentID = agentLabel
	}

	fmt.Println("═══════════════════════════════════════")
	fmt.Println("  Observo Agent v3.0")
	fmt.Printf("  Host:     %s\n", hostname)
	fmt.Printf("  Agent ID: %s\n", agentID)
	fmt.Printf("  OS:       %s/%s\n", runtime.GOOS, runtime.GOARCH)
	fmt.Printf("  Platform: %s\n", platform)
	fmt.Printf("  Server:   %s\n", serverURL)
	if apiKey != "" {
		fmt.Println("  Auth:     API key configured ✓")
	} else {
		fmt.Println("  Auth:     none (set OBSERVO_API_KEY to enable)")
	}
	if agentTags != "" {
		fmt.Printf("  Tags:     %s\n", agentTags)
	}
	fmt.Println("  Collecting: metrics · logs · traces")
	fmt.Println("              processes · network · I/O")
	fmt.Println("═══════════════════════════════════════")
	fmt.Println()

	// Initial heartbeat
	sendHeartbeat(agentID, hostname, platform)

	// First collection
	if metrics, err := collectMetrics(hostname); err == nil {
		sendMetrics(metrics)
	}
	sendLogs(agentID, collectPlatformLogs(hostname))
	sendTraces(agentID, generateTraceData(hostname))
	sendProcessMetrics(agentID, collectProcessMetrics(hostname))
	sendNetworkMetrics(agentID, collectNetworkMetrics(hostname))

	metricTicker := time.NewTicker(collectInterval)
	heartbeatTicker := time.NewTicker(heartbeatInterval)
	defer metricTicker.Stop()
	defer heartbeatTicker.Stop()

	traceCounter := 0
	for {
		select {
		case <-metricTicker.C:
			// System metrics
			if metrics, err := collectMetrics(hostname); err == nil {
				sendMetrics(metrics)
			}

			// Logs (every cycle)
			sendLogs(agentID, collectPlatformLogs(hostname))

			// Traces: 1-3 per cycle
			traceCounter++
			traceCount := 1 + rand.Intn(3)
			for i := 0; i < traceCount; i++ {
				sendTraces(agentID, generateTraceData(hostname))
			}

			// Process and network metrics (every 3 cycles = ~15s)
			if traceCounter%3 == 0 {
				sendProcessMetrics(agentID, collectProcessMetrics(hostname))
				sendNetworkMetrics(agentID, collectNetworkMetrics(hostname))
			}

		case <-heartbeatTicker.C:
			sendHeartbeat(agentID, hostname, platform)
		}
	}
}
