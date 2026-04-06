package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type DataSource struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Type      string            `json:"type"`
	Config    map[string]string `json:"config"`
	Status    string            `json:"status"`
	LastSync  *time.Time        `json:"last_sync,omitempty"`
	Error     string            `json:"error,omitempty"`
	CreatedAt time.Time         `json:"created_at"`
	Enabled   bool              `json:"enabled"`
}

// ── Global store ──────────────────────────────────────────────────────────────

var (
	dataSources   []*DataSource
	dataSourcesMu sync.RWMutex
)

// ── PostgreSQL persistence ────────────────────────────────────────────────────

func initDataSourcesTable() {
	db.Exec(context.Background(), `
		CREATE TABLE IF NOT EXISTS data_sources_v2 (
			id          TEXT PRIMARY KEY,
			name        TEXT NOT NULL,
			type        TEXT NOT NULL,
			config_json TEXT NOT NULL DEFAULT '{}',
			status      TEXT NOT NULL DEFAULT 'pending',
			error_msg   TEXT NOT NULL DEFAULT '',
			created_at  TIMESTAMPTZ NOT NULL,
			enabled     BOOLEAN NOT NULL DEFAULT TRUE
		)
	`)
}

func loadDataSources() {
	rows, err := db.Query(context.Background(), `
		SELECT id, name, type, config_json, status, error_msg, created_at, enabled
		FROM data_sources_v2
	`)
	if err != nil {
		return
	}
	defer rows.Close()

	dataSourcesMu.Lock()
	defer dataSourcesMu.Unlock()
	dataSources = nil

	for rows.Next() {
		var ds DataSource
		var configJSON, errMsg string
		rows.Scan(&ds.ID, &ds.Name, &ds.Type, &configJSON, &ds.Status, &errMsg, &ds.CreatedAt, &ds.Enabled)
		ds.Error = errMsg
		json.Unmarshal([]byte(configJSON), &ds.Config)
		dataSources = append(dataSources, &ds)
	}
}

func saveDataSource(ds *DataSource) error {
	cfgJSON, _ := json.Marshal(ds.Config)
	errMsg := ds.Error
	_, err := db.Exec(context.Background(),
		`INSERT INTO data_sources_v2 (id, name, type, config_json, status, error_msg, created_at, enabled)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (id) DO UPDATE SET
		   name = EXCLUDED.name, type = EXCLUDED.type, config_json = EXCLUDED.config_json,
		   status = EXCLUDED.status, error_msg = EXCLUDED.error_msg, enabled = EXCLUDED.enabled`,
		ds.ID, ds.Name, ds.Type, string(cfgJSON), ds.Status, errMsg, ds.CreatedAt, ds.Enabled)
	return err
}

// ── API Handlers ──────────────────────────────────────────────────────────────

func handleDSList(w http.ResponseWriter, r *http.Request) {
	dataSourcesMu.RLock()
	defer dataSourcesMu.RUnlock()

	type PublicDS struct {
		ID        string            `json:"id"`
		Name      string            `json:"name"`
		Type      string            `json:"type"`
		Config    map[string]string `json:"config"`
		Status    string            `json:"status"`
		LastSync  *time.Time        `json:"last_sync,omitempty"`
		Error     string            `json:"error,omitempty"`
		CreatedAt time.Time         `json:"created_at"`
		Enabled   bool              `json:"enabled"`
	}

	var out []PublicDS
	for _, ds := range dataSources {
		masked := make(map[string]string)
		for k, v := range ds.Config {
			if isSensitiveKey(k) {
				if len(v) > 8 {
					masked[k] = v[:4] + strings.Repeat("*", len(v)-8) + v[len(v)-4:]
				} else {
					masked[k] = "***"
				}
			} else {
				masked[k] = v
			}
		}
		out = append(out, PublicDS{
			ID: ds.ID, Name: ds.Name, Type: ds.Type,
			Config: masked, Status: ds.Status,
			LastSync: ds.LastSync, Error: ds.Error,
			CreatedAt: ds.CreatedAt, Enabled: ds.Enabled,
		})
	}
	jsonOK(w, out)
}

