#!/usr/bin/env python3
"""
Retrieve detailed information about a Stripe product or price.

Usage:
    python3 get_product_info.py <product_id_or_price_id>

Example:
    python3 get_product_info.py prod_ABC123
    python3 get_product_info.py price_XYZ789
"""

import argparse
import subprocess
import sys
import json


def run_stripe_command(args):
    """Run a stripe CLI command and return the output."""
    try:
        result = subprocess.run(
            ["stripe"] + args,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"Error: {e.stderr}", file=sys.stderr)
        sys.exit(1)


def get_resource_info(resource_id):
    """Get information about a product or price."""
    # Determine resource type from ID prefix
    if resource_id.startswith("prod_"):
        resource_type = "products"
    elif resource_id.startswith("price_"):
        resource_type = "prices"
    else:
        print(f"Error: Unknown resource type for ID '{resource_id}'", file=sys.stderr)
        print("Expected 'prod_*' or 'price_*'", file=sys.stderr)
        sys.exit(1)

    args = [resource_type, "retrieve", resource_id]
    output = run_stripe_command(args)
    return output, resource_type


def parse_product_output(output):
    """Parse product output into key details."""
    details = {}
    for line in output.split('\n'):
        line = line.strip()
        if line.startswith('id '):
            details['id'] = line.split(maxsplit=1)[1]
        elif line.startswith('name '):
            details['name'] = line.split(maxsplit=1)[1]
        elif line.startswith('description '):
            details['description'] = line.split(maxsplit=1)[1]
        elif line.startswith('active '):
            details['active'] = line.split(maxsplit=1)[1]
    return details


def parse_price_output(output):
    """Parse price output into key details."""
    details = {}
    in_recurring = False

    for line in output.split('\n'):
        line_stripped = line.strip()

        if line_stripped.startswith('id '):
            details['id'] = line_stripped.split(maxsplit=1)[1]
        elif line_stripped.startswith('product '):
            details['product'] = line_stripped.split(maxsplit=1)[1]
        elif line_stripped.startswith('unit_amount '):
            amount_cents = line_stripped.split(maxsplit=1)[1]
            details['unit_amount_cents'] = amount_cents
            details['unit_amount_dollars'] = f"${int(amount_cents) / 100:.2f}"
        elif line_stripped.startswith('currency '):
            details['currency'] = line_stripped.split(maxsplit=1)[1]
        elif line_stripped.startswith('active '):
            details['active'] = line_stripped.split(maxsplit=1)[1]
        elif line_stripped.startswith('recurring '):
            in_recurring = True
        elif in_recurring and line_stripped.startswith('interval '):
            details['interval'] = line_stripped.split(maxsplit=1)[1]
            in_recurring = False

    return details


def main():
    parser = argparse.ArgumentParser(
        description="Get detailed information about a Stripe product or price"
    )
    parser.add_argument("id", help="Product ID (prod_*) or Price ID (price_*)")

    args = parser.parse_args()

    print(f"Retrieving information for: {args.id}\n")
    output, resource_type = get_resource_info(args.id)

    print("="*60)
    if resource_type == "products":
        details = parse_product_output(output)
        print("PRODUCT INFORMATION")
        print("="*60)
        print(f"ID:          {details.get('id', 'N/A')}")
        print(f"Name:        {details.get('name', 'N/A')}")
        print(f"Description: {details.get('description', 'N/A')}")
        print(f"Active:      {details.get('active', 'N/A')}")

    elif resource_type == "prices":
        details = parse_price_output(output)
        print("PRICE INFORMATION")
        print("="*60)
        print(f"ID:       {details.get('id', 'N/A')}")
        print(f"Product:  {details.get('product', 'N/A')}")
        print(f"Amount:   {details.get('unit_amount_dollars', 'N/A')} {details.get('currency', '').upper()}")
        if 'interval' in details:
            print(f"Interval: {details.get('interval', 'N/A')}")
        print(f"Active:   {details.get('active', 'N/A')}")

    print("\nFull output:")
    print("-"*60)
    print(output)


if __name__ == "__main__":
    main()
