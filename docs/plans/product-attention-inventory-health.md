# Product Attention and Inventory Health

## Goal

Turn Product Performance into an exception-first action queue for physical inventory shared by WMS, Shopee, Lazada, TikTok, and Shopify.

The page must answer three questions:

1. Which products need action now?
2. Why do they need action?
3. What quantity or operational response is recommended?

## Product Model

Keep commercial performance and inventory health separate.

- Commercial performance describes whether demand is strong, weak, increasing, or decreasing.
- Inventory health describes whether stock is positioned correctly for that demand and replenishment lead time.
- The recommended action is derived from both dimensions; it is not an opaque composite score.

Examples:

| Demand | Inventory | Interpretation |
| --- | --- | --- |
| Strong or growing | Insufficient | Winner; reorder or expedite |
| Strong or growing | Appropriate | Healthy; protect availability |
| Weak or declining | Excess | Reduce, transfer, or promote |
| Weak or declining | Low | Do not reorder |
| Unknown | Any | Fix data before deciding |

## Canonical SKU and Kit Treatment

Inventory decisions operate at the physical WMS component SKU. Channel listings and Sales SKUs remain visible as commercial drilldowns.

Every non-overlapping demand source is converted to the component's physical unit before aggregation:

```text
combined physical demand = WMS component units + marketplace normalized component units
```

For a `100 x SKU_X` listing, one listing unit consumes 100 physical `SKU_X` units. Recipe expansion, rather than an SKU naming convention, is the source of truth.

For a fixed multi-component kit:

```text
sellable kit quantity = min(floor(component available / component quantity required))
```

Calculated availability for listings that share a component pool is not additive.

## Inventory Measures

```text
available = on hand - reserved

normalized daily demand =
  (WMS component units + marketplace normalized component units)
  / observed days

current days cover = available / normalized daily demand

inventory position = available + reliable inbound quantity

reorder point = normalized daily demand * (supplier lead time + safety days)

suggested order quantity =
  max(0, reorder point - inventory position)
```

Inbound is included only from open purchase-order quantities that have not been received. Cancelled, rejected, completed, and fully received quantities are excluded.

The selected date range defines the demand history used for velocity. Inventory and open purchase orders are live state, so projected stockout and reorder dates always start from the current time. A historical inventory-health view requires inventory snapshots and is not implied by changing the demand range.

Revenue from different currencies must not be combined until an explicit FX conversion policy exists. ABC remains based on the existing comparable WMS revenue measure for now and is descriptive, not a health signal.

## Action Statuses

| Status | Initial deterministic rule | Primary action |
| --- | --- | --- |
| Critical | Demand exists and available stock is zero, or stock will not cover supplier lead time | Expedite, transfer, or allocate |
| Reorder now | Inventory position is below lead-time demand plus safety stock | Create or approve a PO |
| Watch | Inventory is consuming the safety buffer or demand is increasing | Review shortly |
| Healthy | Inventory position is within the configured policy band | No action |
| Excess | More than the configured maximum cover is held | Hold purchasing, transfer, or promote |
| Dormant | Stock exists but no qualified demand was observed | Markdown, liquidate, or discontinue |
| Data issue | Observation history, supplier lead time, mapping coverage, or core data is insufficient | Repair data |

The initial policy uses seven safety days and 90 maximum cover days. These defaults must be visible and should later be configurable by category or ABC/XYZ segment.

## Confidence

Confidence is separate from health. Missing data must never silently produce a healthy result.

Inputs include:

- Sufficient observation history.
- Marketplace mapping coverage when marketplace demand exists.
- Supplier lead time availability when demand exists.
- Inventory and inbound data availability.

The page displays high, medium, or needs-data confidence and the reason for reduced confidence.

## Page Structure

### Summary

Show clickable counts for:

- Critical.
- Reorder now.
- Watch.
- Excess or dormant.
- Healthy.
- Data issues.

### Default Queue

Default to actionable exceptions, ordered by severity, time to action, ABC importance, and recommendation confidence.

Core columns:

- Action and plain-language reason.
- Canonical product and component SKU.
- Available, reserved, inbound, and inventory position.
- Combined physical demand and source split.
- Days cover compared with target.
- Projected stockout or reorder timing.
- Demand trend and ABC tier.
- Confidence.

### Detail Drilldown

Show:

- Formula inputs and policy thresholds.
- WMS and marketplace demand split.
- Contributing Sales SKUs and normalized component units.
- Current inventory position and suggested quantity.
- Supplier lead time and projected stockout date.
- Mapping coverage and data-quality warnings.
- Review quality as a separate commercial signal, not an inventory-health input.

## Delivery Stages

### Stage 1: Deterministic Action Queue

- Combine WMS and normalized marketplace component demand.
- Include reliable open-PO quantities.
- Implement action statuses and explainable reasons.
- Make the page exception-first.
- Preserve component-to-listing drilldown.

### Stage 2: Business Impact

- Add inventory cost and excess value.
- Normalize currencies before revenue aggregation.
- Estimate units and margin at risk.
- Use actual supplier lead-time history.
- Correct observed velocity for out-of-stock days.
- Add warehouse-level shortage and transfer recommendations.

### Stage 3: Forecasting and Policy

- Add seasonality and promotion annotations.
- Measure demand variability, forecast error, and bias.
- Add ABC/XYZ segmentation.
- Calculate service-level-based safety stock.
- Track recommendation outcomes and recalibrate thresholds.

## Sources

- [Shopify bundle inventory](https://help.shopify.com/en/manual/products/bundles/eligibility-and-considerations)
- [Shopify inventory reports and days remaining](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/inventory-reports)
- [Shopify analytics fields](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/analytics-fields)
- [NetSuite reorder point](https://www.netsuite.com/portal/resource/articles/inventory-management/reorder-point-rop.shtml)
- [MIT/APICS safety stock reference](https://web.mit.edu/2.810/www/files/readings/King_SafetyStock.pdf)
- [Microsoft inventory availability definitions](https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-on-hand-list)
- [Oracle inventory exception dashboard](https://docs.oracle.com/cd/E26401_01/doc.122/e48820/T291651T671994.htm)
- [Netstock inventory review workflow](https://help.netstock.com/en/articles/12471236-a-day-in-the-life-with-netstock-your-essential-guide-to-inventory-optimization)
