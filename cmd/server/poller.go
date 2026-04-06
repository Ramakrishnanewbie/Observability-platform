package main

// Cloud + external data source poller
// Runs a background goroutine per enabled datasource.
// Supported types:
//   aws        — CloudWatch metrics via aws-sdk-go-v2
//   prometheus — Prometheus HTTP API scrape
//   gcp        — GCP Cloud Monitoring (token-based HTTP)
//   azure      — Azure Monitor (client_credentials HTTP)
//   kubernetes — Kubernetes metrics-server API

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
)

const pollInterval = 60 * time.Second

// ── Poller registry ──────────────────────────────────────────────────────────

var (
	pollerCancels   = map[string]context.CancelFunc{}
	pollerCancelsMu sync.Mutex
)

// startPollers launches background pollers for all enabled datasources.
// Called once at startup; also call after a datasource is added/enabled.
func startPollers() {
	dataSourcesMu.RLock()
	snapshot := make([]*DataSource, len(dataSources))
	copy(snapshot, dataSources)
	dataSourcesMu.RUnlock()

	for _, ds := range snapshot {
		if ds.Enabled {
			startPoller(ds)
		}
	}
}

// startPoller launches (or replaces) the background goroutine for one datasource.
func startPoller(ds *DataSource) {
	pollerCancelsMu.Lock()
	if cancel, ok := pollerCancels[ds.ID]; ok {
		cancel() // stop existing
	}
	ctx, cancel := context.WithCancel(context.Background())
	pollerCancels[ds.ID] = cancel
	pollerCancelsMu.Unlock()

	go runPoller(ctx, ds.ID)
}

// stopPoller cancels the background goroutine for one datasource.
func stopPoller(id string) {
	pollerCancelsMu.Lock()
	if cancel, ok := pollerCancels[id]; ok {
		cancel()
		delete(pollerCancels, id)
	}
	pollerCancelsMu.Unlock()
}

// runPoller is the long-running goroutine for a single datasource.
func runPoller(ctx context.Context, dsID string) {
	// Initial poll immediately, then every pollInterval
	poll(ctx, dsID)
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			poll(ctx, dsID)
		}
	}
}

func poll(ctx context.Context, dsID string) {
	// Re-read datasource config each poll (may have changed)
	dataSourcesMu.RLock()
	var ds *DataSource
	for _, d := range dataSources {
		if d.ID == dsID {
			ds = d
			break
		}
	}
	dataSourcesMu.RUnlock()

	if ds == nil || !ds.Enabled {
		return
	}

	var metrics []Metric
	var pollErr error

	switch ds.Type {
	case "aws":
		metrics, pollErr = pollAWS(ctx, ds)
	case "prometheus":
		metrics, pollErr = pollPrometheus(ctx, ds)
	case "gcp":
		metrics, pollErr = pollGCP(ctx, ds)
	case "azure":
		metrics, pollErr = pollAzure(ctx, ds)
	case "kubernetes":
		metrics, pollErr = pollKubernetes(ctx, ds)
	default:
		return
	}

	// Update datasource status
	dataSourcesMu.Lock()
	for _, d := range dataSources {
		if d.ID == dsID {
			now := time.Now()
			d.LastSync = &now
			if pollErr != nil {
				d.Status = "error"
				d.Error = pollErr.Error()
			} else {
				d.Status = "connected"
				d.Error = ""
			}
			saveDataSource(d)
			break
		}
	}
	dataSourcesMu.Unlock()

	if pollErr != nil {
		fmt.Printf("[poller] %s (%s) error: %v\n", ds.Name, ds.Type, pollErr)
		return
	}

	if len(metrics) > 0 {
		if err := insertMetrics(metrics); err != nil {
			fmt.Printf("[poller] %s insert error: %v\n", ds.Name, err)
		} else {
			fmt.Printf("[poller] %s: ingested %d metrics\n", ds.Name, len(metrics))
		}
	}
}

// ── AWS CloudWatch ────────────────────────────────────────────────────────────

