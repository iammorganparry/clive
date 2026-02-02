---
name: stripe-cli
description: Manage Stripe test mode resources via CLI - create products and prices, manage subscriptions, list resources, and inspect customer data. Use when working with Stripe in development/test environments for tasks like (1) Creating addon products with monthly pricing, (2) Setting up subscription structures, (3) Inspecting product/price IDs for environment variables, (4) Managing test customers and subscriptions, (5) Any Stripe development operations in test mode.
---

# Stripe CLI

Manage Stripe resources in test mode using the Stripe CLI. This skill provides helper scripts and command references for common Stripe operations during development.

## Quick Start

### Prerequisites

Ensure Stripe CLI is installed and authenticated:

```bash
# Check if installed
stripe --version

# Login (opens browser for authentication)
stripe login

# Verify configuration
stripe config --list
```

All operations default to **test mode**. This skill focuses exclusively on test mode operations for safety.

### Common Tasks

**Create a monthly addon product:**
```bash
python3 scripts/create_addon_product.py "Product Name" 10.00 --description "Optional description"
```

**Get product/price details:**
```bash
python3 scripts/get_product_info.py prod_ABC123
python3 scripts/get_product_info.py price_XYZ789
```

**List resources:**
```bash
stripe products list
stripe prices list
stripe customers list
stripe subscriptions list
```

## Helper Scripts

### create_addon_product.py

Creates a product with a monthly recurring price in one command.

**Usage:**
```bash
python3 scripts/create_addon_product.py "Product Name" <price_in_dollars> [--description "Description"]
```

**Example:**
```bash
python3 scripts/create_addon_product.py "LinkedIn Connection" 10.00 \
  --description "Additional LinkedIn account connection"
```

**Output:**
- Product ID (e.g., `prod_ABC123`)
- Price ID (e.g., `price_XYZ789`)
- Environment variable format ready to copy

**When to use:** Creating standard monthly addon products (extra seats, feature addons, additional connections)

### get_product_info.py

Retrieves and displays product or price information in a readable format.

**Usage:**
```bash
python3 scripts/get_product_info.py <product_id_or_price_id>
```

**Example:**
```bash
python3 scripts/get_product_info.py prod_ABC123
python3 scripts/get_product_info.py price_XYZ789
```

**When to use:** Looking up existing product details, verifying IDs, confirming pricing configuration

## Direct CLI Commands

For operations not covered by helper scripts, use Stripe CLI directly.

### Products

```bash
# Create product
stripe products create --name "Product Name" --description "Description"

# List products
stripe products list --limit 10

# Get product details
stripe products retrieve prod_ABC123

# Update product
stripe products update prod_ABC123 --name "New Name"

# Archive product
stripe products update prod_ABC123 --active false

# Delete product (use --confirm to avoid prompt)
stripe products delete prod_ABC123 --confirm
```

### Prices

```bash
# Create monthly recurring price
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 1000 \
  --currency usd \
  --recurring.interval month

# Create annual price
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 10000 \
  --currency usd \
  --recurring.interval year

# Create one-time price
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 5000 \
  --currency usd

# List prices for a product
stripe prices list --product prod_ABC123

# Archive price
stripe prices update price_XYZ789 --active false
```

### Customers

```bash
# Create customer
stripe customers create \
  --email customer@example.com \
  --name "Customer Name"

# List customers
stripe customers list --limit 10

# Get customer details
stripe customers retrieve cus_ABC123

# Delete customer
stripe customers delete cus_ABC123 --confirm
```

### Subscriptions

```bash
# Create subscription
stripe subscriptions create \
  --customer cus_ABC123 \
  --items[0][price]=price_XYZ789

# Create subscription with addon (multiple items)
stripe subscriptions create \
  --customer cus_ABC123 \
  --items[0][price]=price_base_plan \
  --items[1][price]=price_addon

# List subscriptions
stripe subscriptions list --customer cus_ABC123

# Get subscription details
stripe subscriptions retrieve sub_ABC123

# Cancel subscription
stripe subscriptions cancel sub_ABC123 --confirm
```

## Workflow Examples

### Creating an Addon Product for Environment Variables

**Scenario:** Need to create a new addon product and get the IDs for `.env` configuration.

**Steps:**
1. Run helper script:
   ```bash
   python3 scripts/create_addon_product.py "Feature Name" 10.00 \
     --description "Feature description"
   ```

2. Copy the output IDs:
   ```
   Product ID:  prod_ABC123
   Price ID:    price_XYZ789
   ```

3. Add to `.env`:
   ```bash
   NEXT_PUBLIC_STRIPE_FEATURE_PRODUCT_ID=prod_ABC123
   NEXT_PUBLIC_STRIPE_FEATURE_PRICE_ID=price_XYZ789
   ```

### Setting Up Subscription with Multiple Addons

**Scenario:** Create a test subscription with base plan + 2 addons.

**Steps:**
1. Create customer if needed:
   ```bash
   stripe customers create --email test@example.com --name "Test User"
   ```

2. Create subscription with all items:
   ```bash
   stripe subscriptions create \
     --customer cus_ABC123 \
     --items[0][price]=price_base_plan \
     --items[1][price]=price_addon1 \
     --items[2][price]=price_addon2
   ```

3. Verify subscription:
   ```bash
   stripe subscriptions retrieve sub_ABC123
   ```

### Inspecting Existing Products

**Scenario:** Find product IDs for products created through the Stripe dashboard.

**Steps:**
1. List all products:
   ```bash
   stripe products list
   ```

2. Get specific product details:
   ```bash
   python3 scripts/get_product_info.py prod_ABC123
   ```

3. List prices for the product:
   ```bash
   stripe prices list --product prod_ABC123
   ```

## Reference Documentation

For more detailed information, see:

- **[common-commands.md](references/common-commands.md)** - Comprehensive CLI command reference with filters and options
- **[product-patterns.md](references/product-patterns.md)** - Standard patterns for different product types (usage-based, tiered, trials, etc.)

## Safety Notes

- All operations default to **test mode** - live mode requires explicit `--live` flag (not recommended)
- Use `--confirm` flag to avoid interactive prompts in scripts
- Prices are mostly immutable - create new prices instead of modifying existing ones
- Archiving (setting `active: false`) is preferred over deletion for historical tracking
- Test subscriptions don't process real payments

## Troubleshooting

**"API key expired":**
```bash
stripe login
```

**"No matches found" error with brackets:**
Use dot notation: `--recurring.interval` not `--recurring[interval]`

**Interactive prompts hanging:**
Add `--confirm` flag to destructive operations

**Need to switch Stripe accounts:**
```bash
stripe config --list  # See current account
stripe login          # Re-authenticate
```
