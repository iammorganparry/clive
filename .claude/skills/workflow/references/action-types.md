# Workflow Action Types Reference

Complete reference for all available workflow actions.

## Messaging Actions

### slack_send_channel_message
Send a message to a Slack channel.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| channel | string | Yes | Slack channel ID or name |
| message | string | Yes | Message content (supports variables) |

**Outputs:** `result.success`, `result.messageId`, `result.channel`

### slack_send_user_message
Send a direct message to a Slack user.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user | string | Yes | Slack user ID |
| message | string | Yes | Message content |

**Outputs:** `result.success`, `result.messageId`

---

## AI Actions

### get_sentiment
Analyze sentiment of text.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| body | string | Yes | Text to analyze |
| outputFormat | enum | Yes | `text`, `number`, or `boolean` |

**Outputs:** `result.sentiment` (positive/negative/neutral, -1 to 1, or true/false)

### generic_agent
Custom AI prompt execution.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | Yes | AI prompt |
| context | string | No | Additional context |

**Outputs:** `result.response`

### copy_writer
Generate marketing copy.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| topic | string | Yes | Topic to write about |
| tone | string | No | Writing tone |
| length | string | No | short/medium/long |

**Outputs:** `result.copy`

---

## Enrichment Actions

### person_enrichment
Enrich person data from LinkedIn URL.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| linkedinUrl | string | Yes | LinkedIn profile URL |

**Outputs:** `result.firstName`, `result.lastName`, `result.email`, `result.company`, `result.jobTitle`

### email_enrichment
Find email address for a person.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| firstName | string | Yes | First name |
| lastName | string | Yes | Last name |
| company | string | Yes | Company name |

**Outputs:** `result.email`, `result.confidence`

### company_enrichment
Enrich company data.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| domain | string | Yes | Company domain |

**Outputs:** `result.name`, `result.industry`, `result.size`, `result.location`

---

## CRM Actions

### HubSpot

**hubspot_create_contact**
| Field | Type | Required |
|-------|------|----------|
| firstName | string | No |
| lastName | string | No |
| email | string | Yes |
| linkedinUrl | string | No |

**hubspot_update_contact**
| Field | Type | Required |
|-------|------|----------|
| contactId | string | Yes |
| firstName | string | No |
| lastName | string | No |
| email | string | No |

**hubspot_get_contact**
| Field | Type | Required |
|-------|------|----------|
| contactId | string | Yes |

### Salesforce

**salesforce_create_contact** / **salesforce_update_contact** / **salesforce_get_contact**
Same structure as HubSpot equivalents.

### Attio

**attio_create_contact** / **attio_get_contact**
Same structure as HubSpot equivalents.

---

## LinkedIn Actions

### linkedin_get_post_likes
Get users who liked a post.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| postUrl | string | Yes | LinkedIn post URL |
| limit | number | No | Max results (default 50) |

**Outputs:** `result.likes[]` with `profileUrl`, `name`, `headline`

### linkedin_get_post_comments
Get comments on a post.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| postUrl | string | Yes | LinkedIn post URL |
| limit | number | No | Max results (default 50) |

**Outputs:** `result.comments[]` with `text`, `authorUrl`, `authorName`

---

## Control Flow Actions

### builtin:if
Conditional branching based on JsonLogic condition.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| condition | object | Yes | JsonLogic condition |

**Edge Requirements:** Exactly 2 outgoing edges named "True" and "False"

**Example Condition:**
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

**Operators:** `==`, `!=`, `>`, `<`, `>=`, `<=`, `and`, `or`, `in`, `icontains`

### builtin:loop
Iterate over a collection.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| collection | string | Yes | Reference to array (e.g., `!ref($.action_id.output.items)`) |

**Edge Requirements:** Exactly 2 outgoing edges:
- "For Each Item" - connects to actions that process each item
- "Completed" - connects to actions that run after loop finishes

**Loop Variables:**
- `$.loop_id.currentItem` - Current item being processed
- `$.loop_id.output.totalItems` - Total items in collection
- `$.loop_id.output.processedCount` - Items processed so far

---

## Integration Actions

### http_request
Make HTTP requests to external APIs.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| method | enum | Yes | GET, POST, PUT, DELETE, PATCH |
| url | string | Yes | Request URL |
| headers | array | No | Key-value pairs for headers |
| queryParams | array | No | Query parameters |
| body | string | No | Request body (JSON) |

**Outputs:** `result.body`, `result.status`, `result.headers`

### delay
Pause workflow execution.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| duration | number | Yes | Duration in seconds |

### signal
Create a signal for workflow chaining.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Signal name |
| description | string | No | Signal description |
| severity | enum | No | LOW, MEDIUM, HIGH, CRITICAL |
| category | enum | No | SALES, MARKETING, SUPPORT, etc. |

---

## Database Actions

### save_to_db
Save data to the database.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| data | object | Yes | Data to save |

### fetch_search_results
Fetch results from a saved search.

**Inputs:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| searchId | string | Yes | Saved search ID |
| limit | number | No | Max results |

**Outputs:** `result.posts[]`

---

## Outreach Actions

### instantly_export
Export contact to Instantly campaign.

### heyreach_export
Export contact to HeyReach campaign.

### smartleads_export
Export contact to SmartLeads campaign.

### lagrowth_machine_export
Export contact to LaGrowthMachine campaign.
