#!/usr/bin/env python3
"""
Workflow management script for Trigify workflows.

Provides template-based workflow creation and wraps trigify-cli commands
with validation and helpful error messages.

Usage:
    workflow.py create --name "Name" --search-id <id> --template <type> [template-args]
    workflow.py create --name "Name" --search-id <id> --workflow-stdin < workflow.json
    workflow.py list [--limit N] [--status DRAFT|PUBLISHED]
    workflow.py get --id <workflow-id>
    workflow.py update --id <id> [--name "Name"] [--enabled true|false]
    workflow.py delete --id <id>
    workflow.py validate --workflow-stdin < workflow.json
    workflow.py templates  # List available templates
"""

import argparse
import json
import subprocess
import sys
import uuid
from typing import Any, Optional


def generate_action_id() -> str:
    """Generate a unique action ID."""
    return str(uuid.uuid4())[:8]


# =============================================================================
# WORKFLOW TEMPLATES
# =============================================================================

def template_slack_notification(channel: str, message: str) -> dict:
    """
    Simple Slack notification workflow.
    Trigger -> Slack Channel Message
    """
    action_id = f"slack_{generate_action_id()}"
    return {
        "trigger": {
            "kind": "workflows/new-post",
            "inputs": {}
        },
        "actions": [
            {
                "id": action_id,
                "kind": "slack_send_channel_message",
                "name": "Send Slack Notification",
                "inputs": {
                    "channel": channel,
                    "message": message
                }
            }
        ],
        "edges": [
            {
                "from": "$trigger",
                "to": action_id
            }
        ]
    }


def template_webhook_forward(url: str, method: str = "POST") -> dict:
    """
    Forward posts to external webhook.
    Trigger -> HTTP Request
    """
    action_id = f"http_{generate_action_id()}"
    return {
        "trigger": {
            "kind": "workflows/new-post",
            "inputs": {}
        },
        "actions": [
            {
                "id": action_id,
                "kind": "http_request",
                "name": "Forward to Webhook",
                "inputs": {
                    "method": method,
                    "url": url,
                    "body": json.dumps({
                        "text": "{{ !ref($.trigger.outputs.text) }}",
                        "authorUrl": "{{ !ref($.trigger.outputs.authorUrl) }}",
                        "postUrl": "{{ !ref($.trigger.outputs.postUrl) }}",
                        "source": "{{ !ref($.trigger.outputs.source) }}"
                    })
                }
            }
        ],
        "edges": [
            {
                "from": "$trigger",
                "to": action_id
            }
        ]
    }


def template_sentiment_filter(positive_channel: str, negative_channel: str) -> dict:
    """
    Route posts by sentiment to different Slack channels.
    Trigger -> Sentiment -> IF -> Slack (positive) / Slack (negative)
    """
    sentiment_id = f"sentiment_{generate_action_id()}"
    if_id = f"if_{generate_action_id()}"
    positive_slack_id = f"slack_pos_{generate_action_id()}"
    negative_slack_id = f"slack_neg_{generate_action_id()}"

    return {
        "trigger": {
            "kind": "workflows/new-post",
            "inputs": {}
        },
        "actions": [
            {
                "id": sentiment_id,
                "kind": "get_sentiment",
                "name": "Analyze Sentiment",
                "inputs": {
                    "body": "{{ !ref($.trigger.outputs.text) }}",
                    "outputFormat": "text"
                }
            },
            {
                "id": if_id,
                "kind": "builtin:if",
                "name": "Check Sentiment",
                "inputs": {
                    "condition": {
                        "==": [
                            {"var": f"{sentiment_id}.output.result.sentiment"},
                            "positive"
                        ]
                    }
                }
            },
            {
                "id": positive_slack_id,
                "kind": "slack_send_channel_message",
                "name": "Send to Positive Channel",
                "inputs": {
                    "channel": positive_channel,
                    "message": "Positive post found!\n\n{{ !ref($.trigger.outputs.text) }}\n\nLink: {{ !ref($.trigger.outputs.postUrl) }}"
                }
            },
            {
                "id": negative_slack_id,
                "kind": "slack_send_channel_message",
                "name": "Send to Negative Channel",
                "inputs": {
                    "channel": negative_channel,
                    "message": "Negative post needs review:\n\n{{ !ref($.trigger.outputs.text) }}\n\nLink: {{ !ref($.trigger.outputs.postUrl) }}"
                }
            }
        ],
        "edges": [
            {
                "from": "$trigger",
                "to": sentiment_id
            },
            {
                "from": sentiment_id,
                "to": if_id
            },
            {
                "from": if_id,
                "to": positive_slack_id,
                "name": "True"
            },
            {
                "from": if_id,
                "to": negative_slack_id,
                "name": "False"
            }
        ]
    }


