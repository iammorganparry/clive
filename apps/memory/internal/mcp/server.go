package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const protocolVersion = "2024-11-05"

// Server implements an MCP stdio server that delegates to the HTTP memory server.
type Server struct {
	serverURL string
	namespace string
	client    *http.Client
}

// NewServer creates a new MCP server.
func NewServer(serverURL, namespace string) *Server {
	return &Server{
		serverURL: strings.TrimRight(serverURL, "/"),
		namespace: namespace,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Run starts the stdio event loop. Blocks until stdin is closed.
func (s *Server) Run() error {
	scanner := bufio.NewScanner(os.Stdin)
	// Increase buffer for large messages
	buf := make([]byte, 0, 1024*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var req Request
		if err := json.Unmarshal(line, &req); err != nil {
			s.writeError(nil, -32700, "parse error: "+err.Error())
			continue
		}

		resp := s.handleRequest(&req)
		if resp != nil {
			s.writeResponse(resp)
		}
	}

	return scanner.Err()
}

func (s *Server) handleRequest(req *Request) *Response {
	switch req.Method {
	case "initialize":
		return s.handleInitialize(req)
	case "initialized":
		// Notification — no response
		return nil
	case "tools/list":
		return s.handleToolsList(req)
	case "tools/call":
		return s.handleToolsCall(req)
	case "ping":
		return &Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]string{}}
	default:
		return &Response{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &RPCError{Code: -32601, Message: "method not found: " + req.Method},
		}
	}
}

func (s *Server) handleInitialize(req *Request) *Response {
	return &Response{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result: InitializeResult{
			ProtocolVersion: protocolVersion,
			Capabilities: ServerCapabilities{
				Tools: &ToolCapabilities{},
			},
			ServerInfo: ServerInfo{
				Name:    "clive-memory",
				Version: "1.0.0",
			},
		},
	}
}

func (s *Server) handleToolsList(req *Request) *Response {
	return &Response{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result:  ToolsListResult{Tools: ToolDefinitions()},
	}
}

func (s *Server) handleToolsCall(req *Request) *Response {
	paramsBytes, err := json.Marshal(req.Params)
	if err != nil {
		return s.errorResponse(req.ID, -32602, "invalid params")
	}

	var params CallToolParams
	if err := json.Unmarshal(paramsBytes, &params); err != nil {
		return s.errorResponse(req.ID, -32602, "invalid params: "+err.Error())
	}

	result, isError := s.dispatchTool(params.Name, params.Arguments)

	return &Response{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result: CallToolResult{
			Content: []ContentBlock{{Type: "text", Text: result}},
			IsError: isError,
		},
	}
}

func (s *Server) dispatchTool(name string, args map[string]interface{}) (string, bool) {
	switch name {
	case "memory_search_index":
		return s.toolSearchIndex(args)
	case "memory_get":
		return s.toolGet(args)
	case "memory_timeline":
		return s.toolTimeline(args)
	case "memory_store":
		return s.toolStore(args)
	case "memory_impact":
		return s.toolImpact(args)
	case "memory_supersede":
		return s.toolSupersede(args)
	default:
		return fmt.Sprintf("unknown tool: %s", name), true
	}
}

// --- Tool implementations (HTTP delegation) ---

func (s *Server) toolSearchIndex(args map[string]interface{}) (string, bool) {
	body := map[string]interface{}{
		"workspace":     args["workspace"],
		"query":         args["query"],
		"maxResults":    getFloat(args, "maxResults", 5),
		"minScore":      0.3,
		"includeGlobal": getBool(args, "includeGlobal", true),
		"searchMode":    "hybrid",
	}
	return s.httpPost("/memories/search/index", body)
}

func (s *Server) toolGet(args map[string]interface{}) (string, bool) {
	body := map[string]interface{}{
		"ids": args["ids"],
	}
	return s.httpPost("/memories/batch", body)
}

func (s *Server) toolTimeline(args map[string]interface{}) (string, bool) {
	body := map[string]interface{}{
		"memoryId":      args["memoryId"],
		"workspace":     args["workspace"],
		"windowMinutes": getFloat(args, "windowMinutes", 30),
	}
	return s.httpPost("/memories/timeline", body)
}

func (s *Server) toolStore(args map[string]interface{}) (string, bool) {
	body := map[string]interface{}{
		"workspace":  args["workspace"],
		"content":    args["content"],
		"memoryType": args["memoryType"],
		"confidence": getFloat(args, "confidence", 0.8),
		"tags":       args["tags"],
		"source":     "mcp",
	}
	return s.httpPost("/memories", body)
}

func (s *Server) toolImpact(args map[string]interface{}) (string, bool) {
	memoryID, _ := args["memoryId"].(string)
	body := map[string]interface{}{
		"signal": args["signal"],
		"source": "mcp",
	}
	return s.httpPost(fmt.Sprintf("/memories/%s/impact", memoryID), body)
}

func (s *Server) toolSupersede(args map[string]interface{}) (string, bool) {
	oldID, _ := args["oldMemoryId"].(string)
	body := map[string]interface{}{
		"newMemoryId": args["newMemoryId"],
	}
	return s.httpPost(fmt.Sprintf("/memories/%s/supersede", oldID), body)
}

// --- HTTP helpers ---

func (s *Server) httpPost(path string, body interface{}) (string, bool) {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Sprintf("marshal error: %s", err), true
	}

	url := s.serverURL + path
	req, err := http.NewRequest("POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Sprintf("request error: %s", err), true
	}
	req.Header.Set("Content-Type", "application/json")
	if s.namespace != "" {
		req.Header.Set("X-Clive-Namespace", s.namespace)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Sprintf("HTTP error: %s", err), true
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Sprintf("read error: %s", err), true
	}

	if resp.StatusCode >= 400 {
		return string(respBody), true
	}

	return string(respBody), false
}

// --- Response helpers ---

func (s *Server) writeResponse(resp *Response) {
	data, _ := json.Marshal(resp)
	fmt.Fprintf(os.Stdout, "%s\n", data)
}

func (s *Server) writeError(id interface{}, code int, message string) {
	resp := &Response{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &RPCError{Code: code, Message: message},
	}
	s.writeResponse(resp)
}

func (s *Server) errorResponse(id interface{}, code int, message string) *Response {
	return &Response{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &RPCError{Code: code, Message: message},
	}
}

// --- Argument helpers ---

func getFloat(args map[string]interface{}, key string, fallback float64) float64 {
	if v, ok := args[key]; ok {
		switch val := v.(type) {
		case float64:
			return val
		case int:
			return float64(val)
		}
	}
	return fallback
}

func getBool(args map[string]interface{}, key string, fallback bool) bool {
	if v, ok := args[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return fallback
}