// Metrics to pull from CloudWatch with their namespace and dimension
var cloudwatchMetrics = []struct {
	Namespace  string
	MetricName string
	Stat       string
	Unit       string
	Dimension  string // dimension name to use as "host"
}{
	{"AWS/EC2", "CPUUtilization", "Average", "percent", "InstanceId"},
	{"AWS/EC2", "NetworkIn", "Sum", "bytes", "InstanceId"},
	{"AWS/EC2", "NetworkOut", "Sum", "bytes", "InstanceId"},
	{"AWS/EC2", "DiskReadBytes", "Sum", "bytes", "InstanceId"},
	{"AWS/EC2", "DiskWriteBytes", "Sum", "bytes", "InstanceId"},
	{"AWS/RDS", "CPUUtilization", "Average", "percent", "DBInstanceIdentifier"},
	{"AWS/RDS", "DatabaseConnections", "Average", "count", "DBInstanceIdentifier"},
	{"AWS/RDS", "FreeStorageSpace", "Average", "bytes", "DBInstanceIdentifier"},
	{"AWS/Lambda", "Invocations", "Sum", "count", "FunctionName"},
	{"AWS/Lambda", "Errors", "Sum", "count", "FunctionName"},
	{"AWS/Lambda", "Duration", "Average", "ms", "FunctionName"},
	{"AWS/ECS", "CPUUtilization", "Average", "percent", "ServiceName"},
	{"AWS/ECS", "MemoryUtilization", "Average", "percent", "ServiceName"},
}

func pollAWS(ctx context.Context, ds *DataSource) ([]Metric, error) {
	region := ds.Config["aws_region"]
	accessKeyID := ds.Config["aws_access_key_id"]
	secretKey := ds.Config["aws_secret_access_key"]

	if region == "" {
		return nil, fmt.Errorf("missing aws_region")
	}

	var cfg aws.Config
	var err error

	if accessKeyID != "" && secretKey != "" {
		cfg, err = awsconfig.LoadDefaultConfig(ctx,
			awsconfig.WithRegion(region),
			awsconfig.WithCredentialsProvider(
				credentials.NewStaticCredentialsProvider(accessKeyID, secretKey, ""),
			),
		)
	} else {
		// Fall back to environment / IAM role credentials
		cfg, err = awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	}
	if err != nil {
		return nil, fmt.Errorf("AWS config error: %w", err)
	}

	cw := cloudwatch.NewFromConfig(cfg)
	now := time.Now()
	startTime := now.Add(-pollInterval * 2) // look back 2 poll periods

	var queries []types.MetricDataQuery
	for i, m := range cloudwatchMetrics {
		id := fmt.Sprintf("m%d", i)
		queries = append(queries, types.MetricDataQuery{
			Id: aws.String(id),
			MetricStat: &types.MetricStat{
				Metric: &types.Metric{
					Namespace:  aws.String(m.Namespace),
					MetricName: aws.String(m.MetricName),
				},
				Period: aws.Int32(int32(pollInterval.Seconds())),
				Stat:   aws.String(m.Stat),
			},
			ReturnData: aws.Bool(true),
		})
	}

	resp, err := cw.GetMetricData(ctx, &cloudwatch.GetMetricDataInput{
		MetricDataQueries: queries,
		StartTime:         aws.Time(startTime),
		EndTime:           aws.Time(now),
	})
	if err != nil {
		return nil, fmt.Errorf("CloudWatch GetMetricData: %w", err)
	}

	var metrics []Metric
	for i, result := range resp.MetricDataResults {
		if i >= len(cloudwatchMetrics) {
			break
		}
		def := cloudwatchMetrics[i]
		host := "aws-" + region
		// Use the label (resource ID) as host if available
		if result.Label != nil && *result.Label != "" {
			host = *result.Label
		}

		for j, ts := range result.Timestamps {
			if j >= len(result.Values) {
				break
			}
			metricName := fmt.Sprintf("aws.%s.%s",
				strings.ToLower(strings.ReplaceAll(def.Namespace, "AWS/", "")),
				strings.ToLower(def.MetricName),
			)
			metrics = append(metrics, Metric{
				Timestamp:  ts,
				Host:       host,
				MetricName: metricName,
				Value:      result.Values[j],
				Unit:       def.Unit,
				Tags: map[string]string{
					"source":    "cloudwatch",
					"namespace": def.Namespace,
					"region":    region,
					"ds_id":     ds.ID,
				},
			})
		}
	}
	return metrics, nil
}