def template_lead_enrich(crm: str) -> dict:
    """
    Enrich post authors and add to CRM.
    Trigger -> Person Enrichment -> CRM Contact
    """
    enrich_id = f"enrich_{generate_action_id()}"
    crm_id = f"crm_{generate_action_id()}"

    # Map CRM name to action kind
    crm_actions = {
        "hubspot": "hubspot_create_contact",
        "salesforce": "salesforce_create_contact",
        "attio": "attio_create_contact"
    }

    crm_kind = crm_actions.get(crm.lower())
    if not crm_kind:
        raise ValueError(f"Unsupported CRM: {crm}. Supported: hubspot, salesforce, attio")

    return {
        "trigger": {
            "kind": "workflows/new-post",
            "inputs": {}
        },
        "actions": [
            {
                "id": enrich_id,
                "kind": "person_enrichment",
                "name": "Enrich Person",
                "inputs": {
                    "linkedinUrl": "{{ !ref($.trigger.outputs.authorUrl) }}"
                }
            },
            {
                "id": crm_id,
                "kind": crm_kind,
                "name": f"Add to {crm.capitalize()}",
                "inputs": {
                    "firstName": f"{{{{ !ref($.{enrich_id}.output.result.firstName) }}}}",
                    "lastName": f"{{{{ !ref($.{enrich_id}.output.result.lastName) }}}}",
                    "email": f"{{{{ !ref($.{enrich_id}.output.result.email) }}}}",
                    "linkedinUrl": "{{ !ref($.trigger.outputs.authorUrl) }}"
                }
            }
        ],
        "edges": [
            {
                "from": "$trigger",
                "to": enrich_id
            },
            {
                "from": enrich_id,
                "to": crm_id
            }
        ]
    }


def template_competitor_engagement(slack_channel: str) -> dict:
    """
    Analyze engagement on competitor posts.
    Trigger -> Get Likes -> Loop -> Person Enrichment -> Slack Summary
    """
    get_likes_id = f"likes_{generate_action_id()}"
    loop_id = f"loop_{generate_action_id()}"
    enrich_id = f"enrich_{generate_action_id()}"
    slack_id = f"slack_{generate_action_id()}"

    return {
        "trigger": {
            "kind": "workflows/new-post",
            "inputs": {}
        },
        "actions": [
            {
                "id": get_likes_id,
                "kind": "linkedin_get_post_likes",
                "name": "Get Post Likes",
                "inputs": {
                    "postUrl": "{{ !ref($.trigger.outputs.postUrl) }}",
                    "limit": 50
                }
            },
            {
                "id": loop_id,
                "kind": "builtin:loop",
                "name": "Loop Through Likers",
                "inputs": {
                    "collection": f"!ref($.{get_likes_id}.output.result.likes)"
                }
            },
            {
                "id": enrich_id,
                "kind": "person_enrichment",
                "name": "Enrich Liker",
                "inputs": {
                    "linkedinUrl": f"{{{{ !ref($.{loop_id}.currentItem.profileUrl) }}}}"
                }
            },
            {
                "id": slack_id,
                "kind": "slack_send_channel_message",
                "name": "Send Summary",
                "inputs": {
                    "channel": slack_channel,
                    "message": f"Competitor engagement analysis complete.\n\nPost: {{{{ !ref($.trigger.outputs.postUrl) }}}}\nTotal likers analyzed: {{{{ !ref($.{loop_id}.output.totalItems) }}}}"
                }
            }
        ],
        "edges": [
            {
                "from": "$trigger",
                "to": get_likes_id
            },
            {
                "from": get_likes_id,
                "to": loop_id
            },
            {
                "from": loop_id,
                "to": enrich_id,
                "name": "For Each Item"
            },
            {
                "from": loop_id,
                "to": slack_id,
                "name": "Completed"
            }
        ]
    }


