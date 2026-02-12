package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

type Task struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

var (
	tasks = make(map[string]Task)
	mu    sync.RWMutex
)

func handleTasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		mu.RLock()
		defer mu.RUnlock()
		result := make([]Task, 0, len(tasks))
		for _, t := range tasks {
			result = append(result, t)
		}
		json.NewEncoder(w).Encode(result)
	case http.MethodPost:
		var t Task
		json.NewDecoder(r.Body).Decode(&t)
		mu.Lock()
		tasks[t.ID] = t
		mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(t)
	}
}

func main() {
	http.HandleFunc("/tasks", handleTasks)
	fmt.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
