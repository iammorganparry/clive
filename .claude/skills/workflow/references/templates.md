# Workflow Templates Reference

Detailed examples of each workflow template.

## slack-notification

Simple workflow that sends posts to a Slack channel.

**Command:**
```bash
python3 scripts/workflow.py create \
  --name "LinkedIn Alerts" \
  --search-id abc123 \
  --template slack-notification \
  --channel "#sales-alerts" \
  --message "New LinkedIn post from {{ !ref($.trigger.outputs.authorUrl) }}:\n\n{{ !ref($.trigger.outputs.text) }}\n\nLink: {{ !ref($.trigger.outputs.postUrl) }}"
```

**Generated Workflow:**
```
Trigger (new-post) → Slack Send Channel Message
```

**Use Cases:**
- Real-time notifications when keywords are mentioned
- Team alerts for competitor mentions
- Sales team notifications for prospect activity

---

## webhook-forward

Forward post data to an external webhook.

**Command:**
```bash
python3 scripts/workflow.py create \
  --name "Forward to CRM" \
  --search-id abc123 \
  --template webhook-forward \
  --url "https://api.example.com/webhook/trigify" \
  --method POST
```

**Generated Workflow:**
```
Trigger (new-post) → HTTP Request (POST to URL)
```

**Payload Sent:**
```json
{
  "text": "Post content...",
  "authorUrl": "https://linkedin.com/in/user",
  "postUrl": "https://linkedin.com/posts/...",
  "source": "linkedin"
}
```

**Use Cases:**
- Integration with custom systems
- Zapier/Make.com webhooks
- Data warehouse ingestion
- Custom CRM updates

---

## sentiment-filter

Route posts to different Slack channels based on sentiment analysis.

**Command:**
```bash
python3 scripts/workflow.py create \
  --name "Sentiment Router" \
  --search-id abc123 \
  --template sentiment-filter \
  --positive-channel "#wins" \
  --negative-channel "#needs-attention"
```

**Generated Workflow:**
```
Trigger → Sentiment Analysis → IF (positive?)
                                  ├─ True → Slack (#wins)
                                  └─ False → Slack (#needs-attention)
```

**Use Cases:**
- Customer feedback monitoring
- Brand sentiment tracking
- PR crisis detection
- Customer success alerts

---

## lead-enrich

Enrich post authors with person data and add to CRM.

**Command:**
```bash
python3 scripts/workflow.py create \
  --name "Lead Capture" \
  --search-id abc123 \
  --template lead-enrich \
  --crm hubspot
```

**Supported CRMs:** hubspot, salesforce, attio

**Generated Workflow:**
```
Trigger → Person Enrichment → CRM Create Contact
```

**Data Flow:**
1. Post found with `authorUrl`
2. Person enrichment returns: firstName, lastName, email, company, jobTitle
3. Contact created in CRM with enriched data

**Use Cases:**
- Automatic lead capture from LinkedIn
- Competitor post author tracking
- Industry influencer database building

---

## competitor-engagement

Analyze who engages with competitor posts and notify team.

**Command:**
```bash
python3 scripts/workflow.py create \
  --name "Competitor Analysis" \
  --search-id abc123 \
  --template competitor-engagement \
  --slack-channel "#competitive-intel"
```

**Generated Workflow:**
```
Trigger → Get Post Likes → Loop (for each liker)
                            ├─ For Each Item → Person Enrichment
                            └─ Completed → Slack Summary
```

**Output:**
- Each person who liked the post gets enriched
- Summary sent to Slack with total count
- Enriched data available for further processing

**Use Cases:**
- Identify prospects engaging with competitors
- Build targeted outreach lists
- Competitive intelligence gathering

---

## Creating Custom Workflows

For workflows beyond templates, use JSON input:

```bash
cat <<EOF | python3 scripts/workflow.py create --name "Custom" --workflow-stdin
{
  "trigger": {
    "kind": "workflows/new-post",
    "inputs": {}
  },
  "actions": [
    {
      "id": "enrich",
      "kind": "person_enrichment",
      "name": "Enrich Author",
      "inputs": {
        "linkedinUrl": "{{ !ref($.trigger.outputs.authorUrl) }}"
      }
    },
    {
      "id": "check",
      "kind": "builtin:if",
      "name": "Is Manager+?",
      "inputs": {
        "condition": {
          "or": [
            {"icontains": ["manager", {"var": "enrich.output.result.jobTitle"}]},
            {"icontains": ["director", {"var": "enrich.output.result.jobTitle"}]},
            {"icontains": ["vp", {"var": "enrich.output.result.jobTitle"}]},
            {"icontains": ["chief", {"var": "enrich.output.result.jobTitle"}]}
          ]
        }
      }
    },
    {
      "id": "notify",
      "kind": "slack_send_channel_message",
      "name": "Notify Team",
      "inputs": {
        "channel": "#high-value-leads",
        "message": "High-value lead found!\n\nName: {{ !ref($.enrich.output.result.firstName) }} {{ !ref($.enrich.output.result.lastName) }}\nTitle: {{ !ref($.enrich.output.result.jobTitle) }}\nCompany: {{ !ref($.enrich.output.result.company) }}\n\nPost: {{ !ref($.trigger.outputs.postUrl) }}"
      }
    },
    {
      "id": "log",
      "kind": "save_to_db",
      "name": "Log Lead",
      "inputs": {}
    }
  ],
  "edges": [
    {"from": "$trigger", "to": "enrich"},
    {"from": "enrich", "to": "check"},
    {"from": "check", "to": "notify", "name": "True"},
    {"from": "check", "to": "log", "name": "False"}
  ]
}
EOF
```

---

## Template Variables Reference

All templates can use these variables in messages:

| Variable | Description |
|----------|-------------|
| `{{ !ref($.trigger.outputs.text) }}` | Post content |
| `{{ !ref($.trigger.outputs.authorUrl) }}` | Author profile URL |
| `{{ !ref($.trigger.outputs.postUrl) }}` | Direct post link |
| `{{ !ref($.trigger.outputs.source) }}` | Platform name |
| `{{ !ref($.trigger.outputs.likes) }}` | Like count |
| `{{ !ref($.trigger.outputs.comments) }}` | Comment count |
| `{{ !ref($.trigger.outputs.datePosted) }}` | Publish date |