TEMPLATES = {
    "slack-notification": {
        "description": "Simple notification to Slack channel",
        "args": ["--channel", "--message"],
        "func": template_slack_notification
    },
    "webhook-forward": {
        "description": "Forward posts to external webhook",
        "args": ["--url", "--method (optional, default POST)"],
        "func": template_webhook_forward
    },
    "sentiment-filter": {
        "description": "Route posts by sentiment to different channels",
        "args": ["--positive-channel", "--negative-channel"],
        "func": template_sentiment_filter
    },
    "lead-enrich": {
        "description": "Enrich post authors and add to CRM",
        "args": ["--crm (hubspot|salesforce|attio)"],
        "func": template_lead_enrich
    },
    "competitor-engagement": {
        "description": "Analyze engagement on competitor posts",
        "args": ["--slack-channel"],
        "func": template_competitor_engagement
    }
}


# =============================================================================
# VALIDATION
# =============================================================================

def validate_workflow(workflow: dict) -> tuple[bool, list[str]]:
    """
    Validate workflow structure.
    Returns (is_valid, list of errors)
    """
    errors = []

    # Check required fields
    if "trigger" not in workflow:
        errors.append("Missing 'trigger' field")
    if "actions" not in workflow:
        errors.append("Missing 'actions' field")
    if "edges" not in workflow:
        errors.append("Missing 'edges' field")

    if errors:
        return False, errors

    # Check action IDs are unique
    action_ids = [a.get("id") for a in workflow.get("actions", [])]
    if len(action_ids) != len(set(action_ids)):
        errors.append("Action IDs must be unique")

    # Check IF nodes have exactly 2 outgoing edges
    if_actions = [a["id"] for a in workflow.get("actions", []) if a.get("kind") == "builtin:if"]
    for if_id in if_actions:
        outgoing = [e for e in workflow.get("edges", []) if e.get("from") == if_id]
        if len(outgoing) != 2:
            errors.append(f"IF action '{if_id}' must have exactly 2 outgoing edges (has {len(outgoing)})")

    # Check Loop nodes have exactly 2 outgoing edges
    loop_actions = [a["id"] for a in workflow.get("actions", []) if a.get("kind") == "builtin:loop"]
    for loop_id in loop_actions:
        outgoing = [e for e in workflow.get("edges", []) if e.get("from") == loop_id]
        if len(outgoing) != 2:
            errors.append(f"Loop action '{loop_id}' must have exactly 2 outgoing edges (has {len(outgoing)})")

    # Check edge references exist
    valid_sources = ["$trigger"] + action_ids
    for edge in workflow.get("edges", []):
        if edge.get("from") not in valid_sources:
            errors.append(f"Edge 'from' references unknown source: {edge.get('from')}")
        if edge.get("to") not in action_ids:
            errors.append(f"Edge 'to' references unknown action: {edge.get('to')}")

    return len(errors) == 0, errors


# =============================================================================
# CLI WRAPPER
# =============================================================================

def run_trigify_cli(args: list[str]) -> tuple[bool, str]:
    """Run trigify-cli command and return (success, output)."""
    try:
        result = subprocess.run(
            ["npx", "trigify-cli"] + args,
            capture_output=True,
            text=True,
            cwd="/Users/morganparry/repos/trigify-app"
        )
        if result.returncode != 0:
            return False, result.stderr or result.stdout
        return True, result.stdout
    except FileNotFoundError:
        return False, "trigify-cli not found. Make sure you're in the trigify-app directory."
    except Exception as e:
        return False, str(e)


def cmd_templates(args):
    """List available templates."""
    print("Available Workflow Templates:")
    print("=" * 60)
    for name, info in TEMPLATES.items():
        print(f"\n{name}")
        print(f"  Description: {info['description']}")
        print(f"  Arguments: {', '.join(info['args'])}")
    print("\n" + "=" * 60)
    print("\nUsage: workflow.py create --name 'Name' --search-id <id> --template <name> [args]")