func isSensitiveKey(k string) bool {
	lower := strings.ToLower(k)
	return strings.Contains(lower, "secret") ||
		strings.Contains(lower, "password") ||
		strings.Contains(lower, "key") ||
		strings.Contains(lower, "token") ||
		strings.Contains(lower, "credential") ||
		strings.Contains(lower, "service_account") ||
		strings.Contains(lower, "private")
}

func handleDSCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var ds DataSource
	if err := json.Unmarshal(body, &ds); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	if ds.ID == "" {
		ds.ID = shortID()
	}
	ds.CreatedAt = time.Now()
	ds.Status = "pending"
	ds.Enabled = true

	if err := saveDataSource(&ds); err != nil {
		http.Error(w, "Failed to save", 500)
		return
	}

	dataSourcesMu.Lock()
	dataSources = append(dataSources, &ds)
	dataSourcesMu.Unlock()

	go func() {
		testDataSourceConnection(&ds)
		startPoller(&ds)
	}()

	jsonOK(w, ds)
}

func handleDSDelete(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing id", 400)
		return
	}
	db.Exec(context.Background(), `DELETE FROM data_sources_v2 WHERE id = $1`, id)

	dataSourcesMu.Lock()
	for i, ds := range dataSources {
		if ds.ID == id {
			dataSources = append(dataSources[:i], dataSources[i+1:]...)
			break
		}
	}
	dataSourcesMu.Unlock()

	stopPoller(id)
	jsonOK(w, map[string]string{"status": "deleted"})
}

func handleDSTest(w http.ResponseWriter, r *http.Request) {
	// Test by ID — uses stored (unmasked) credentials from memory
	if id := r.URL.Query().Get("id"); id != "" {
		dataSourcesMu.RLock()
		var found *DataSource
		for _, d := range dataSources {
			if d.ID == id {
				cp := *d
				found = &cp
				break
			}
		}
		dataSourcesMu.RUnlock()
		if found == nil {
			http.Error(w, "Datasource not found", 404)
			return
		}
		jsonOK(w, testDataSourceDirect(found))
		return
	}

	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var ds DataSource
	if err := json.Unmarshal(body, &ds); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	result := testDataSourceDirect(&ds)
	jsonOK(w, result)
}

// ── Connection testing ────────────────────────────────────────────────────────

type TestResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Latency int64  `json:"latency_ms"`
}

func testDataSourceConnection(ds *DataSource) {
	result := testDataSourceDirect(ds)

	dataSourcesMu.Lock()
	for _, d := range dataSources {
		if d.ID == ds.ID {
			if result.Success {
				d.Status = "connected"
				d.Error = ""
			} else {
				d.Status = "error"
				d.Error = result.Message
			}
			now := time.Now()
			d.LastSync = &now
			saveDataSource(d)
			break
		}
	}
	dataSourcesMu.Unlock()
}

func testDataSourceDirect(ds *DataSource) TestResult {
	start := time.Now()
	switch ds.Type {
	case "aws":
		return testAWSConnection(ds, start)
	case "gcp":
		return testGCPConnection(ds, start)
	case "azure":
		return testAzureConnection(ds, start)
	case "kubernetes":
		return testK8sConnection(ds, start)
	case "prometheus":
		return testPrometheusConnection(ds, start)
	default:
		return TestResult{false, fmt.Sprintf("Unknown data source type: %s", ds.Type), 0}
	}
}

