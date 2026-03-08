package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

type Metric struct {
	Timestamp  time.Time `json:"timestamp"`
	Host       string    `json:"host"`
	MetricName string    `json:"metric_name"`
	Value      float64   `json:"value"`
	Unit       string    `json:"unit"`
}

func collectMetrics(hostname string) ([]Metric, error) {
	now := time.Now()
	var metrics []Metric

	cpuPercent, err := cpu.Percent(1*time.Second, false)
	if err != nil {
		return nil, fmt.Errorf("failed to read CPU: %w", err)
	}
	metrics = append(metrics, Metric{
		Timestamp:  now,
		Host:       hostname,
		MetricName: "cpu.usage_percent",
		Value:      cpuPercent[0],
		Unit:       "percent",
	})

	memInfo, err := mem.VirtualMemory()
	if err != nil {
		return nil, fmt.Errorf("failed to read memory: %w", err)
	}
	metrics = append(metrics, Metric{
		Timestamp:  now,
		Host:       hostname,
		MetricName: "memory.usage_percent",
		Value:      memInfo.UsedPercent,
		Unit:       "percent",
	})
	metrics = append(metrics, Metric{
		Timestamp:  now,
		Host:       hostname,
		MetricName: "memory.used_bytes",
		Value:      float64(memInfo.Used),
		Unit:       "bytes",
	})
	metrics = append(metrics, Metric{
		Timestamp:  now,
		Host:       hostname,
		MetricName: "memory.total_bytes",
		Value:      float64(memInfo.Total),
		Unit:       "bytes",
	})

	diskInfo, err := disk.Usage("/")
	if err != nil {
		return nil, fmt.Errorf("failed to read disk: %w", err)
	}
	metrics = append(metrics, Metric{
		Timestamp:  now,
		Host:       hostname,
		MetricName: "disk.usage_percent",
		Value:      diskInfo.UsedPercent,
		Unit:       "percent",
	})

	return metrics, nil
}

func main() {

	hostInfo, err := host.Info()
	if err != nil {
		log.Fatalf("Failed to get host info: %v", err)
	}
	hostname := hostInfo.Hostname

	fmt.Println("=================================")
	fmt.Printf("  Observo Agent Started\n")
	fmt.Printf("  Host: %s\n", hostname)
	fmt.Printf("  Sending to http://localhost:8080\n")
	fmt.Println("=================================")
	fmt.Println()

	for {
		metrics, err := collectMetrics(hostname)
		if err != nil {
			log.Printf("Error collecting metrics: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		jsonData, err := json.Marshal(metrics)
		if err != nil {
			log.Printf("Error marshaling JSON: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		resp, err := http.Post(
			"http://localhost:8080/v1/metrics",
			"application/json",
			bytes.NewBuffer(jsonData),
		)
		if err != nil {
			log.Printf("Failed to send metrics: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}
		resp.Body.Close()

		fmt.Printf("[%s] Sent %d metrics ✓\n",
			time.Now().Format("15:04:05"),
			len(metrics),
		)

		time.Sleep(5 * time.Second)
	}
}
