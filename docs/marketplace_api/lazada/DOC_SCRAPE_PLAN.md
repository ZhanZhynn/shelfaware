# Lazada API Docs Scraping Guide

## Purpose
Guide for scraping Lazada Open Platform API documentation.

## Prerequisites
- Firecrawl CLI installed
- API documentation URL pattern: `https://open.lazada.com/apps/doc/api?path=%2F{path}`

## Full Command

```bash
firecrawl scrape "https://open.lazada.com/apps/doc/api?path=%2F{module}%2F{api_name}" --only-main-content --wait-for 8000 -o platform_helpers/lazada/api_docs/{category}/{filename}.md
```

### Parameters
| Parameter | Description |
| --- | --- |
| URL | Full API doc URL from Lazada Open Platform with URL-encoded path |
| --only-main-content | Extract main content only (works after JS renders) |
| --wait-for 8000 | Wait 8 seconds for JS to render |
| -o | Output file path |

## Batching Strategy

### Parallel Batch Size
- **5 APIs per parallel call** (recommended)
- Execute in batches of 5 to avoid rate limiting

### Command Example (batch of 5)
```bash
firecrawl scrape "URL1" --only-main-content --wait-for 8000 -o out1.md &
firecrawl scrape "URL2" --only-main-content --wait-for 8000 -o out2.md &
firecrawl scrape "URL3" --only-main-content --wait-for 8000 -o out3.md &
firecrawl scrape "URL4" --only-main-content --wait-for 8000 -o out4.md &
firecrawl scrape "URL5" --only-main-content --wait-for 8000 -o out5.md &
wait
```

### Retry Strategy
If a file is too small (<1KB), retry individually:
```bash
firecrawl scrape "FAILED_URL" --only-main-content --wait-for 10000 -o output.md
```

## API Endpoint Reference

| URL Path | Output File |
| --- | --- |
| /order/document/get | order/order_document_get.md |
| /orders/items/get | order/orders_items_get.md |
| /order/get | order/order_get.md |
| /order/items/get | order/order_items_get.md |
| /orders/get | order/orders_get.md |
| /finance/payout/status/get | finance/finance_payout_status_get.md |
| /finance/transaction/accountTransactions/query | finance/finance_transaction_accountTransactions_query.md |
| /lbs/slb/queryLogisticsFeeDetail | finance/lbs_slb_queryLogisticsFeeDetail.md |
| /finance/transaction/details/get | finance/finance_transaction_details_get.md |

## File Structure

```
platform_helpers/lazada/api_docs/
├── DOC_SCRAPE_PLAN.md          # This file
├── finance/
│   ├── finance_payout_status_get.md
│   ├── finance_transaction_accountTransactions_query.md
│   ├── lbs_slb_queryLogisticsFeeDetail.md
│   └── finance_transaction_details_get.md
└── order/
    ├── order_document_get.md
    ├── orders_items_get.md
    ├── order_get.md
    ├── order_items_get.md
    └── orders_get.md
```

## Notes

- URLs use query parameter encoding: `/` → `%2F`
- Lazada docs may include navigation and sidebar noise similar to Shopee docs
- Use `grep` to find "## Request Parameters" to verify content exists
- All files are complete and usable - just potentially verbose

## Quick Start

1. Create module directory:
```bash
mkdir -p platform_helpers/lazada/api_docs/order
```

2. Scrape single API:
```bash
firecrawl scrape "https://open.lazada.com/apps/doc/api?path=%2Forder%2Fget" --only-main-content --wait-for 8000 -o platform_helpers/lazada/api_docs/order/order_get.md
```

3. Verify:
```bash
wc -l platform_helpers/lazada/api_docs/order/*.md
grep "## Request Parameters" platform_helpers/lazada/api_docs/order/*.md
```