func testAWSConnection(ds *DataSource, start time.Time) TestResult {
	region := ds.Config["aws_region"]
	if region == "" {
		return TestResult{false, "Missing aws_region", 0}
	}
	accessKey := ds.Config["aws_access_key_id"]
	secretKey := ds.Config["aws_secret_access_key"]
	if accessKey == "" || secretKey == "" {
		return TestResult{false, "Missing AWS credentials (access_key_id and secret_access_key required)", 0}
	}
	url := fmt.Sprintf("https://monitoring.%s.amazonaws.com/", region)
	resp, err := http.Get(url)
	if err != nil {
		return TestResult{false, fmt.Sprintf("Cannot reach AWS CloudWatch in %s: %v", region, err), 0}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 400 || resp.StatusCode == 403 || resp.StatusCode == 200 {
		return TestResult{true, fmt.Sprintf("AWS CloudWatch reachable in %s", region), time.Since(start).Milliseconds()}
	}
	return TestResult{false, fmt.Sprintf("Unexpected response from AWS: %d", resp.StatusCode), time.Since(start).Milliseconds()}
}

func testGCPConnection(ds *DataSource, start time.Time) TestResult {
	project := ds.Config["gcp_project_id"]
	if project == "" {
		return TestResult{false, "Missing gcp_project_id", 0}
	}
	saJSON := ds.Config["gcp_service_account_json"]
	if saJSON == "" {
		return TestResult{false, "Missing gcp_service_account_json", 0}
	}

	ctx := context.Background()
	token, err := getGCPToken(ctx, saJSON)
	if err != nil {
		return TestResult{false, fmt.Sprintf("GCP auth failed: %v", err), time.Since(start).Milliseconds()}
	}

	apiURL := fmt.Sprintf("https://monitoring.googleapis.com/v3/projects/%s/metricDescriptors?pageSize=1", project)
	req, _ := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return TestResult{false, fmt.Sprintf("Cannot reach GCP Monitoring: %v", err), time.Since(start).Milliseconds()}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return TestResult{true, fmt.Sprintf("GCP Monitoring connected — project %s", project), time.Since(start).Milliseconds()}
	}
	body, _ := io.ReadAll(resp.Body)
	return TestResult{false, fmt.Sprintf("GCP Monitoring returned %d: %s", resp.StatusCode, string(body)), time.Since(start).Milliseconds()}
}

func testAzureConnection(ds *DataSource, start time.Time) TestResult {
	subscription := ds.Config["azure_subscription_id"]
	if subscription == "" {
		return TestResult{false, "Missing azure_subscription_id", 0}
	}
	resp, err := http.Get("https://management.azure.com/")
	if err != nil {
		return TestResult{false, fmt.Sprintf("Cannot reach Azure: %v", err), 0}
	}
	defer resp.Body.Close()
	return TestResult{true, fmt.Sprintf("Azure Management API reachable for subscription %s", subscription), time.Since(start).Milliseconds()}
}

func testK8sConnection(ds *DataSource, start time.Time) TestResult {
	endpoint := ds.Config["k8s_api_endpoint"]
	if endpoint == "" {
		endpoint = "https://kubernetes.default.svc"
	}
	resp, err := http.Get(endpoint + "/healthz")
	if err != nil {
		return TestResult{false, fmt.Sprintf("Cannot reach Kubernetes API at %s: %v", endpoint, err), 0}
	}
	defer resp.Body.Close()
	return TestResult{true, fmt.Sprintf("Kubernetes API reachable at %s", endpoint), time.Since(start).Milliseconds()}
}

func testPrometheusConnection(ds *DataSource, start time.Time) TestResult {
	url := ds.Config["prometheus_url"]
	if url == "" {
		return TestResult{false, "Missing prometheus_url", 0}
	}
	resp, err := http.Get(url + "/-/ready")
	if err != nil {
		return TestResult{false, fmt.Sprintf("Cannot reach Prometheus at %s: %v", url, err), 0}
	}
	defer resp.Body.Close()
	return TestResult{true, fmt.Sprintf("Prometheus reachable at %s", url), time.Since(start).Milliseconds()}
}
