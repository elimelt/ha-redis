package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/redis/go-redis/v9"
)

var (
	masterClient *redis.Client
	slaveClient  *redis.Client
	ctx          = context.Background()
	stats        Stats
)

type Stats struct {
	TotalRequests      int64 `json:"totalRequests"`
	SuccessfulRequests int64 `json:"successfulRequests"`
	FailedRequests     int64 `json:"failedRequests"`
	Reads              int64 `json:"reads"`
	Writes             int64 `json:"writes"`
	StartTime          int64 `json:"startTime"`
}

func init() {
	rand.Seed(time.Now().UnixNano())
	stats.StartTime = time.Now().Unix()
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// Parse Redis connection strings
	masterHost := os.Getenv("REDIS_MASTER_HOST")
	if masterHost == "" {
		masterHost = "redis-primary"
	}
	masterPort := os.Getenv("REDIS_MASTER_PORT")
	if masterPort == "" {
		masterPort = "6379"
	}

	slaveHost := os.Getenv("REDIS_SLAVE_HOST")
	if slaveHost == "" {
		slaveHost = "redis-replica-1"
	}
	slavePort := os.Getenv("REDIS_SLAVE_PORT")
	if slavePort == "" {
		slavePort = "6379"
	}

	log.Printf("Connecting to Redis master: %s:%s", masterHost, masterPort)
	log.Printf("Connecting to Redis slave: %s:%s", slaveHost, slavePort)

	// Create Redis clients
	masterClient = redis.NewClient(&redis.Options{
		Addr:         fmt.Sprintf("%s:%s", masterHost, masterPort),
		DialTimeout:  10 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	slaveClient = redis.NewClient(&redis.Options{
		Addr:         fmt.Sprintf("%s:%s", slaveHost, slavePort),
		DialTimeout:  10 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	// Test connections
	if err := masterClient.Ping(ctx).Err(); err != nil {
		log.Printf("Failed to connect to Redis master: %v", err)
	} else {
		log.Println("Connected to Redis master")
	}

	if err := slaveClient.Ping(ctx).Err(); err != nil {
		log.Printf("Failed to connect to Redis slave: %v", err)
	} else {
		log.Println("Connected to Redis slave")
	}

	// Setup router
	r := mux.NewRouter()
	r.Use(loggingMiddleware)

	// API Routes
	r.HandleFunc("/health", healthHandler).Methods("GET")
	r.HandleFunc("/stats", statsHandler).Methods("GET")
	r.HandleFunc("/stats/reset", resetStatsHandler).Methods("POST")
	r.HandleFunc("/set", setHandler).Methods("POST")
	r.HandleFunc("/incr", incrHandler).Methods("POST")
	r.HandleFunc("/lpush", lpushHandler).Methods("POST")
	r.HandleFunc("/sadd", saddHandler).Methods("POST")
	r.HandleFunc("/hset", hsetHandler).Methods("POST")
	r.HandleFunc("/get/{key}", getHandler).Methods("GET")
	r.HandleFunc("/get", getHandler).Methods("GET")
	r.HandleFunc("/exists/{key}", existsHandler).Methods("GET")
	r.HandleFunc("/exists", existsHandler).Methods("GET")
	r.HandleFunc("/lrange/{key}", lrangeHandler).Methods("GET")
	r.HandleFunc("/lrange", lrangeHandler).Methods("GET")
	r.HandleFunc("/smembers/{key}", smembersHandler).Methods("GET")
	r.HandleFunc("/smembers", smembersHandler).Methods("GET")
	r.HandleFunc("/hgetall/{key}", hgetallHandler).Methods("GET")
	r.HandleFunc("/hgetall", hgetallHandler).Methods("GET")
	r.HandleFunc("/load", loadHandler).Methods("POST")

	// Start server
	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	go func() {
		log.Printf("Go server listening on port %s", port)
		log.Println("Available endpoints:")
		log.Println("  GET  /health - Health check")
		log.Println("  GET  /stats - View statistics")
		log.Println("  POST /stats/reset - Reset statistics")
		log.Println("  POST /set - SET operation")
		log.Println("  POST /incr - INCR operation")
		log.Println("  POST /lpush - LPUSH operation")
		log.Println("  POST /sadd - SADD operation")
		log.Println("  POST /hset - HSET operation")
		log.Println("  GET  /get/:key? - GET operation")
		log.Println("  GET  /exists/:key? - EXISTS operation")
		log.Println("  GET  /lrange/:key? - LRANGE operation")
		log.Println("  GET  /smembers/:key? - SMEMBERS operation")
		log.Println("  GET  /hgetall/:key? - HGETALL operation")
		log.Println("  POST /load - Generate mixed load")

		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	masterClient.Close()
	slaveClient.Close()

	log.Println("Server exited")
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.RequestURI, time.Since(start))
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	err := masterClient.Ping(ctx).Err()
	if err != nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"status": "unhealthy",
			"error":  err.Error(),
		})
		return
	}

	err = slaveClient.Ping(ctx).Err()
	if err != nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"status": "unhealthy",
			"error":  err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "healthy",
		"message": "Connected to Redis cluster",
	})
}