// ── Prometheus ────────────────────────────────────────────────────────────────

// Metrics to scrape from Prometheus instant query
var prometheusMetrics = []struct {
	Query      string
	MetricName string
	Unit       string
}{
	{`100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`, "node.cpu_usage_percent", "percent"},
	{`node_memory_MemAvailable_bytes`, "node.memory_available_bytes", "bytes"},
	{`node_memory_MemTotal_bytes`, "node.memory_total_bytes", "bytes"},
	{`node_filesystem_avail_bytes{mountpoint="/"}`, "node.disk_free_bytes", "bytes"},
	{`rate(node_network_receive_bytes_total[5m])`, "node.network_recv_bytes_rate", "bytes/s"},
	{`rate(node_network_transmit_bytes_total[5m])`, "node.network_sent_bytes_rate", "bytes/s"},
	{`node_load1`, "node.load1", "load"},
	{`process_resident_memory_bytes`, "process.memory_bytes", "bytes"},
}

type promQueryResult struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Value  [2]interface{}    `json:"value"`
		} `json:"result"`
	} `json:"data"`
}

func pollPrometheus(ctx context.Context, ds *DataSource) ([]Metric, error) {
	baseURL := ds.Config["prometheus_url"]
	if baseURL == "" {
		return nil, fmt.Errorf("missing prometheus_url")
	}
	baseURL = strings.TrimRight(baseURL, "/")
	token := ds.Config["prometheus_token"]

	now := time.Now()
	var metrics []Metric

	for _, pm := range prometheusMetrics {
		apiURL := fmt.Sprintf("%s/api/v1/query?query=%s&time=%d",
			baseURL, url.QueryEscape(pm.Query), now.Unix())

		req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
		if err != nil {
			continue
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("Prometheus query error: %w", err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var result promQueryResult
		if err := json.Unmarshal(body, &result); err != nil || result.Status != "success" {
			continue
		}

		for _, r := range result.Data.Result {
			host := r.Metric["instance"]
			if host == "" {
				host = r.Metric["job"]
			}
			if host == "" {
				host = "prometheus"
			}

			// value is [timestamp, "value_string"]
			var val float64
			if len(r.Value) >= 2 {
				switch v := r.Value[1].(type) {
				case string:
					fmt.Sscanf(v, "%f", &val)
				case float64:
					val = v
				}
			}

			tags := map[string]string{"source": "prometheus", "ds_id": ds.ID}
			for k, v := range r.Metric {
				tags[k] = v
			}

			metrics = append(metrics, Metric{
				Timestamp:  now,
				Host:       host,
				MetricName: pm.MetricName,
				Value:      val,
				Unit:       pm.Unit,
				Tags:       tags,
			})
		}
	}
	return metrics, nil
}

// ── GCP Cloud Monitoring ─────────────────────────────────────────────────────

func getGCPToken(ctx context.Context, serviceAccountJSON string) (string, error) {
	var sa struct {
		ClientEmail string `json:"client_email"`
		PrivateKey  string `json:"private_key"`
		TokenURI    string `json:"token_uri"`
	}
	if err := json.Unmarshal([]byte(serviceAccountJSON), &sa); err != nil {
		return "", fmt.Errorf("invalid service account JSON: %w", err)
	}
	if sa.ClientEmail == "" || sa.PrivateKey == "" {
		return "", fmt.Errorf("service account JSON missing client_email or private_key")
	}
	if sa.TokenURI == "" {
		sa.TokenURI = "https://oauth2.googleapis.com/token"
	}

	// Decode RSA private key from PEM
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return "", fmt.Errorf("failed to decode PEM private key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("failed to parse private key: %w", err)
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return "", fmt.Errorf("private key is not RSA")
	}

	// Build JWT: header.claims (base64url-encoded, dot-separated), then sign
	now := time.Now().Unix()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claimsJSON, _ := json.Marshal(map[string]interface{}{
		"iss":   sa.ClientEmail,
		"scope": "https://www.googleapis.com/auth/monitoring.read https://www.googleapis.com/auth/logging.read https://www.googleapis.com/auth/cloud-platform.read-only",
		"aud":   sa.TokenURI,
		"iat":   now,
		"exp":   now + 3600,
	})
	claims := base64.RawURLEncoding.EncodeToString(claimsJSON)
	sigInput := header + "." + claims
	h := sha256.New()
	h.Write([]byte(sigInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, rsaKey, crypto.SHA256, h.Sum(nil))
	if err != nil {
		return "", fmt.Errorf("JWT signing failed: %w", err)
	}
	jwt := sigInput + "." + base64.RawURLEncoding.EncodeToString(sig)

	// Exchange JWT for access token
	body := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {jwt},
	}
	req, _ := http.NewRequestWithContext(ctx, "POST", sa.TokenURI, strings.NewReader(body.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("GCP token request: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("GCP token endpoint returned %d: %s", resp.StatusCode, string(respBody))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrDesc     string `json:"error_description"`
	}
	json.Unmarshal(respBody, &tok)
	if tok.Error != "" {
		return "", fmt.Errorf("GCP token error: %s — %s", tok.Error, tok.ErrDesc)
	}
	return tok.AccessToken, nil
}

func pollGCP(ctx context.Context, ds *DataSource) ([]Metric, error) {
	project := ds.Config["gcp_project_id"]
	if project == "" {
		return nil, fmt.Errorf("missing gcp_project_id")
	}

	saJSON := ds.Config["gcp_service_account_json"]
	token, err := getGCPToken(ctx, saJSON)
	if err != nil {
		return nil, fmt.Errorf("GCP auth: %w", err)
	}

	// List of GCP metric types to query — broad coverage across all GCP services
	gcpMetrics := []struct{ filter, name, unit string }{
		// Compute Engine
		{`metric.type="compute.googleapis.com/instance/cpu/utilization"`, "gcp.compute.cpu_utilization", "percent"},
		{`metric.type="compute.googleapis.com/instance/memory/balloon/ram_used"`, "gcp.compute.memory_used", "bytes"},
		{`metric.type="compute.googleapis.com/instance/disk/read_bytes_count"`, "gcp.compute.disk_read_bytes", "bytes"},
		{`metric.type="compute.googleapis.com/instance/disk/write_bytes_count"`, "gcp.compute.disk_write_bytes", "bytes"},
		{`metric.type="compute.googleapis.com/instance/network/received_bytes_count"`, "gcp.compute.network_recv_bytes", "bytes"},
		{`metric.type="compute.googleapis.com/instance/network/sent_bytes_count"`, "gcp.compute.network_sent_bytes", "bytes"},
		// CloudSQL
		{`metric.type="cloudsql.googleapis.com/database/cpu/utilization"`, "gcp.cloudsql.cpu_utilization", "percent"},
		{`metric.type="cloudsql.googleapis.com/database/memory/utilization"`, "gcp.cloudsql.memory_utilization", "percent"},
		{`metric.type="cloudsql.googleapis.com/database/disk/bytes_used"`, "gcp.cloudsql.disk_bytes_used", "bytes"},
		// GKE
		{`metric.type="kubernetes.io/container/cpu/core_usage_time"`, "gcp.gke.cpu_core_usage", "seconds"},
		{`metric.type="kubernetes.io/container/memory/used_bytes"`, "gcp.gke.memory_used_bytes", "bytes"},
		{`metric.type="kubernetes.io/node/cpu/allocatable_utilization"`, "gcp.gke.node_cpu_utilization", "percent"},
		// Cloud Run
		{`metric.type="run.googleapis.com/request_count"`, "gcp.cloudrun.request_count", "count"},
		{`metric.type="run.googleapis.com/request_latencies"`, "gcp.cloudrun.request_latency", "ms"},
		{`metric.type="run.googleapis.com/container/cpu/utilizations"`, "gcp.cloudrun.cpu_utilization", "percent"},
		{`metric.type="run.googleapis.com/container/memory/utilizations"`, "gcp.cloudrun.memory_utilization", "percent"},
		// Cloud Storage
		{`metric.type="storage.googleapis.com/storage/total_bytes"`, "gcp.storage.total_bytes", "bytes"},
		{`metric.type="storage.googleapis.com/api/request_count"`, "gcp.storage.request_count", "count"},
		// Pub/Sub
		{`metric.type="pubsub.googleapis.com/subscription/num_undelivered_messages"`, "gcp.pubsub.undelivered_messages", "count"},
		{`metric.type="pubsub.googleapis.com/topic/send_message_operation_count"`, "gcp.pubsub.messages_sent", "count"},
		// BigQuery
		{`metric.type="bigquery.googleapis.com/storage/table_count"`, "gcp.bigquery.table_count", "count"},
		{`metric.type="bigquery.googleapis.com/storage/stored_bytes"`, "gcp.bigquery.stored_bytes", "bytes"},
		// Cloud Functions
		{`metric.type="cloudfunctions.googleapis.com/function/execution_count"`, "gcp.functions.execution_count", "count"},
		{`metric.type="cloudfunctions.googleapis.com/function/execution_times"`, "gcp.functions.execution_time", "ms"},
		// Dataflow
		{`metric.type="dataflow.googleapis.com/job/element_count"`, "gcp.dataflow.element_count", "count"},
		// Logging / API
		{`metric.type="logging.googleapis.com/log_entry_count"`, "gcp.logging.log_entry_count", "count"},
		{`metric.type="serviceruntime.googleapis.com/api/request_count"`, "gcp.api.request_count", "count"},
	}

	now := time.Now()
	startTime := now.Add(-30 * time.Minute).Format(time.RFC3339)
	endTime := now.Format(time.RFC3339)

	var metrics []Metric
	for _, gm := range gcpMetrics {
		apiURL := fmt.Sprintf(
			"https://monitoring.googleapis.com/v3/projects/%s/timeSeries?filter=%s&interval.startTime=%s&interval.endTime=%s",
			project, url.QueryEscape(gm.filter), startTime, endTime,
		)
		req, _ := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fmt.Printf("[poller] GCP %s request error: %v\n", gm.name, err)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			fmt.Printf("[poller] GCP %s returned %d: %s\n", gm.name, resp.StatusCode, string(body))
			continue
		}

		var result struct {
			TimeSeries []struct {
				Resource struct {
					Labels map[string]string `json:"labels"`
				} `json:"resource"`
				Points []struct {
					Interval struct {
						EndTime string `json:"endTime"`
					} `json:"interval"`
					Value struct {
						DoubleValue *float64 `json:"doubleValue"`
						Int64Value  *string  `json:"int64Value"`
					} `json:"value"`
				} `json:"points"`
			} `json:"timeSeries"`
		}
		json.Unmarshal(body, &result)

		for _, ts := range result.TimeSeries {
			host := ts.Resource.Labels["instance_id"]
			if host == "" {
				host = ts.Resource.Labels["database_id"]
			}
			if host == "" {
				host = "gcp-" + project
			}
			for _, pt := range ts.Points {
				t, _ := time.Parse(time.RFC3339, pt.Interval.EndTime)
				var val float64
				if pt.Value.DoubleValue != nil {
					val = *pt.Value.DoubleValue
				} else if pt.Value.Int64Value != nil {
					fmt.Sscanf(*pt.Value.Int64Value, "%f", &val)
				}
				metrics = append(metrics, Metric{
					Timestamp:  t,
					Host:       host,
					MetricName: gm.name,
					Value:      val,
					Unit:       gm.unit,
					Tags:       map[string]string{"source": "gcp", "project": project, "ds_id": ds.ID},
				})
			}
		}
	}

	// Also poll GCP Cloud Logging
	go pollGCPLogs(context.Background(), ds, project, token)

	return metrics, nil
}

// ── GCP Cloud Logging ────────────────────────────────────────────────────────

func pollGCPLogs(ctx context.Context, ds *DataSource, project, token string) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("[poller] GCP Logging panic: %v\n", r)
		}
	}()
	apiURL := "https://logging.googleapis.com/v2/entries:list"

	since := time.Now().Add(-pollInterval * 2).UTC().Format(time.RFC3339)
	payload := map[string]interface{}{
		"resourceNames": []string{"projects/" + project},
		"filter":        fmt.Sprintf(`timestamp >= "%s"`, since),
		"orderBy":       "timestamp desc",
		"pageSize":      500,
	}
	payloadJSON, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, strings.NewReader(string(payloadJSON)))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Printf("[poller] GCP Logging request error: %v\n", err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		fmt.Printf("[poller] GCP Logging returned %d: %s\n", resp.StatusCode, string(body))
		return
	}

	var result struct {
		Entries []struct {
			Timestamp    string `json:"timestamp"`
			Severity     string `json:"severity"`
			LogName      string `json:"logName"`
			TextPayload  string `json:"textPayload"`
			JsonPayload  map[string]interface{} `json:"jsonPayload"`
			ProtoPayload map[string]interface{} `json:"protoPayload"`
			Resource     struct {
				Type   string            `json:"type"`
				Labels map[string]string `json:"labels"`
			} `json:"resource"`
			Labels map[string]string `json:"labels"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		fmt.Printf("[poller] GCP Logging parse error: %v\n", err)
		return
	}

	if len(result.Entries) == 0 {
		return
	}

	var logs []LogEntry
	for _, e := range result.Entries {
		t, _ := time.Parse(time.RFC3339Nano, e.Timestamp)
		if t.IsZero() {
			t, _ = time.Parse(time.RFC3339, e.Timestamp)
		}
		if t.IsZero() {
			t = time.Now()
		}

		// Normalize severity
		sev := strings.ToLower(e.Severity)
		switch sev {
		case "debug", "info", "notice":
			sev = "info"
		case "warning":
			sev = "warn"
		case "error", "critical", "alert", "emergency":
			if sev == "critical" || sev == "alert" || sev == "emergency" {
				sev = "error"
			}
		default:
			sev = "info"
		}

		// Extract message
		message := e.TextPayload
		if message == "" && e.JsonPayload != nil {
			if msg, ok := e.JsonPayload["message"]; ok {
				message = fmt.Sprintf("%v", msg)
			} else {
				data, _ := json.Marshal(e.JsonPayload)
				message = string(data)
			}
		}
		if message == "" && e.ProtoPayload != nil {
			if msg, ok := e.ProtoPayload["methodName"]; ok {
				message = fmt.Sprintf("%v", msg)
			} else {
				data, _ := json.Marshal(e.ProtoPayload)
				message = string(data)
			}
		}
		if message == "" {
			message = e.LogName
		}

		// Extract host/source from log name and resource
		host := "gcp-" + project
		if e.Resource.Labels["instance_id"] != "" {
			host = e.Resource.Labels["instance_id"]
		} else if e.Resource.Labels["pod_name"] != "" {
			host = e.Resource.Labels["pod_name"]
		} else if e.Resource.Labels["service_name"] != "" {
			host = e.Resource.Labels["service_name"]
		}

		// Extract source from log name: projects/xxx/logs/SOURCE
		source := e.Resource.Type
		parts := strings.Split(e.LogName, "/logs/")
		if len(parts) == 2 {
			source = parts[1]
		}

		logs = append(logs, LogEntry{
			Timestamp: t,
			Host:      host,
			Source:    source,
			Severity:  sev,
			Message:   message,
			Tags:      map[string]string{"source": "gcp", "project": project, "resource_type": e.Resource.Type, "ds_id": ds.ID},
		})
	}

	if len(logs) > 0 {
		if err := insertLogs(logs); err != nil {
			fmt.Printf("[poller] GCP Logging insert error: %v\n", err)
		} else {
			fmt.Printf("[poller] GCP Logging: ingested %d log entries\n", len(logs))
		}
	}
}

// ── Azure Monitor ─────────────────────────────────────────────────────────────

func getAzureToken(ctx context.Context, tenantID, clientID, clientSecret string) (string, error) {
	body := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"scope":         {"https://management.azure.com/.default"},
	}
	tokenURL := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", tenantID)

	req, _ := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(body.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Azure token request: %w", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrDesc     string `json:"error_description"`
	}
	json.Unmarshal(b, &tok)
	if tok.Error != "" {
		return "", fmt.Errorf("Azure auth: %s", tok.ErrDesc)
	}
	return tok.AccessToken, nil
}

func pollAzure(ctx context.Context, ds *DataSource) ([]Metric, error) {
	subscriptionID := ds.Config["azure_subscription_id"]
	tenantID := ds.Config["azure_tenant_id"]
	clientID := ds.Config["azure_client_id"]
	clientSecret := ds.Config["azure_client_secret"]

	if subscriptionID == "" {
		return nil, fmt.Errorf("missing azure_subscription_id")
	}
	if tenantID == "" || clientID == "" || clientSecret == "" {
		return nil, fmt.Errorf("missing Azure credentials (tenant_id, client_id, client_secret)")
	}

	token, err := getAzureToken(ctx, tenantID, clientID, clientSecret)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	endTime := now.Format(time.RFC3339)
	startTime := now.Add(-pollInterval * 2).Format(time.RFC3339)
	timespan := fmt.Sprintf("%s/%s", startTime, endTime)

	// List VMs in subscription
	vmURL := fmt.Sprintf("https://management.azure.com/subscriptions/%s/providers/Microsoft.Compute/virtualMachines?api-version=2023-03-01", subscriptionID)
	req, _ := http.NewRequestWithContext(ctx, "GET", vmURL, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Azure list VMs: %w", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	var vmList struct {
		Value []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"value"`
	}
	json.Unmarshal(body, &vmList)

	azureMetricNames := []struct{ name, unit string }{
		{"Percentage CPU", "percent"},
		{"Network In Total", "bytes"},
		{"Network Out Total", "bytes"},
		{"Disk Read Bytes", "bytes"},
		{"Disk Write Bytes", "bytes"},
	}

	var metrics []Metric
	for _, vm := range vmList.Value {
		for _, am := range azureMetricNames {
			metURL := fmt.Sprintf(
				"https://management.azure.com%s/providers/microsoft.insights/metrics?api-version=2018-01-01&metricnames=%s&timespan=%s&interval=PT1M",
				vm.ID, url.QueryEscape(am.name), timespan,
			)
			r, _ := http.NewRequestWithContext(ctx, "GET", metURL, nil)
			r.Header.Set("Authorization", "Bearer "+token)
			mresp, err := http.DefaultClient.Do(r)
			if err != nil {
				continue
			}
			mb, _ := io.ReadAll(mresp.Body)
			mresp.Body.Close()

			var mResult struct {
				Value []struct {
					Name struct {
						Value string `json:"value"`
					} `json:"name"`
					Timeseries []struct {
						Data []struct {
							TimeStamp string   `json:"timeStamp"`
							Average   *float64 `json:"average"`
							Total     *float64 `json:"total"`
						} `json:"data"`
					} `json:"timeseries"`
				} `json:"value"`
			}
			json.Unmarshal(mb, &mResult)

			metricName := "azure.vm." + strings.ToLower(strings.ReplaceAll(am.name, " ", "_"))
			for _, v := range mResult.Value {
				for _, ts := range v.Timeseries {
					for _, dp := range ts.Data {
						var val float64
						if dp.Average != nil {
							val = *dp.Average
						} else if dp.Total != nil {
							val = *dp.Total
						} else {
							continue
						}
						t, _ := time.Parse(time.RFC3339, dp.TimeStamp)
						metrics = append(metrics, Metric{
							Timestamp:  t,
							Host:       vm.Name,
							MetricName: metricName,
							Value:      val,
							Unit:       am.unit,
							Tags:       map[string]string{"source": "azure", "subscription": subscriptionID, "ds_id": ds.ID},
						})
					}
				}
			}
		}
	}
	return metrics, nil
}

