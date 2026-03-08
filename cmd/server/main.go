package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

type Metric struct {
	Timestamp  time.Time `json:"timestamp"`
	Host       string    `json:"host"`
	MetricName string    `json:"metric_name"`
	Value      float64   `json:"value"`
	Unit       string    `json:"unit"`
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var metrics []Metric
	if err := json.Unmarshal(body, &metrics); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	fmt.Printf("\n📥 Received %d metrics:\n", len(metrics))
	for _, m := range metrics {
		fmt.Printf("  [%s] %s | %-25s | %.2f %s\n",
			m.Timestamp.Format("15:04:05"),
			m.Host,
			m.MetricName,
			m.Value,
			m.Unit,
		)
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status": "ok"}`))
}

func main() {
	http.HandleFunc("/v1/metrics", handleMetrics)

	fmt.Println("=================================")
	fmt.Println("  Observo Server Started")
	fmt.Println("  Listening on :8080")
	fmt.Println("=================================")

	log.Fatal(http.ListenAndServe(":8080", nil))
}
