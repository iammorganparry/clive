# Stripe Product Patterns

Common patterns for creating different types of Stripe products.

## Monthly Recurring Addon

**Use case:** Add-on features purchased monthly (e.g., extra seats, additional connections)

```bash
# Create product
stripe products create \
  --name "Feature Name" \
  --description "Description of the addon feature"

# Create monthly recurring price
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 1000 \
  --currency usd \
  --recurring.interval month
```

**Or use the helper script:**
```bash
python3 scripts/create_addon_product.py "Feature Name" 10.00 --description "Description"
```

## Usage-Based Pricing

**Use case:** Charge based on actual usage (e.g., API calls, compute time)

```bash
# Create product
stripe products create \
  --name "API Credits" \
  --description "Pay per API call"

# Create metered price
stripe prices create \
  --product prod_ABC123 \
  --currency usd \
  --recurring.interval month \
  --recurring.usage-type metered \
  --billing-scheme per_unit \
  --unit-amount 100
```

## Tiered Pricing

**Use case:** Different prices for different quantity tiers

```bash
# Create product
stripe products create \
  --name "Tiered Service" \
  --description "Volume discounts available"

# Create tiered price
stripe prices create \
  --product prod_ABC123 \
  --currency usd \
  --recurring.interval month \
  --billing-scheme tiered \
  --tiers-mode graduated \
  --tiers[0][up_to]=10 \
  --tiers[0][unit_amount]=1000 \
  --tiers[1][up_to]=50 \
  --tiers[1][unit_amount]=800 \
  --tiers[2][up_to]=inf \
  --tiers[2][unit_amount]=600
```

## One-Time Payment

**Use case:** One-time purchase or setup fee

```bash
# Create product
stripe products create \
  --name "Setup Fee" \
  --description "One-time onboarding fee"

# Create one-time price
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 10000 \
  --currency usd
```

## Annual Subscription

**Use case:** Yearly billing with discount

```bash
# Create product
stripe products create \
  --name "Annual Plan" \
  --description "Save 20% with annual billing"

# Create annual recurring price
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 96000 \
  --currency usd \
  --recurring.interval year
```

## Free Trial Period

**Use case:** Monthly subscription with 14-day trial

```bash
# Create product
stripe products create \
  --name "Pro Plan" \
  --description "Professional tier with all features"

# Create price with trial
stripe prices create \
  --product prod_ABC123 \
  --unit-amount 2900 \
  --currency usd \
  --recurring.interval month \
  --recurring.trial-period-days 14
```

## Multiple Price Points

**Use case:** Same product with monthly and annual options

```bash
# Create product
PRODUCT_ID=$(stripe products create --name "Pro Plan" | jq -r .id)

# Monthly price
stripe prices create \
  --product $PRODUCT_ID \
  --unit-amount 2900 \
  --currency usd \
  --recurring.interval month

# Annual price (discounted)
stripe prices create \
  --product $PRODUCT_ID \
  --unit-amount 29900 \
  --currency usd \
  --recurring.interval year
```

## Best Practices

1. **Naming Convention**: Use clear, descriptive names that match your UI
2. **Descriptions**: Add descriptions to help identify products in the dashboard
3. **Metadata**: Add custom metadata for integration tracking
4. **Test Mode**: Always test in test mode first before creating live products
5. **Archiving vs Deleting**: Archive old prices instead of deleting to preserve history

## Adding Metadata

Metadata is useful for tracking products in your application:

```bash
stripe products create \
  --name "Pro Plan" \
  --metadata[app_feature]=workflow_automation \
  --metadata[tier]=professional \
  --metadata[environment]=production
```

## Updating Products

Most product fields can be updated:

```bash
# Update product name
stripe products update prod_ABC123 --name "New Name"

# Add metadata
stripe products update prod_ABC123 --metadata[key]=value

# Archive a product (soft delete)
stripe products update prod_ABC123 --active false
```

Note: Prices are mostly immutable. To change pricing, create a new price and archive the old one.