// ── Kubernetes Metrics Server ─────────────────────────────────────────────────

func pollKubernetes(ctx context.Context, ds *DataSource) ([]Metric, error) {
	endpoint := ds.Config["k8s_api_endpoint"]
	if endpoint == "" {
		endpoint = "https://kubernetes.default.svc"
	}
	token := ds.Config["k8s_token"]
	endpoint = strings.TrimRight(endpoint, "/")

	get := func(path string) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", endpoint+path, nil)
		if err != nil {
			return nil, err
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		// Skip TLS verification for in-cluster
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		return io.ReadAll(resp.Body)
	}

	now := time.Now()
	var metrics []Metric

	// Node metrics
	nodeBody, err := get("/apis/metrics.k8s.io/v1beta1/nodes")
	if err != nil {
		return nil, fmt.Errorf("K8s metrics-server: %w", err)
	}
	var nodeMetrics struct {
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
			Usage struct {
				CPU    string `json:"cpu"`
				Memory string `json:"memory"`
			} `json:"usage"`
		} `json:"items"`
	}
	json.Unmarshal(nodeBody, &nodeMetrics)

	for _, node := range nodeMetrics.Items {
		cpuNano := parseK8sQuantity(node.Usage.CPU)   // nanocores
		memBytes := parseK8sQuantity(node.Usage.Memory) // bytes (Ki suffix)
		metrics = append(metrics,
			Metric{Timestamp: now, Host: node.Metadata.Name, MetricName: "k8s.node.cpu_cores", Value: cpuNano / 1e9, Unit: "cores", Tags: map[string]string{"source": "kubernetes", "ds_id": ds.ID}},
			Metric{Timestamp: now, Host: node.Metadata.Name, MetricName: "k8s.node.memory_bytes", Value: memBytes, Unit: "bytes", Tags: map[string]string{"source": "kubernetes", "ds_id": ds.ID}},
		)
	}

	// Pod metrics
	podBody, err := get("/apis/metrics.k8s.io/v1beta1/pods")
	if err == nil {
		var podMetrics struct {
			Items []struct {
				Metadata struct {
					Name      string `json:"name"`
					Namespace string `json:"namespace"`
				} `json:"metadata"`
				Containers []struct {
					Name  string `json:"name"`
					Usage struct {
						CPU    string `json:"cpu"`
						Memory string `json:"memory"`
					} `json:"usage"`
				} `json:"containers"`
			} `json:"items"`
		}
		json.Unmarshal(podBody, &podMetrics)
		for _, pod := range podMetrics.Items {
			for _, c := range pod.Containers {
				host := fmt.Sprintf("%s/%s", pod.Metadata.Namespace, pod.Metadata.Name)
				metrics = append(metrics,
					Metric{Timestamp: now, Host: host, MetricName: "k8s.pod.cpu_cores", Value: parseK8sQuantity(c.Usage.CPU) / 1e9, Unit: "cores",
						Tags: map[string]string{"source": "kubernetes", "container": c.Name, "namespace": pod.Metadata.Namespace, "ds_id": ds.ID}},
					Metric{Timestamp: now, Host: host, MetricName: "k8s.pod.memory_bytes", Value: parseK8sQuantity(c.Usage.Memory), Unit: "bytes",
						Tags: map[string]string{"source": "kubernetes", "container": c.Name, "namespace": pod.Metadata.Namespace, "ds_id": ds.ID}},
				)
			}
		}
	}

	return metrics, nil
}

// parseK8sQuantity parses Kubernetes resource quantities like "250m" (millicores), "1024Ki" (kibibytes)
func parseK8sQuantity(q string) float64 {
	if q == "" {
		return 0
	}
	// nanocores: "100m" = 100 millicores = 100_000_000 nanocores
	if strings.HasSuffix(q, "n") {
		var v float64
		fmt.Sscanf(q, "%f", &v)
		return v
	}
	if strings.HasSuffix(q, "m") {
		var v float64
		fmt.Sscanf(q, "%f", &v)
		return v * 1e6 // millicores to nanocores
	}
	// memory: Ki, Mi, Gi
	suffixes := map[string]float64{"Ki": 1024, "Mi": 1024 * 1024, "Gi": 1024 * 1024 * 1024, "K": 1000, "M": 1e6, "G": 1e9}
	for suf, mul := range suffixes {
		if strings.HasSuffix(q, suf) {
			var v float64
			fmt.Sscanf(strings.TrimSuffix(q, suf), "%f", &v)
			return v * mul
		}
	}
	var v float64
	fmt.Sscanf(q, "%f", &v)
	return v
}
