#!/usr/bin/env python3
"""
Create a monthly recurring addon product in Stripe test mode.

Usage:
    python3 create_addon_product.py "Product Name" 10.00 [--description "Optional description"]

Example:
    python3 create_addon_product.py "LinkedIn Connection" 10.00 --description "Additional LinkedIn account connection"
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
        print(f"Error running stripe command: {e.stderr}", file=sys.stderr)
        sys.exit(1)


def create_product(name, description=None):
    """Create a Stripe product."""
    args = ["products", "create", "--name", name]

    if description:
        args.extend(["--description", description])

    output = run_stripe_command(args)

    # Parse JSON output to get product ID
    try:
        data = json.loads(output)
        return data["id"]
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Failed to parse product ID from output: {e}", file=sys.stderr)
        print(f"Output was: {output}", file=sys.stderr)
        sys.exit(1)


def create_price(product_id, amount_dollars):
    """Create a monthly recurring price for the product."""
    # Convert dollars to cents
    amount_cents = int(float(amount_dollars) * 100)

    args = [
        "prices", "create",
        "--product", product_id,
        "--unit-amount", str(amount_cents),
        "--currency", "usd",
        "--recurring.interval", "month"
    ]

    output = run_stripe_command(args)

    # Parse JSON output to get price ID
    try:
        data = json.loads(output)
        return data["id"]
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Failed to parse price ID from output: {e}", file=sys.stderr)
        print(f"Output was: {output}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Create a monthly recurring addon product in Stripe test mode"
    )
    parser.add_argument("name", help="Product name")
    parser.add_argument("price", type=float, help="Monthly price in USD (e.g., 10.00)")
    parser.add_argument("--description", help="Product description", default=None)

    args = parser.parse_args()

    print(f"Creating product: {args.name}")
    product_id = create_product(args.name, args.description)
    print(f"✓ Product created: {product_id}")

    print(f"\nCreating monthly price: ${args.price:.2f} USD")
    price_id = create_price(product_id, args.price)
    print(f"✓ Price created: {price_id}")

    print("\n" + "="*60)
    print("SUCCESS!")
    print("="*60)
    print(f"\nProduct ID:  {product_id}")
    print(f"Price ID:    {price_id}")
    print(f"Amount:      ${args.price:.2f} USD/month")
    print("\nAdd to your .env file:")
    print(f"NEXT_PUBLIC_STRIPE_PRODUCT_ID={product_id}")
    print(f"NEXT_PUBLIC_STRIPE_PRICE_ID={price_id}")


if __name__ == "__main__":
    main()
