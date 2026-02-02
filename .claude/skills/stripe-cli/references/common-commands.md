# Common Stripe CLI Commands

Quick reference for frequently used Stripe CLI operations in test mode.

## Authentication

```bash
# Login to Stripe (opens browser for authentication)
stripe login

# Check current configuration
stripe config --list
```

## Products

```bash
# Create a product
stripe products create --name "Product Name" --description "Optional description"

# List all products
stripe products list

# Get product details
stripe products retrieve prod_ABC123

# Update a product
stripe products update prod_ABC123 --name "New Name"

# Delete a product
stripe products delete prod_ABC123
```

## Prices

```bash
# Create a monthly recurring price
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 1000 \
  --currency usd \
  --recurring[interval]=month

# Create a one-time price
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 1000 \
  --currency usd

# Create a usage-based price
stripe prices create \
  --product prod_ABC123 \
  --currency usd \
  --recurring[interval]=month \
  --recurring[usage_type]=metered \
  --billing_scheme=per_unit

# List all prices
stripe prices list

# Get price details
stripe prices retrieve price_XYZ789

# Update a price (note: most fields are immutable)
stripe prices update price_XYZ789 --active false
```

## Customers

```bash
# Create a customer
stripe customers create \
  --email customer@example.com \
  --name "Customer Name"

# List customers
stripe customers list

# Get customer details
stripe customers retrieve cus_ABC123

# Update customer
stripe customers update cus_ABC123 --email newemail@example.com

# Delete customer
stripe customers delete cus_ABC123
```

## Subscriptions

```bash
# Create a subscription
stripe subscriptions create \
  --customer cus_ABC123 \
  --items[0][price]=price_XYZ789

# Create subscription with multiple items (addon pattern)
stripe subscriptions create \
  --customer cus_ABC123 \
  --items[0][price]=price_base_plan \
  --items[1][price]=price_addon

# List subscriptions
stripe subscriptions list

# Get subscription details
stripe subscriptions retrieve sub_ABC123

# Update subscription (add item)
stripe subscriptions update sub_ABC123 \
  --items[0][id]=si_existing_item \
  --items[1][price]=price_new_addon

# Cancel subscription
stripe subscriptions cancel sub_ABC123
```

## Subscription Items

```bash
# List subscription items
stripe subscription_items list --subscription sub_ABC123

# Add an item to subscription
stripe subscription_items create \
  --subscription sub_ABC123 \
  --price price_XYZ789

# Remove an item
stripe subscription_items delete si_ABC123
```

## Payment Methods

```bash
# List payment methods
stripe payment_methods list --customer cus_ABC123 --type card

# Attach payment method to customer
stripe payment_methods attach pm_ABC123 --customer cus_ABC123
```

## Useful Filters and Options

```bash
# Limit results
stripe products list --limit 10

# Filter by created date
stripe products list --created[gte]=1609459200

# Get specific fields only
stripe products list --expand data.prices

# Output as JSON
stripe products list --output json

# Pretty print JSON
stripe products list --output json | jq .
```

## Test Mode vs Live Mode

All commands default to test mode. To use live mode (⚠️ dangerous):

```bash
# Use --live flag (NOT RECOMMENDED - use with extreme caution)
stripe products list --live
```

For this skill, we focus on test mode operations only.
