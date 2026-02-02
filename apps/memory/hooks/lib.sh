#!/usr/bin/env bash
# Shared utilities for Claude Code memory hooks.

# Source env file if it exists (written by setup.sh or install.sh)
# Check plugin root first, then fallback to global location.
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/env" ]; then
  source "${CLAUDE_PLUGIN_ROOT}/env"
elif [ -f "${HOME}/.claude/memory/env" ]; then
  source "${HOME}/.claude/memory/env"
fi

MEMORY_SERVER="${CLIVE_MEMORY_URL:-http://localhost:8741}"
MEMORY_API_KEY="${CLIVE_MEMORY_API_KEY:-}"
CLIVE_NAMESPACE="${CLIVE_NAMESPACE:-}"
HOOK_TIMEOUT=5  # seconds

# Read stdin JSON once and cache it. Call early in each hook.
STDIN_JSON=""
read_stdin() {
  if [ -z "$STDIN_JSON" ] && [ -p /dev/stdin ]; then
    STDIN_JSON=$(cat)
  fi
}

# Get the current workspace path from stdin JSON or environment.
get_workspace() {
  local ws=""
  if [ -n "$STDIN_JSON" ]; then
    ws=$(echo "$STDIN_JSON" | jq -r '.cwd // empty' 2>/dev/null) || true
  fi
  if [ -z "$ws" ]; then
    ws="${CLAUDE_PROJECT_DIR:-$(pwd)}"
  fi
  echo "$ws"
}

# Get the session ID from stdin JSON or environment.
get_session_id() {
  local sid=""
  if [ -n "$STDIN_JSON" ]; then
    sid=$(echo "$STDIN_JSON" | jq -r '.session_id // empty' 2>/dev/null) || true
  fi
  if [ -z "$sid" ]; then
    sid="${CLAUDE_SESSION_ID:-unknown}"
  fi
  echo "$sid"
}

# Call the memory server API. Returns the response body.
# Usage: api_call METHOD PATH [JSON_BODY]
api_call() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local url="${MEMORY_SERVER}${path}"
  local args=(-s -S --max-time "$HOOK_TIMEOUT" -X "$method")

  # Add auth header if API key is set
  if [ -n "$MEMORY_API_KEY" ]; then
    args+=(-H "Authorization: Bearer ${MEMORY_API_KEY}")
  fi

  # Add namespace header if set
  if [ -n "$CLIVE_NAMESPACE" ]; then
    args+=(-H "X-Clive-Namespace: ${CLIVE_NAMESPACE}")
  fi

  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi

  curl "${args[@]}" "$url" 2>/dev/null
}

# Check if the memory server is healthy.
is_server_healthy() {
  local resp
  resp=$(api_call GET /health 2>/dev/null) || return 1
  echo "$resp" | jq -e '.status == "ok" or .status == "degraded"' >/dev/null 2>&1
}

# Format memories as XML for hook injection.
# SKILL_HINT memories are formatted as <skill-hint> tags; all others as <memory> tags.
format_memories_xml() {
  local json_results="$1"

  # Check if we have any results
  local count
  count=$(echo "$json_results" | jq -r '.results | length' 2>/dev/null) || return 0
  if [ "$count" = "0" ] || [ -z "$count" ]; then
    return 0
  fi

  local xml="<recalled-memories>"
  while IFS= read -r line; do
    local mtype content score tags
    mtype=$(echo "$line" | jq -r '.memoryType')
    content=$(echo "$line" | jq -r '.content')
    score=$(echo "$line" | jq -r '.score')

    local mid impact
    mid=$(echo "$line" | jq -r '.id // empty')
    impact=$(echo "$line" | jq -r '.impactScore // 0')

    if [ "$mtype" = "SKILL_HINT" ]; then
      # Extract skill name from tags (skill:{name}) or content prefix ([Skill: {name}])
      local skill_name=""
      skill_name=$(echo "$line" | jq -r '.tags[]? | select(startswith("skill:")) | sub("^skill:"; "")' 2>/dev/null | head -1)
      if [ -z "$skill_name" ]; then
        # Fallback: extract from content prefix [Skill: name]
        skill_name=$(echo "$content" | sed -n 's/^\[Skill: \([^]]*\)\].*/\1/p')
      fi
      # Strip the [Skill: name] prefix from content for cleaner display
      local desc
      desc=$(echo "$content" | sed 's/^\[Skill: [^]]*\] *//')
      xml+=$'\n'"  <skill-hint name=\"${skill_name}\" score=\"${score}\">${desc}</skill-hint>"
    else
      xml+=$'\n'"  <memory id=\"${mid}\" type=\"${mtype}\" score=\"${score}\" impact=\"${impact}\">${content}</memory>"
    fi
  done < <(echo "$json_results" | jq -c '.results[]')
  xml+=$'\n'"</recalled-memories>"

  echo "$xml"
}

# Output hook result with additional context.
hook_output() {
  local context="$1"
  if [ -z "$context" ]; then
    echo '{}'
  else
    jq -n --arg ctx "$context" '{
      "hookSpecificOutput": {
        "additionalContext": $ctx
      }
    }'
  fi
}