def cmd_create(args):
    """Create a workflow."""
    if args.workflow_stdin:
        # Read workflow from stdin
        try:
            workflow_json = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON from stdin: {e}", file=sys.stderr)
            sys.exit(1)
    elif args.template:
        # Generate from template
        template_info = TEMPLATES.get(args.template)
        if not template_info:
            print(f"Error: Unknown template '{args.template}'", file=sys.stderr)
            print(f"Available templates: {', '.join(TEMPLATES.keys())}", file=sys.stderr)
            sys.exit(1)

        try:
            if args.template == "slack-notification":
                if not args.channel or not args.message:
                    print("Error: --channel and --message required for slack-notification template", file=sys.stderr)
                    sys.exit(1)
                workflow_json = template_slack_notification(args.channel, args.message)

            elif args.template == "webhook-forward":
                if not args.url:
                    print("Error: --url required for webhook-forward template", file=sys.stderr)
                    sys.exit(1)
                workflow_json = template_webhook_forward(args.url, args.method or "POST")

            elif args.template == "sentiment-filter":
                if not args.positive_channel or not args.negative_channel:
                    print("Error: --positive-channel and --negative-channel required for sentiment-filter template", file=sys.stderr)
                    sys.exit(1)
                workflow_json = template_sentiment_filter(args.positive_channel, args.negative_channel)

            elif args.template == "lead-enrich":
                if not args.crm:
                    print("Error: --crm required for lead-enrich template", file=sys.stderr)
                    sys.exit(1)
                workflow_json = template_lead_enrich(args.crm)

            elif args.template == "competitor-engagement":
                if not args.slack_channel:
                    print("Error: --slack-channel required for competitor-engagement template", file=sys.stderr)
                    sys.exit(1)
                workflow_json = template_competitor_engagement(args.slack_channel)

        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print("Error: Either --template or --workflow-stdin required", file=sys.stderr)
        sys.exit(1)

    # Validate workflow
    is_valid, errors = validate_workflow(workflow_json)
    if not is_valid:
        print("Workflow validation errors:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print("Generated workflow JSON:")
        print(json.dumps(workflow_json, indent=2))
        return

    # Create via CLI
    cli_args = ["workflow", "create", "--name", args.name, "--workflow-stdin"]
    if args.search_id:
        cli_args.extend(["--search-id", args.search_id])
    if args.enabled:
        cli_args.extend(["--enabled", args.enabled])
    if args.status:
        cli_args.extend(["--status", args.status])

    # Pipe workflow JSON to CLI
    try:
        result = subprocess.run(
            ["npx", "trigify-cli"] + cli_args,
            input=json.dumps(workflow_json),
            capture_output=True,
            text=True,
            cwd="/Users/morganparry/repos/trigify-app"
        )
        if result.returncode != 0:
            print(f"Error creating workflow: {result.stderr or result.stdout}", file=sys.stderr)
            sys.exit(1)
        print(result.stdout)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_list(args):
    """List workflows."""
    cli_args = ["workflow", "list"]
    if args.limit:
        cli_args.extend(["--limit", str(args.limit)])
    if args.status:
        cli_args.extend(["--status", args.status])

    success, output = run_trigify_cli(cli_args)
    if not success:
        print(f"Error: {output}", file=sys.stderr)
        sys.exit(1)
    print(output)


def cmd_get(args):
    """Get a workflow by ID."""
    if not args.id:
        print("Error: --id required", file=sys.stderr)
        sys.exit(1)

    cli_args = ["workflow", "get", "--id", args.id]
    success, output = run_trigify_cli(cli_args)
    if not success:
        print(f"Error: {output}", file=sys.stderr)
        sys.exit(1)
    print(output)


def cmd_update(args):
    """Update a workflow."""
    if not args.id:
        print("Error: --id required", file=sys.stderr)
        sys.exit(1)

    cli_args = ["workflow", "update", "--id", args.id]
    if args.name:
        cli_args.extend(["--name", args.name])
    if args.enabled:
        cli_args.extend(["--enabled", args.enabled])
    if args.status:
        cli_args.extend(["--status", args.status])
    if args.workflow_stdin:
        cli_args.append("--workflow-stdin")
        try:
            workflow_json = json.load(sys.stdin)
            is_valid, errors = validate_workflow(workflow_json)
            if not is_valid:
                print("Workflow validation errors:", file=sys.stderr)
                for error in errors:
                    print(f"  - {error}", file=sys.stderr)
                sys.exit(1)

            result = subprocess.run(
                ["npx", "trigify-cli"] + cli_args,
                input=json.dumps(workflow_json),
                capture_output=True,
                text=True,
                cwd="/Users/morganparry/repos/trigify-app"
            )
            if result.returncode != 0:
                print(f"Error: {result.stderr or result.stdout}", file=sys.stderr)
                sys.exit(1)
            print(result.stdout)
            return
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON from stdin: {e}", file=sys.stderr)
            sys.exit(1)

    success, output = run_trigify_cli(cli_args)
    if not success:
        print(f"Error: {output}", file=sys.stderr)
        sys.exit(1)
    print(output)


def cmd_delete(args):
    """Delete a workflow."""
    if not args.id:
        print("Error: --id required", file=sys.stderr)
        sys.exit(1)

    cli_args = ["workflow", "delete", "--id", args.id]
    success, output = run_trigify_cli(cli_args)
    if not success:
        print(f"Error: {output}", file=sys.stderr)
        sys.exit(1)
    print(output)


def cmd_validate(args):
    """Validate a workflow JSON."""
    try:
        workflow_json = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    is_valid, errors = validate_workflow(workflow_json)
    if is_valid:
        print("Workflow is valid!")
    else:
        print("Workflow validation errors:")
        for error in errors:
            print(f"  - {error}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Workflow management for Trigify",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List available templates
  workflow.py templates

  # Create from template
  workflow.py create --name "Slack Alert" --search-id abc123 \\
    --template slack-notification --channel "#alerts" --message "New post: {text}"

  # Create from JSON
  echo '{"trigger": {...}}' | workflow.py create --name "Custom" --workflow-stdin

  # Validate workflow JSON
  cat workflow.json | workflow.py validate
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # templates command
    templates_parser = subparsers.add_parser("templates", help="List available templates")
    templates_parser.set_defaults(func=cmd_templates)

    # create command
    create_parser = subparsers.add_parser("create", help="Create a workflow")
    create_parser.add_argument("--name", required=True, help="Workflow name")
    create_parser.add_argument("--search-id", help="Link to saved search ID")
    create_parser.add_argument("--template", help="Template name")
    create_parser.add_argument("--workflow-stdin", action="store_true", help="Read workflow JSON from stdin")
    create_parser.add_argument("--enabled", choices=["true", "false"], default="false", help="Enable workflow")
    create_parser.add_argument("--status", choices=["DRAFT", "PUBLISHED"], default="DRAFT", help="Workflow status")
    create_parser.add_argument("--dry-run", action="store_true", help="Print generated JSON without creating")
    # Template-specific args
    create_parser.add_argument("--channel", help="Slack channel (for slack-notification)")
    create_parser.add_argument("--message", help="Message template (for slack-notification)")
    create_parser.add_argument("--url", help="Webhook URL (for webhook-forward)")
    create_parser.add_argument("--method", default="POST", help="HTTP method (for webhook-forward)")
    create_parser.add_argument("--positive-channel", help="Positive sentiment channel (for sentiment-filter)")
    create_parser.add_argument("--negative-channel", help="Negative sentiment channel (for sentiment-filter)")
    create_parser.add_argument("--crm", choices=["hubspot", "salesforce", "attio"], help="CRM type (for lead-enrich)")
    create_parser.add_argument("--slack-channel", help="Slack channel (for competitor-engagement)")
    create_parser.set_defaults(func=cmd_create)

    # list command
    list_parser = subparsers.add_parser("list", help="List workflows")
    list_parser.add_argument("--limit", type=int, help="Maximum results")
    list_parser.add_argument("--status", choices=["DRAFT", "PUBLISHED"], help="Filter by status")
    list_parser.set_defaults(func=cmd_list)

    # get command
    get_parser = subparsers.add_parser("get", help="Get a workflow")
    get_parser.add_argument("--id", required=True, help="Workflow ID")
    get_parser.set_defaults(func=cmd_get)

    # update command
    update_parser = subparsers.add_parser("update", help="Update a workflow")
    update_parser.add_argument("--id", required=True, help="Workflow ID")
    update_parser.add_argument("--name", help="New name")
    update_parser.add_argument("--enabled", choices=["true", "false"], help="Enable/disable")
    update_parser.add_argument("--status", choices=["DRAFT", "PUBLISHED"], help="New status")
    update_parser.add_argument("--workflow-stdin", action="store_true", help="Read new workflow JSON from stdin")
    update_parser.set_defaults(func=cmd_update)

    # delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a workflow")
    delete_parser.add_argument("--id", required=True, help="Workflow ID")
    delete_parser.set_defaults(func=cmd_delete)

    # validate command
    validate_parser = subparsers.add_parser("validate", help="Validate workflow JSON from stdin")
    validate_parser.set_defaults(func=cmd_validate)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
