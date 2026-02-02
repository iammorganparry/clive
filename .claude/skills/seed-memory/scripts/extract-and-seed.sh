#!/usr/bin/env bash
# Extract learnings from Claude Code JSONL transcripts and seed them into the memory server.
# Usage: extract-and-seed.sh [projects-dir] [workspace-filter] [max-transcripts]
#   projects-dir:     Path to ~/.claude/projects/ (default: ~/.claude/projects)
#   workspace-filter: Only process project dirs matching this substring (optional)
#   max-transcripts:  Max transcripts per workspace (default: 200)
set -euo pipefail

MEMORY_URL="${CLIVE_MEMORY_URL:-http://localhost:8741}"
PROJECTS_DIR="${1:-$HOME/.claude/projects}"
FILTER="${2:-}"
MAX_TRANSCRIPTS="${3:-200}"
SCRATCHPAD="${TMPDIR:-/tmp}/seed-memory-$$"
mkdir -p "$SCRATCHPAD"

# Verify memory server
if ! curl -sf "$MEMORY_URL/health" >/dev/null 2>&1; then
  echo "ERROR: Memory server not reachable at $MEMORY_URL"
  echo "Start it with: cd apps/memory && docker compose up -d"
  exit 1
fi

echo "=== Seed Memory from Transcripts ==="
echo "Projects dir: $PROJECTS_DIR"
echo "Memory server: $MEMORY_URL"
echo "Max transcripts per workspace: $MAX_TRANSCRIPTS"
[ -n "$FILTER" ] && echo "Filter: $FILTER"
echo ""

TOTAL_STORED=0
TOTAL_DEDUPED=0
TOTAL_FAILED=0
TOTAL_TRANSCRIPTS=0
TOTAL_SKIPPED=0

