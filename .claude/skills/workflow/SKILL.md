---
name: workflow
description: This skill should be used when the user asks to "create a workflow", "build an automation", "set up a trigger", "configure actions", "edit workflow", "modify workflow", "connect integrations", or mentions workflow automation, triggers, and actions.
---

# Workflow Skill

Create and manage Trigify workflows that automate actions when social media posts are found.

## Quick Start

### Using Templates (Recommended)

```bash
# List available templates
python3 scripts/workflow.py templates

# Create from template
python3 scripts/workflow.py create --name "Slack Alert" --search-id <search-id> \
  --template slack-notification --channel "#alerts" --message "New post found: {{ !ref($.trigger.outputs.text) }}"
```

### Available Templates

| Template | Description | Required Args |
|----------|-------------|---------------|
| `slack-notification` | Send post to Slack channel | `--channel`, `--message` |
| `webhook-forward` | Forward post to external URL | `--url`, `--method` (optional) |
| `sentiment-filter` | Route by sentiment to different channels | `--positive-channel`, `--negative-channel` |
| `lead-enrich` | Enrich author and add to CRM | `--crm` (hubspot\|salesforce\|attio) |
| `competitor-engagement` | Analyze post likers and notify | `--slack-channel` |

### From JSON

```bash
# Create from JSON file
cat workflow.json | python3 scripts/workflow.py create --name "Custom Workflow" --workflow-stdin

# Validate before creating
cat workflow.json | python3 scripts/workflow.py validate
```

## Script Commands

```bash
# List workflows
python3 scripts/workflow.py list [--limit N] [--status DRAFT|PUBLISHED]

# Get workflow details
python3 scripts/workflow.py get --id <workflow-id>

# Update workflow
python3 scripts/workflow.py update --id <id> [--name "Name"] [--enabled true|false]

# Delete workflow
python3 scripts/workflow.py delete --id <id>

# Dry run (preview without creating)
python3 scripts/workflow.py create --name "Test" --template slack-notification \
  --channel "#test" --message "test" --dry-run
```

## Workflow Structure

```json
{
  "trigger": {
    "kind": "workflows/new-post",
    "inputs": {}
  },
  "actions": [
    {
      "id": "unique_action_id",
      "kind": "slack_send_channel_message",
      "name": "Send Notification",
      "inputs": {
        "channel": "#alerts",
        "message": "{{ !ref($.trigger.outputs.text) }}"
      }
    }
  ],
  "edges": [
    { "from": "$trigger", "to": "unique_action_id" }
  ]
}
```

## Trigger Types

| Kind | Description |
|------|-------------|
| `workflows/new-post` | Fires when new post found from saved search |
| `workflows/multi-post-trigger` | Fires for posts from multiple searches |
| `workflows/signal-created` | Fires when signal created by another workflow |
| `workflows/scheduled-trigger` | Fires on schedule (daily/weekly/monthly) |
| `workflows/webhook` | Fires on external HTTP request |

### Trigger Outputs

All post triggers provide these outputs accessible via `{{ !ref($.trigger.outputs.X) }}`:

- `text` - Post content
- `authorUrl` - Author's profile URL
- `postUrl` - Direct link to post
- `source` - Platform (linkedin, twitter, reddit, youtube, podcast)
- `likes` - Like count
- `comments` - Comment count
- `datePosted` - ISO timestamp

## Variable Syntax

Reference data from triggers and previous actions:

```
{{ !ref($.trigger.outputs.text) }}           # Trigger data
{{ !ref($.action_id.output.result.field) }}  # Action output
```

### JsonLogic Conditions (for IF actions)

```json
{
  "condition": {
    "==": [
      {"var": "trigger.outputs.source"},
      "linkedin"
    ]
  }
}
```

## Action Quick Reference

### Messaging
- `slack_send_channel_message` - Send to Slack channel
- `slack_send_user_message` - Send DM to Slack user

### AI
- `get_sentiment` - Analyze text sentiment
- `generic_agent` - Custom AI prompt
- `copy_writer` - Generate copy

### Enrichment
- `person_enrichment` - Enrich person from LinkedIn URL
- `email_enrichment` - Find email for person
- `company_enrichment` - Enrich company data

### CRM
- `hubspot_create_contact` / `hubspot_update_contact`
- `salesforce_create_contact` / `salesforce_update_contact`
- `attio_create_contact`

### LinkedIn
- `linkedin_get_post_likes` - Get users who liked post
- `linkedin_get_post_comments` - Get comments on post

### Control Flow
- `builtin:if` - Conditional branching (needs 2 edges: True, False)
- `builtin:loop` - Iterate over collection (needs 2 edges: For Each Item, Completed)

### Integrations
- `http_request` - Make HTTP request
- `delay` - Wait for specified duration
- `signal` - Create a signal for workflow chaining

See [references/action-types.md](references/action-types.md) for full action details.

## Validation Rules

1. **IF nodes** - Must have exactly 2 outgoing edges (True/False)
2. **Loop nodes** - Must have exactly 2 outgoing edges (For Each Item/Completed)
3. **Action IDs** - Must be unique within workflow
4. **Edge references** - Must point to existing actions

## Common Patterns

### Conditional Routing

```json
{
  "actions": [
    { "id": "check", "kind": "builtin:if", "inputs": {
      "condition": { "==": [{"var": "trigger.outputs.source"}, "linkedin"] }
    }},
    { "id": "linkedin_action", "kind": "..." },
    { "id": "other_action", "kind": "..." }
  ],
  "edges": [
    { "from": "$trigger", "to": "check" },
    { "from": "check", "to": "linkedin_action", "name": "True" },
    { "from": "check", "to": "other_action", "name": "False" }
  ]
}
```

### Loop Over Collection

```json
{
  "actions": [
    { "id": "get_likes", "kind": "linkedin_get_post_likes", ... },
    { "id": "loop", "kind": "builtin:loop", "inputs": {
      "collection": "!ref($.get_likes.output.result.likes)"
    }},
    { "id": "process_item", "kind": "person_enrichment", "inputs": {
      "linkedinUrl": "{{ !ref($.loop.currentItem.profileUrl) }}"
    }},
    { "id": "done", "kind": "slack_send_channel_message", ... }
  ],
  "edges": [
    { "from": "$trigger", "to": "get_likes" },
    { "from": "get_likes", "to": "loop" },
    { "from": "loop", "to": "process_item", "name": "For Each Item" },
    { "from": "loop", "to": "done", "name": "Completed" }
  ]
}
```
