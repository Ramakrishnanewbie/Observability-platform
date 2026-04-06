package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type APIKey struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Prefix    string     `json:"prefix"`
	Hash      string     `json:"-"`
	Raw       string     `json:"key,omitempty"`
	OrgID     string     `json:"org_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
	Active    bool       `json:"active"`
}

// ── Global store ──────────────────────────────────────────────────────────────

var (
	apiKeys   []*APIKey
	apiKeysMu sync.RWMutex
)

// ── PostgreSQL persistence ────────────────────────────────────────────────────

func initAPIKeysTable() {
	db.Exec(context.Background(), `
		CREATE TABLE IF NOT EXISTS api_keys (
			id         TEXT PRIMARY KEY,
			name       TEXT NOT NULL,
			prefix     TEXT NOT NULL,
			hash       TEXT NOT NULL,
			org_id     TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL,
			active     BOOLEAN NOT NULL DEFAULT TRUE
		)
	`)
}

func loadAPIKeys() {
	rows, err := db.Query(context.Background(), `
		SELECT id, name, prefix, hash, org_id, created_at, active
		FROM api_keys WHERE active = TRUE
	`)
	if err != nil {
		log.Printf("Load API keys error: %v", err)
		return
	}
	defer rows.Close()

	apiKeysMu.Lock()
	defer apiKeysMu.Unlock()
	apiKeys = nil

	for rows.Next() {
		var k APIKey
		rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.Hash, &k.OrgID, &k.CreatedAt, &k.Active)
		apiKeys = append(apiKeys, &k)
	}
	log.Printf("Loaded %d API keys", len(apiKeys))
}

func saveAPIKey(k *APIKey) error {
	_, err := db.Exec(context.Background(),
		`INSERT INTO api_keys (id, name, prefix, hash, org_id, created_at, active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active`,
		k.ID, k.Name, k.Prefix, k.Hash, k.OrgID, k.CreatedAt, k.Active)
	return err
}

// ── Validation middleware ─────────────────────────────────────────────────────

func validateAPIKey(r *http.Request) bool {
	if !requireAuth {
		return true
	}

	raw := ""
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		raw = strings.TrimPrefix(auth, "Bearer ")
	} else if key := r.Header.Get("X-API-Key"); key != "" {
		raw = key
	}

	if raw == "" {
		return false
	}

	hash := hashAPIKey(raw)
	apiKeysMu.RLock()
	defer apiKeysMu.RUnlock()
	for _, k := range apiKeys {
		if k.Active && k.Hash == hash {
			go func(key *APIKey) {
				now := time.Now()
				key.LastUsed = &now
			}(k)
			return true
		}
	}
	return false
}

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if !validateAPIKey(r) {
			http.Error(w, `{"error":"Unauthorized. Provide a valid API key via Authorization: Bearer <key> or X-API-Key header"}`, 401)
			return
		}
		next(w, r)
	})
}

// ── API Handlers ──────────────────────────────────────────────────────────────

func handleAPIKeyCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", 405)
		return
	}
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var req struct {
		Name  string `json:"name"`
		OrgID string `json:"org_id"`
	}
	json.Unmarshal(body, &req)
	if req.Name == "" {
		req.Name = "API Key"
	}

	raw, prefix, hash := generateAPIKey()
	k := &APIKey{
		ID:        shortID(),
		Name:      req.Name,
		Prefix:    prefix,
		Hash:      hash,
		Raw:       raw,
		OrgID:     req.OrgID,
		CreatedAt: time.Now(),
		Active:    true,
	}

	if err := saveAPIKey(k); err != nil {
		log.Printf("Save API key error: %v", err)
		http.Error(w, "Failed to save", 500)
		return
	}

	apiKeysMu.Lock()
	apiKeys = append(apiKeys, k)
	apiKeysMu.Unlock()

	jsonOK(w, k)
	k.Raw = ""
}

func handleAPIKeyList(w http.ResponseWriter, r *http.Request) {
	apiKeysMu.RLock()
	defer apiKeysMu.RUnlock()

	type PublicKey struct {
		ID        string     `json:"id"`
		Name      string     `json:"name"`
		Prefix    string     `json:"prefix"`
		OrgID     string     `json:"org_id"`
		CreatedAt time.Time  `json:"created_at"`
		LastUsed  *time.Time `json:"last_used,omitempty"`
		Active    bool       `json:"active"`
	}

	var out []PublicKey
	for _, k := range apiKeys {
		if k.Active {
			out = append(out, PublicKey{
				ID: k.ID, Name: k.Name, Prefix: k.Prefix,
				OrgID: k.OrgID, CreatedAt: k.CreatedAt,
				LastUsed: k.LastUsed, Active: k.Active,
			})
		}
	}
	jsonOK(w, out)
}

func handleAPIKeyDelete(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing id", 400)
		return
	}

	db.Exec(context.Background(), `UPDATE api_keys SET active = FALSE WHERE id = $1`, id)

	apiKeysMu.Lock()
	for _, k := range apiKeys {
		if k.ID == id {
			k.Active = false
			break
		}
	}
	apiKeysMu.Unlock()

	jsonOK(w, map[string]string{"status": "revoked"})
}
