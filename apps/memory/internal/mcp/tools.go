package mcp

// ToolDefinitions returns the MCP tool definitions for the memory server.
func ToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		{
			Name: "memory_search_index",
			Description: "Search memories and return compact index results with ~80 char previews. " +
				"Use this first to find relevant memories without consuming many tokens. " +
				"Follow up with memory_get to retrieve full content for specific results.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"workspace": {Type: "string", Description: "Absolute path to the project workspace"},
					"query":     {Type: "string", Description: "Natural language search query"},
					"maxResults": {Type: "number", Description: "Maximum results to return (default 5)",
						Default: 5},
					"includeGlobal": {Type: "boolean", Description: "Include cross-project global memories",
						Default: true},
				},
				Required: []string{"workspace", "query"},
			},
		},
		{
			Name: "memory_get",
			Description: "Retrieve full content for specific memory IDs. " +
				"Use after memory_search_index to get complete details for memories you need. " +
				"Accepts multiple IDs for batch retrieval.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"ids": {Type: "array", Description: "Array of memory IDs to retrieve",
						Items: &Items{Type: "string"}},
				},
				Required: []string{"ids"},
			},
		},
		{
			Name: "memory_timeline",
			Description: "Get chronological context around a memory — what was stored before and after it. " +
				"Useful for understanding the sequence of events in a session.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"memoryId": {Type: "string", Description: "ID of the anchor memory"},
					"workspace": {Type: "string", Description: "Absolute path to the project workspace"},
					"windowMinutes": {Type: "number", Description: "Time window in minutes (default 30)",
						Default: 30},
				},
				Required: []string{"memoryId"},
			},
		},
		{
			Name: "memory_store",
			Description: "Store a new memory. Use for persisting decisions, gotchas, working solutions, " +
				"patterns, failures, or preferences discovered during this session.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"workspace":  {Type: "string", Description: "Absolute path to the project workspace"},
					"content":    {Type: "string", Description: "The memory content — write as a standalone sentence with WHY, not just WHAT"},
					"memoryType": {Type: "string", Description: "Type of memory",
						Enum: []string{"GOTCHA", "WORKING_SOLUTION", "DECISION", "PATTERN", "FAILURE", "PREFERENCE", "CONTEXT"}},
					"confidence": {Type: "number", Description: "Confidence level 0.0-1.0 (0.9+ proven, 0.7-0.8 confident, 0.5-0.6 uncertain)",
						Default: 0.8},
					"tags": {Type: "array", Description: "Descriptive tags for categorization",
						Items: &Items{Type: "string"}},
				},
				Required: []string{"workspace", "content", "memoryType"},
			},
		},
		{
			Name: "memory_impact",
			Description: "Signal that a memory was helpful, should be promoted to long-term, or was cited. " +
				"This reinforces the memory and may auto-promote it from short-term to permanent storage.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"memoryId": {Type: "string", Description: "ID of the memory to signal"},
					"signal": {Type: "string", Description: "Impact signal type",
						Enum: []string{"helpful", "promoted", "cited"}},
				},
				Required: []string{"memoryId", "signal"},
			},
		},
		{
			Name: "memory_supersede",
			Description: "Mark an old memory as replaced by a newer one. " +
				"The superseded memory is excluded from future search results. " +
				"Use when a previous decision, pattern, or gotcha has been corrected.",
			InputSchema: InputSchema{
				Type: "object",
				Properties: map[string]Property{
					"oldMemoryId": {Type: "string", Description: "ID of the memory being replaced"},
					"newMemoryId": {Type: "string", Description: "ID of the replacement memory"},
				},
				Required: []string{"oldMemoryId", "newMemoryId"},
			},
		},
	}
}