func statsHandler(w http.ResponseWriter, r *http.Request) {
	uptime := float64(time.Now().Unix() - stats.StartTime)
	total := atomic.LoadInt64(&stats.TotalRequests)
	successful := atomic.LoadInt64(&stats.SuccessfulRequests)

	requestsPerSecond := 0.0
	if uptime > 0 {
		requestsPerSecond = float64(total) / uptime
	}

	successRate := 0.0
	if total > 0 {
		successRate = float64(successful) / float64(total) * 100
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"totalRequests":      total,
		"successfulRequests": successful,
		"failedRequests":     atomic.LoadInt64(&stats.FailedRequests),
		"reads":              atomic.LoadInt64(&stats.Reads),
		"writes":             atomic.LoadInt64(&stats.Writes),
		"startTime":          stats.StartTime,
		"uptime":             fmt.Sprintf("%.2fs", uptime),
		"requestsPerSecond":  fmt.Sprintf("%.2f", requestsPerSecond),
		"successRate":        fmt.Sprintf("%.2f%%", successRate),
	})
}

func resetStatsHandler(w http.ResponseWriter, r *http.Request) {
	atomic.StoreInt64(&stats.TotalRequests, 0)
	atomic.StoreInt64(&stats.SuccessfulRequests, 0)
	atomic.StoreInt64(&stats.FailedRequests, 0)
	atomic.StoreInt64(&stats.Reads, 0)
	atomic.StoreInt64(&stats.Writes, 0)
	stats.StartTime = time.Now().Unix()

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": "Statistics reset",
		"stats":   stats,
	})
}

func setHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Writes, 1)

	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
		TTL   int    `json:"ttl"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Key = ""
		req.Value = ""
		req.TTL = 0
	}

	if req.Key == "" {
		req.Key = generateRandomKey()
	}
	if req.Value == "" {
		req.Value = generateRandomString(20)
	}
	if req.TTL == 0 {
		req.TTL = 300
	}

	err := masterClient.Set(ctx, req.Key, req.Value, time.Duration(req.TTL)*time.Second).Err()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "SET",
		"key":       req.Key,
		"value":     req.Value,
		"ttl":       req.TTL,
	})
}

func incrHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Writes, 1)

	var req struct {
		Key string `json:"key"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Key = ""
	}

	if req.Key == "" {
		req.Key = fmt.Sprintf("counter:%d", getRandomInt(1, 100))
	}

	result, err := masterClient.Incr(ctx, req.Key).Result()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "INCR",
		"key":       req.Key,
		"value":     result,
	})
}

func lpushHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Writes, 1)

	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Key = ""
		req.Value = ""
	}

	if req.Key == "" {
		req.Key = fmt.Sprintf("list:%d", getRandomInt(1, 50))
	}
	if req.Value == "" {
		req.Value = generateRandomString(20)
	}

	err := masterClient.LPush(ctx, req.Key, req.Value).Err()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	masterClient.LTrim(ctx, req.Key, 0, 99)

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "LPUSH",
		"key":       req.Key,
		"value":     req.Value,
	})
}

func saddHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Writes, 1)

	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Key = ""
		req.Value = ""
	}

	if req.Key == "" {
		req.Key = fmt.Sprintf("set:%d", getRandomInt(1, 50))
	}
	if req.Value == "" {
		req.Value = generateRandomString(20)
	}

	result, err := masterClient.SAdd(ctx, req.Key, req.Value).Result()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "SADD",
		"key":       req.Key,
		"value":     req.Value,
		"added":     result == 1,
	})
}

func hsetHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Writes, 1)

	var req struct {
		Key   string `json:"key"`
		Field string `json:"field"`
		Value string `json:"value"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Key = ""
		req.Field = ""
		req.Value = ""
	}

	if req.Key == "" {
		req.Key = fmt.Sprintf("hash:%d", getRandomInt(1, 50))
	}
	if req.Field == "" {
		req.Field = generateRandomString(10)
	}
	if req.Value == "" {
		req.Value = generateRandomString(20)
	}

	result, err := masterClient.HSet(ctx, req.Key, req.Field, req.Value).Result()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "HSET",
		"key":       req.Key,
		"field":     req.Field,
		"value":     req.Value,
		"created":   result == 1,
	})
}

func getHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Reads, 1)

	vars := mux.Vars(r)
	key := vars["key"]
	if key == "" {
		key = generateRandomKey()
	}

	value, err := slaveClient.Get(ctx, key).Result()
	if err != nil && err != redis.Nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "GET",
		"key":       key,
		"value":     value,
		"found":     err != redis.Nil,
	})
}

func existsHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Reads, 1)

	vars := mux.Vars(r)
	key := vars["key"]
	if key == "" {
		key = generateRandomKey()
	}

	exists, err := slaveClient.Exists(ctx, key).Result()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "EXISTS",
		"key":       key,
		"exists":    exists == 1,
	})
}

func lrangeHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Reads, 1)

	vars := mux.Vars(r)
	key := vars["key"]
	if key == "" {
		key = fmt.Sprintf("list:%d", getRandomInt(1, 50))
	}

	start := 0
	stop := 10
	if s := r.URL.Query().Get("start"); s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			start = v
		}
	}
	if s := r.URL.Query().Get("stop"); s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			stop = v
		}
	}

	values, err := slaveClient.LRange(ctx, key, int64(start), int64(stop)).Result()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "LRANGE",
		"key":       key,
		"start":     start,
		"stop":      stop,
		"values":    values,
		"count":     len(values),
	})
}

func smembersHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Reads, 1)

	vars := mux.Vars(r)
	key := vars["key"]
	if key == "" {
		key = fmt.Sprintf("set:%d", getRandomInt(1, 50))
	}

	members, err := slaveClient.SMembers(ctx, key).Result()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"operation": "SMEMBERS",
		"key":       key,
		"members":   members,
		"count":     len(members),
	})
}

func hgetallHandler(w http.ResponseWriter, r *http.Request) {
	atomic.AddInt64(&stats.TotalRequests, 1)
	atomic.AddInt64(&stats.Reads, 1)

	vars := mux.Vars(r)
	key := vars["key"]
	if key == "" {
		key = fmt.Sprintf("hash:%d", getRandomInt(1, 50))
	}

	hash, err := slaveClient.HGetAll(ctx, key).Result()
	if err != nil {
		atomic.AddInt64(&stats.FailedRequests, 1)
		respondJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	atomic.AddInt64(&stats.SuccessfulRequests, 1)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success":    true,
		"operation":  "HGETALL",
		"key":        key,
		"hash":       hash,
		"fieldCount": len(hash),
	})
}

func loadHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Operations     int `json:"operations"`
		ReadWriteRatio int `json:"readWriteRatio"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Operations = 100
		req.ReadWriteRatio = 70
	}

	if req.Operations == 0 {
		req.Operations = 100
	}
	if req.ReadWriteRatio == 0 {
		req.ReadWriteRatio = 70
	}

	results := map[string]int{
		"requested":  req.Operations,
		"completed":  0,
		"successful": 0,
		"failed":     0,
		"reads":      0,
		"writes":     0,
	}

	writeOps := []string{"set", "incr", "lpush", "sadd", "hset"}
	readOps := []string{"get", "exists", "lrange", "smembers", "hgetall"}

	for i := 0; i < req.Operations; i++ {
		isRead := rand.Intn(100) < req.ReadWriteRatio

		var err error
		if isRead {
			results["reads"]++
			op := readOps[rand.Intn(len(readOps))]
			switch op {
			case "get":
				_, err = slaveClient.Get(ctx, generateRandomKey()).Result()
				if err == redis.Nil {
					err = nil
				}
			case "exists":
				_, err = slaveClient.Exists(ctx, generateRandomKey()).Result()
			case "lrange":
				_, err = slaveClient.LRange(ctx, fmt.Sprintf("list:%d", getRandomInt(1, 50)), 0, 10).Result()
			case "smembers":
				_, err = slaveClient.SMembers(ctx, fmt.Sprintf("set:%d", getRandomInt(1, 50))).Result()
			case "hgetall":
				_, err = slaveClient.HGetAll(ctx, fmt.Sprintf("hash:%d", getRandomInt(1, 50))).Result()
			}
		} else {
			results["writes"]++
			op := writeOps[rand.Intn(len(writeOps))]
			switch op {
			case "set":
				err = masterClient.Set(ctx, generateRandomKey(), generateRandomString(20), 300*time.Second).Err()
			case "incr":
				_, err = masterClient.Incr(ctx, fmt.Sprintf("counter:%d", getRandomInt(1, 100))).Result()
			case "lpush":
				listKey := fmt.Sprintf("list:%d", getRandomInt(1, 50))
				err = masterClient.LPush(ctx, listKey, generateRandomString(20)).Err()
				if err == nil {
					masterClient.LTrim(ctx, listKey, 0, 99)
				}
			case "sadd":
				_, err = masterClient.SAdd(ctx, fmt.Sprintf("set:%d", getRandomInt(1, 50)), generateRandomString(20)).Result()
			case "hset":
				_, err = masterClient.HSet(ctx, fmt.Sprintf("hash:%d", getRandomInt(1, 50)), generateRandomString(10), generateRandomString(20)).Result()
			}
		}

		if err != nil {
			results["failed"]++
		} else {
			results["successful"]++
		}
		results["completed"]++
	}

	atomic.AddInt64(&stats.TotalRequests, int64(results["completed"]))
	atomic.AddInt64(&stats.SuccessfulRequests, int64(results["successful"]))
	atomic.AddInt64(&stats.FailedRequests, int64(results["failed"]))
	atomic.AddInt64(&stats.Reads, int64(results["reads"]))
	atomic.AddInt64(&stats.Writes, int64(results["writes"]))

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Load generation completed",
		"results": results,
	})
}

// Helper functions
func generateRandomString(length int) string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	result := make([]byte, length)
	for i := range result {
		result[i] = chars[rand.Intn(len(chars))]
	}
	return string(result)
}

func generateRandomKey() string {
	return fmt.Sprintf("key:%d", rand.Intn(1000)+1)
}

func getRandomInt(min, max int) int {
	return rand.Intn(max-min+1) + min
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

