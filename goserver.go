package main

import (
  "fmt"
  "net/http"
  "strings"
  "time"
)

// writeSSE writes a single payload as one SSE event: each line prefixed with
// "data: " and the event terminated by a blank line.
func writeSSE(w http.ResponseWriter, payload string) {
  for _, line := range strings.Split(payload, "\n") {
    fmt.Fprintf(w, "data: %s\n", line)
  }
  fmt.Fprint(w, "\n")
}

func sseHandler(w http.ResponseWriter, r *http.Request) {

  // Each entry is sent as its own SSE event.
  data := []string{
    `{"id":1024,"ts":1781776140516,"destination":"henk","flow":"Pietje Puk - de flow!","flow_execution_id":"123123sdflkjsflkjwefjeqrfkljerf","trigger_ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0","trigger_ip":"127.0.0.1"}`,
    `{"id":2048,"ts":1781776124992,"destination":"MIJN_APP","flow":"Pietje Puk - de flow!","flow_execution_id":"123123sdflkjsflkjwefjeqrfkljerf","trigger_ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0","trigger_ip":"127.0.0.1"}`,
    `{"id":3072,"ts":1782382937985,"destination":"AndereHenk","flow":"Pietje Puk - de flow!","flow_execution_id":"123123sdflkjsflkjwefjeqrfkljerf","trigger_ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0","trigger_ip":"127.0.0.1"}`,
    `{"id":4096,"ts":1782736680349,"destination":"VierdeApp","flow":"Pietje Puk - de flow!","flow_execution_id":"123123sdflkjsflkjwefjeqrfkljerf","trigger_ua":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0","trigger_ip":"127.0.0.1"}`,
  }

  events := []string{
    `{"id":4096,"ttfb":330,"response_size":2200,"response_code":200}`,
    `{"id":2048,"ttfb":330,"response_size":2200,"response_code":200}`,
    `{"id":1024,"ttfb":330,"response_size":2200,"response_code":200}`,
    `{"id":3072,"ttfb":330,"response_size":2200,"response_code":200}`,
  }

  // Fuck cors
  w.Header().Set("Access-Control-Allow-Origin", "*")
  w.Header().Set("Access-Control-Allow-Headers", "*")
  w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")

  // Answer the CORS preflight before doing anything else.
  if r.Method == http.MethodOptions {
    w.WriteHeader(http.StatusNoContent)
    return
  }

  w.Header().Set("Content-Type", "text/event-stream")
  w.Header().Set("Cache-Control", "no-cache")
  w.Header().Set("Connection", "keep-alive")

  // Create a channel for client disconnection
  clientGone := r.Context().Done()

  rc := http.NewResponseController(w)

  // Initial data: one SSE event per entry.
  for _, d := range data {
    writeSSE(w, d)
  }
  if err := rc.Flush(); err != nil {
    return
  }

  t := time.NewTicker(time.Second)
  defer t.Stop()
  for {
    select {
    case <-clientGone:
      fmt.Println("Client disconnected")
      return
    case <-t.C:
      // Send an event to the client every tick.
      for _, event := range events {
        writeSSE(w, event)
      }
      if err := rc.Flush(); err != nil {
        return
      }
    }
  }
}

func main() {
  http.HandleFunc("/", sseHandler)
  http.ListenAndServe(":1337", nil)
}
 