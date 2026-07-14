package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type Mapping struct {
	Store  string `json:"store"`
	Sector string `json:"sector"`
	Guiche string `json:"guiche"`
}

type Config struct {
	Enabled  bool               `json:"enabled"`
	Port     int                `json:"port"`
	Mappings map[string]Mapping `json:"mappings"`
}

type APICallPayload struct {
	Store  string `json:"store"`
	Sector string `json:"sector"`
	Guiche string `json:"guiche"`
}

var (
	debounceMap sync.Map // IP -> time.Time
)

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.Port == 0 {
		cfg.Port = 9050
	}
	return &cfg, nil
}

func callBackend(m Mapping) {
	payload := APICallPayload{
		Store:  m.Store,
		Sector: m.Sector,
		Guiche: m.Guiche,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Error marshaling payload: %v", err)
		return
	}

	resp, err := http.Post("http://localhost:3000/api/toledo/call", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("Error calling backend: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Backend returned error status %d: %s", resp.StatusCode, string(bodyBytes))
	} else {
		log.Printf("Successfully called backend for %s / %s", m.Store, m.Sector)
	}
}

func handleConnection(conn net.Conn, cfg *Config) {
	defer conn.Close()

	remoteAddr := conn.RemoteAddr().String()
	ip := strings.Split(remoteAddr, ":")[0]

	log.Printf("Accepted connection from %s", remoteAddr)

	mapping, found := cfg.Mappings[ip]
	if !found {
		log.Printf("IP %s not found in mappings, ignoring.", ip)
		return
	}

	buf := make([]byte, 1024)
	for {
		n, err := conn.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("Error reading from %s: %v", remoteAddr, err)
			}
			break
		}

		if n > 0 {
			// Data received, handle debounce
			now := time.Now()
			if lastVal, ok := debounceMap.Load(ip); ok {
				lastTime := lastVal.(time.Time)
				if now.Sub(lastTime) < 2*time.Second {
					// Debounced
					continue
				}
			}

			debounceMap.Store(ip, now)
			log.Printf("Received %d bytes from %s, triggering backend call", n, ip)
			
			go callBackend(mapping)
		}
	}
}

func main() {
	configPath := "../toledo-config.json"
	cfg, err := loadConfig(configPath)
	if err != nil {
		log.Fatalf("Failed to load config from %s: %v", configPath, err)
	}

	if !cfg.Enabled {
		log.Println("Agent is disabled in config. Exiting.")
		return
	}

	addr := fmt.Sprintf(":%d", cfg.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", addr, err)
	}
	log.Printf("Toledo Agent listening on %s", addr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Error accepting connection: %v", err)
			continue
		}
		go handleConnection(conn, cfg)
	}
}