# Iterate project directories
for project_dir in "$PROJECTS_DIR"/*/; do
  [ -d "$project_dir" ] || continue

  dir_name=$(basename "$project_dir")

  # Skip non-workspace dirs
  [[ "$dir_name" == "-" ]] && continue

  # Apply filter if set
  if [ -n "$FILTER" ] && [[ "$dir_name" != *"$FILTER"* ]]; then
    continue
  fi

  # Derive workspace path: -Users-foo-repos-bar -> /Users/foo/repos/bar
  workspace_path=$(echo "$dir_name" | sed 's/^-/\//' | sed 's/-/\//g')

  # Find JSONL files, sort by modification time (newest first)
  jsonl_files=$(find "$project_dir" -name '*.jsonl' -type f -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null \
    | head -"$MAX_TRANSCRIPTS") || continue

  [ -z "$jsonl_files" ] && continue

  echo "--- Workspace: $workspace_path ---"
  file_count=$(echo "$jsonl_files" | wc -l | tr -d ' ')
  echo "  Processing $file_count transcripts..."

  ws_stored=0
  ws_deduped=0

  for jsonl_file in $jsonl_files; do
    TOTAL_TRANSCRIPTS=$((TOTAL_TRANSCRIPTS + 1))

    # Skip small files (< 500 bytes are likely empty/trivial)
    file_size=$(stat -f%z "$jsonl_file" 2>/dev/null || stat -c%s "$jsonl_file" 2>/dev/null || echo 0)
    if [ "$file_size" -lt 500 ]; then
      TOTAL_SKIPPED=$((TOTAL_SKIPPED + 1))
      continue
    fi

    # Extract learnings using broader pattern matching
    python3 -c "
import json, re, sys, hashlib

# Parse JSONL into text blocks, keeping assistant content (the learnings source)
texts = []
total_chars = 0
max_chars = 16000  # Process more of each transcript

try:
    with open('$jsonl_file') as f:
        for line in f:
            try:
                obj = json.loads(line)
            except:
                continue
            if obj.get('type') not in ('assistant', 'user'):
                continue
            role = obj['type']
            msg = obj.get('message', {})
            content = msg.get('content', [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'text':
                        t = block['text']
                        texts.append((role, t))
                        total_chars += len(t)
            elif isinstance(content, str):
                texts.append((role, content))
                total_chars += len(content)
            if total_chars > max_chars:
                break
except:
    sys.exit(0)

if total_chars < 200:
    sys.exit(0)

# Join all text for pattern matching
full_text = '\n'.join(t for _, t in texts)
# Also get assistant-only text for solution extraction
assistant_text = '\n'.join(t for r, t in texts if r == 'assistant')

learnings = []

def add(content, mem_type, confidence):
    content = content.strip()
    # Clean up content: remove markdown artifacts, normalize whitespace
    content = re.sub(r'\n{3,}', '\n\n', content)
    content = re.sub(r'^\s*#+\s*', '', content)
    if 30 < len(content) < 500:
        learnings.append({'content': content, 'type': mem_type, 'confidence': confidence})

# ── DECISIONS (architectural choices, technology picks, design choices) ──
decision_pats = [
    r'(?:decided|chose|choosing|selected|went with|switched to|opting for|picked|adopting|prefer(?:red)?)\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:better (?:approach|option|choice|solution) (?:is|was|would be))\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:we(?:\'ll| will| should) (?:use|go with|stick with|implement))\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:instead of .{5,80}, (?:we|I) (?:should|will|can))\s+(.{20,200}?)(?:\.\s|\n|$)',
    r'(?:the (?:right|correct|proper|best) (?:way|approach|pattern|method) (?:is|to))\s+(.{20,300}?)(?:\.\s|\n|$)',
]
for pat in decision_pats:
    for m in re.finditer(pat, full_text, re.IGNORECASE):
        add(m.group(0), 'DECISION', 0.75)

# ── GOTCHAS (bugs, edge cases, warnings, surprising behavior) ──
gotcha_pats = [
    r'(?:gotcha|careful|warning|watch out|be aware|note that|important:?|caveat)\s*:?\s*(.{20,400}?)(?:\.\s|\n|$)',
    r'(?:doesn.t work|won.t work|breaks|broken|bug|issue)\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:the (?:problem|issue|catch|trick|trap|pitfall) (?:is|was|here))\s*:?\s*(.{20,400}?)(?:\.\s|\n|$)',
    r'(?:(?:this|that|it) (?:silently|quietly|unexpectedly|actually))\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:turns out|it turns out|apparently)\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:must|need to|have to|requires?|necessary to)\s+(.{10,200}?)\s+(?:or (?:else|otherwise|it will)|before|first)(.{5,200}?)(?:\.\s|\n|$)',
    r'(?:forgot|missing|omitted|overlooked)\s+(.{15,200}?)(?:\.\s|\n|$)',
    r'(?:(?:only|specifically) works (?:with|when|if))\s+(.{15,300}?)(?:\.\s|\n|$)',
    r'(?:make sure|ensure|verify|confirm|check that)\s+(.{15,300}?)(?:\.\s|\n|$)',
    r'(?:without .{5,50}, (?:it|this|the))\s+(.{15,200}?)(?:\.\s|\n|$)',
]
for pat in gotcha_pats:
    for m in re.finditer(pat, full_text, re.IGNORECASE):
        add(m.group(0), 'GOTCHA', 0.8)

# ── WORKING SOLUTIONS (fixes, proven approaches, things that work) ──
solution_pats = [
    r'(?:fixed by|solved by|the fix|solution|resolved by|works by|the answer)\s*:?\s*(.{20,400}?)(?:\.\s|\n|$)',
    r'(?:(?:this|that|it) (?:fixes|solves|resolves|addresses|handles))\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:(?:the|a) (?:fix|solution|workaround|answer) (?:is|was|involves?))\s*:?\s*(.{20,400}?)(?:\.\s|\n|$)',
    r'(?:to (?:fix|solve|resolve|work around) (?:this|that|the|it),?\s*)\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:(?:you|we) (?:can|need to|should|must) (?:add|use|set|pass|include|enable|configure))\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:(?:adding|using|setting|passing|including|enabling|configuring)\s+.{5,80}\s+(?:fixes|solves|resolves|works))',
    r'(?:the (?:key|trick|secret) (?:is|was) (?:to)?)\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:(?:this|it) works? because)\s+(.{20,300}?)(?:\.\s|\n|$)',
]
for pat in solution_pats:
    for m in re.finditer(pat, assistant_text, re.IGNORECASE):
        add(m.group(0), 'WORKING_SOLUTION', 0.85)

# ── FAILURES (approaches that didn't work) ──
failure_pats = [
    r'(?:this (?:approach|method|solution|strategy) (?:failed|didn.t work|doesn.t work))\s*[,:]?\s*(.{10,300}?)(?:\.\s|\n|$)',
    r'(?:(?:tried|attempted) .{5,100} but (?:it |that |this )?(?:failed|didn.t work|broke|caused))\s*(.{0,200}?)(?:\.\s|\n|$)',
    r'(?:mistake was|the error was|wrong because)\s*:?\s*(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:(?:that|this|it) (?:caused|leads? to|results? in|introduces?))\s+(.{10,200}?(?:error|bug|crash|failure|problem|issue))(.{0,100}?)(?:\.\s|\n|$)',
    r'(?:(?:don.t|do not|never|avoid)\s+(?:use|do|try|call|import|add))\s+(.{15,200}?)(?:\.\s|\n|$)',
]
for pat in failure_pats:
    for m in re.finditer(pat, full_text, re.IGNORECASE):
        add(m.group(0), 'FAILURE', 0.8)

# ── PATTERNS (recurring code patterns, conventions, architecture) ──
pattern_pats = [
    r'(?:the (?:pattern|convention|idiom|standard|norm|practice) (?:is|here is|for|to))\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:always|consistently|by convention|(?:the|this) codebase (?:uses|follows|prefers))\s+(.{20,300}?)(?:\.\s|\n|$)',
    r'(?:(?:files?|components?|modules?|services?) (?:are|should be) (?:named|organized|structured|placed))\s+(.{20,300}?)(?:\.\s|\n|$)',
]
for pat in pattern_pats:
    for m in re.finditer(pat, assistant_text, re.IGNORECASE):
        add(m.group(0), 'PATTERN', 0.75)

# ── PREFERENCES (user-stated preferences) ──
preference_pats = [
    r'(?:I (?:prefer|like|want|always use|usually|tend to))\s+(.{15,200}?)(?:\.\s|\n|$)',
    r'(?:(?:please|always|never|don.t) (?:use|do|add|include|format|write))\s+(.{15,200}?)(?:\.\s|\n|$)',
]
for pat in preference_pats:
    for m in re.finditer(pat, full_text, re.IGNORECASE):
        # Only capture from user messages for preferences
        add(m.group(0), 'PREFERENCE', 0.7)

# Deduplicate by content hash
seen = set()
unique = []
for l in learnings:
    h = hashlib.sha256(l['content'].encode()).hexdigest()[:16]
    if h not in seen:
        seen.add(h)
        unique.append(l)

# Cap at 30 learnings per transcript (up from 20)
json.dump(unique[:30], sys.stdout)
" 2>/dev/null > "$SCRATCHPAD/learnings.json" || continue

    # Read learnings and POST to memory server
    count=$(python3 -c "import json; print(len(json.load(open('$SCRATCHPAD/learnings.json'))))" 2>/dev/null) || continue
    if [ "$count" -eq 0 ]; then
      continue
    fi

    # Build bulk request
    python3 -c "
import json, sys

workspace = '$workspace_path'
session = '$(basename "$jsonl_file" .jsonl)'

with open('$SCRATCHPAD/learnings.json') as f:
    learnings = json.load(f)

memories = []
for l in learnings:
    memories.append({
        'content': l['content'],
        'memoryType': l['type'],
        'confidence': l['confidence'],
        'tags': ['auto-extracted', 'transcript'],
        'source': 'seed-memory',
    })

req = {
    'workspace': workspace,
    'sessionId': session,
    'memories': memories,
}
json.dump(req, sys.stdout)
" 2>/dev/null > "$SCRATCHPAD/bulk-request.json" || continue

    # POST bulk
    response=$(curl -s -X POST "$MEMORY_URL/memories/bulk" \
      -H 'Content-Type: application/json' \
      -d @"$SCRATCHPAD/bulk-request.json" 2>/dev/null) || continue

    stored=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('stored',0))" 2>/dev/null) || stored=0
    deduped=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('deduplicated',0))" 2>/dev/null) || deduped=0
    failed=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('failed',0))" 2>/dev/null) || failed=0

    TOTAL_STORED=$((TOTAL_STORED + stored))
    TOTAL_DEDUPED=$((TOTAL_DEDUPED + deduped))
    TOTAL_FAILED=$((TOTAL_FAILED + failed))

    ws_stored=$((ws_stored + stored))
    ws_deduped=$((ws_deduped + deduped))

    [ "$stored" -gt 0 ] && echo "    $(basename "$jsonl_file"): +${stored} stored, ${deduped} deduped"
  done

  echo "  Workspace totals: +${ws_stored} stored, ${ws_deduped} deduped"
  echo ""
done

# Cleanup
rm -rf "$SCRATCHPAD"

echo "=== Summary ==="
echo "Transcripts processed: $TOTAL_TRANSCRIPTS"
echo "Transcripts skipped:   $TOTAL_SKIPPED (too small)"
echo "Memories stored:       $TOTAL_STORED"
echo "Deduplicated:          $TOTAL_DEDUPED"
echo "Failed:                $TOTAL_FAILED"

# Return stats for Claude to report
echo ""
echo "SEED_RESULT: stored=$TOTAL_STORED deduped=$TOTAL_DEDUPED failed=$TOTAL_FAILED transcripts=$TOTAL_TRANSCRIPTS"