# Store a memory via the API. Silent on failure.
# Usage: store_memory WORKSPACE SESSION_ID MEMORY_TYPE CONTENT [CONFIDENCE] [SOURCE] [TAGS_CSV] [RELATED_FILES_JSON] [ENCODING_CONTEXT_JSON]
store_memory() {
  local workspace="$1"
  local session_id="$2"
  local memory_type="$3"
  local content="$4"
  local confidence="${5:-0.8}"
  local source="${6:-hook}"
  local tags_csv="${7:-auto}"
  local related_files_json="${8:-[]}"
  local encoding_context_json="${9:-}"

  # Convert CSV tags to JSON array
  local tags_json
  tags_json=$(echo "$tags_csv" | tr ',' '\n' | jq -R . | jq -s '.')

  local body
  if [ -n "$encoding_context_json" ]; then
    body=$(jq -n \
      --arg ws "$workspace" \
      --arg content "$content" \
      --arg mtype "$memory_type" \
      --arg conf "$confidence" \
      --arg src "$source" \
      --arg session "$session_id" \
      --argjson tags "$tags_json" \
      --argjson files "$related_files_json" \
      --argjson ctx "$encoding_context_json" \
      '{
        "workspace": $ws,
        "content": $content,
        "memoryType": $mtype,
        "tier": "short",
        "confidence": ($conf | tonumber),
        "tags": $tags,
        "source": $src,
        "sessionId": $session,
        "relatedFiles": $files,
        "encodingContext": $ctx
      }')
  else
    body=$(jq -n \
      --arg ws "$workspace" \
      --arg content "$content" \
      --arg mtype "$memory_type" \
      --arg conf "$confidence" \
      --arg src "$source" \
      --arg session "$session_id" \
      --argjson tags "$tags_json" \
      --argjson files "$related_files_json" \
      '{
        "workspace": $ws,
        "content": $content,
        "memoryType": $mtype,
        "tier": "short",
        "confidence": ($conf | tonumber),
        "tags": $tags,
        "source": $src,
        "sessionId": $session,
        "relatedFiles": $files
      }')
  fi

  api_call POST /memories "$body" 2>/dev/null
}

# Detect encoding context from the workspace.
# Returns JSON: {"fileTypes": [...], "frameworks": [...]}
detect_encoding_context() {
  local workspace="${1:-$(pwd)}"
  local file_types="[]"
  local frameworks="[]"

  # Detect file types from recent git changes
  if command -v git >/dev/null 2>&1 && [ -d "$workspace/.git" ]; then
    file_types=$(cd "$workspace" && git diff --name-only HEAD 2>/dev/null | sed -n 's/.*\(\.[^.]*\)$/\1/p' | sort -u | jq -R . | jq -s 'if length == 0 then [] else . end') || file_types="[]"
  fi

  # Detect frameworks from package.json
  if [ -f "$workspace/package.json" ]; then
    frameworks=$(jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys[]' "$workspace/package.json" 2>/dev/null \
      | grep -E '^(react|next|vue|angular|svelte|express|fastify|effect|@effect|tailwind|cypress|playwright|vitest|jest)' \
      | head -10 | jq -R . | jq -s '.') || frameworks="[]"
  fi

  # Detect frameworks from go.mod
  if [ -f "$workspace/go.mod" ]; then
    local go_frameworks
    go_frameworks=$(grep -E '^\t' "$workspace/go.mod" 2>/dev/null \
      | sed 's/^\t//' | awk '{print $1}' \
      | grep -oE '[^/]+$' \
      | head -10 | jq -R . | jq -s '.') || go_frameworks="[]"
    if [ "$frameworks" = "[]" ]; then
      frameworks="$go_frameworks"
    fi
  fi

  jq -n --argjson ft "$file_types" --argjson fw "$frameworks" \
    '{fileTypes: $ft, frameworks: $fw}'
}

# Store a tool observation via the API. Fire-and-forget, silent on failure.
# Usage: store_observation SESSION_ID TOOL_NAME INPUT OUTPUT [SUCCESS]
store_observation() {
  local session_id="$1"
  local tool_name="$2"
  local input="${3:-}"
  local output="${4:-}"
  local success="${5:-true}"

  local body
  body=$(jq -n \
    --arg tn "$tool_name" \
    --arg inp "$input" \
    --arg out "$output" \
    --argjson success "$success" \
    '{
      "toolName": $tn,
      "input": $inp,
      "output": $out,
      "success": $success
    }')

  api_call POST "/sessions/${session_id}/observations" "$body" >/dev/null 2>&1 || true
}

# Strip <private>...</private> tags from content.
# Belt-and-suspenders: server also strips, but this reduces data sent over the wire.
strip_private_tags() {
  local content="$1"
  echo "$content" | perl -0pe 's/<private>.*?<\/private>//gs' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# Silently fail - hooks should never block Claude Code.
safe_exit() {
  echo '{}'
  exit 0
}
