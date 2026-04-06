package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
)

// ── Environment-based configuration ──────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	pgHost      = getEnv("POSTGRES_HOST", "localhost")
	pgPort      = getEnv("POSTGRES_PORT", "5432")
	pgDB        = getEnv("POSTGRES_DB", "observo")
	pgUser      = getEnv("POSTGRES_USER", "observo")
	pgPass      = getEnv("POSTGRES_PASS", "observo")
	serverPort  = getEnv("PORT", "8080")
	requireAuth = getEnv("REQUIRE_AUTH", "false") == "true"
)

// ── API Key helpers ───────────────────────────────────────────────────────────

func generateAPIKey() (raw, prefix, hash string) {
	b := make([]byte, 24)
	rand.Read(b)
	raw = "obs_live_" + hex.EncodeToString(b)
	prefix = raw[:16] + "…"
	h := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(h[:])
	return
}

func hashAPIKey(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func shortID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func maskKey(raw string) string {
	if len(raw) <= 16 {
		return raw
	}
	return fmt.Sprintf("%s…", raw[:16])
}
