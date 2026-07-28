# 46 - Landed Cost Model Spec (portable)

**Status:** canonical as of 2026-07-27. This is the "locked D-Day model" used by the field-trip
PWA, the order sheets, the reverse-match tool, and every post-trip profit report.

**Audience:** an engineer (or an LLM agent) building a *different* tool that must produce the
**same landed cost and margin numbers** as Storeage's existing tooling. Implement this document
literally; do not re-derive it.

**One-line summary:**

```
landed_cost_per_piece_RM = (unit_cost_CNY x FX x product_cost_mult) / pieces_per_selling_unit
                           + (carton_m3 x shipping_rate_RM_per_m3) / pieces_per_carton
```

Everything else in this doc is (a) how to get each input honest, (b) what to compute downstream
of landed, and (c) the traps that make two tools disagree.

---

## 1. Scope and vocabulary

| Term | Meaning | Unit |
|---|---|---|
| **Unit cost** | The price the Chinese supplier quotes for **one of whatever they sell**. Yiwu often quotes per bag / per pack / per carton, NOT per piece. | CNY (¥) |
| **Selling unit** | The thing the supplier's price refers to. May contain N pieces. | - |
| **Piece** | One item as the *customer* buys it (one cake board, one pair of socks). **All costing happens per piece.** | - |
| **Product cost** | Unit cost converted to RM and loaded with the on-cost multiplier (duty + agent + handling). Excludes freight. | RM / piece |
| **Freight** | Sea-freight share allocated by carton volume. | RM / piece |
| **Landed cost** | product cost + freight. **The output of this spec.** Cost of one piece sitting in our MY warehouse. Excludes marketplace fees, ads, and packaging-for-outbound. | RM / piece |
| **Net revenue** | Selling price after marketplace + fulfilment fees. | RM / piece |
| **Profit** | net revenue - landed. | RM / piece |
| **Min viable price** | landed / keep_rate. Break-even sell price after fees. Never list below this. | RM / piece |

**Landed explicitly EXCLUDES:** Shopee/Lazada commission, fulfilment/pick-pack, ad spend,
listing setup, storage, and returns. Those all attack the *revenue* side (section 5), not the
cost side. Keeping the line there is what makes the two sides comparable across tools.

---

## 2. Global cost parameters

These are **global**, not per item. Changing one re-ranks the entire catalogue, so they belong in
a single settings object that is shared team-wide (in our tools: a `cost_params` JSON blob in D1,
editable from a gear icon, cached on-device).

| Key | Label | Current value | Meaning |
|---|---|---:|---|
| `fx_cny_rm` | FX rate CNY -> RM | **0.61** | Spot-ish rate used for all costing. Review monthly. |
| `product_cost_mult` | Product cost multiplier | **1.07** | +7% on FOB for duty + SST + Yiwu agent handling. Equivalent to a `handling_pct = 7`. |
| `shipping_rate_rm_per_m3` | Sea freight | **410** | RM per cubic metre, door-to-door China -> MY, blended. |
| `fee_shopee_pct` | Marketplace fee | **25** | Shopee MY blended commission + payment + campaign levies. |
| `fee_fulfilment_pct` | Fulfilment fee | **8** | Pick / pack / outbound handling. |
| `markup_gold` | Gold markup | **1.8** | Fallback RSP multiple when no market price is known (premium/hero SKUs). |
| `markup_t2` | Tier-2 markup | **1.6** | Fallback RSP multiple for commodity SKUs. |
| `razor` | Occam razor multiple | **1.9** | Team pricing rule of thumb: RSP = landed x 1.9. Used for a quick sanity price, not for profit. |

Derived constant used everywhere:

```
keep_rate = 1 - (fee_shopee_pct + fee_fulfilment_pct) / 100 = 1 - 0.33 = 0.67
```

**Implementation rule:** every one of these must be overridable at runtime with the values above
as fall-back defaults. Hard-coding them into the formula is how tools drift apart.

---

## 3. Per-item inputs

| Field | Type | Unit | Required | Where it comes from | If missing |
|---|---|---|---|---|---|
| `unit_cost_cny` | number | ¥ per **selling unit** | **yes** | Supplier quote / Yiwugo tier-1 price / booth negotiation | No landed cost. Return `null`, do not guess. |
| `pieces_per_selling_unit` | int | pieces | yes (default 1) | Reading the listing ("50pcs/bag"), or vision-check of the photo | Assume 1 but **flag the item** as unverified basis. |
| `ctn_l`, `ctn_w`, `ctn_h` | number | **cm** | no (but freight is wrong without it) | Ask the supplier for outer carton dims. This is the single most-missed field. | Freight = 0. **Must be flagged**: `no carton dims -> freight excluded`. |
| `pieces_per_carton` | int | pieces | no | Supplier ("500pcs/ctn") | Freight = 0, same flag. |
| `market_price_rm` | number | RM per **listing** | no | Shopee/Lazada MY comparable listing | No profit/ROI. Show landed only. Do **not** synthesise a market price from a markup and then call the result "profit". |
| `shopee_pack` | int | pieces per competitor listing | yes (default 1) | Reading the competitor listing ("5 pairs") | Assume 1 but flag. |
| `moq`, `price_tiers[]` | int, list | ¥ at qty breaks | no | Yiwugo tier table | Use tier-1 price. |
| `override_cost_rm` | number | RM per selling unit | no | Manually agreed RM price (e.g. agent invoiced in RM) | Ignore. |

### 3.1 The pack-normalisation trap (read this twice)

The #1 cause of two tools disagreeing is mixing units. Three different "pack" numbers exist and
they are all different:

1. `pieces_per_selling_unit` - divides the **supplier cost**.
2. `pieces_per_carton` - divides the **freight**.
3. `shopee_pack` - divides the **market price**.

`pieces_per_carton` must be counted **in pieces**, not in supplier selling units. If the supplier
says "40 bags per carton, 50pcs per bag", then `pieces_per_carton = 2000`, not 40. Getting this
wrong inflates freight by 50x and silently kills otherwise-good SKUs.

Rule: **normalise everything to one piece before any arithmetic.**

---

## 4. The algorithm

```
INPUT  : item fields (section 3) + cost_params (section 2)
OUTPUT : { landed, freight_per_piece, carton_m3, product_cost, ... }  or null

 1. cost_cny = unit_cost_cny
    if cost_cny is missing or <= 0 -> return null          # no cost, no model

 2. product_cost_per_selling_unit_rm =
        override_cost_rm  if override_cost_rm > 0
        else cost_cny * fx_cny_rm * product_cost_mult

 3. product_cost_per_piece =
        product_cost_per_selling_unit_rm / max(1, pieces_per_selling_unit)

 4. carton_m3 = (ctn_l * ctn_w * ctn_h) / 1_000_000        # cm^3 -> m^3
    (0 if any dimension is missing)

 5. freight_per_piece =
        (carton_m3 * shipping_rate_rm_per_m3) / pieces_per_carton
        if carton_m3 > 0 and pieces_per_carton > 0
        else 0                                             # and set flag "freight_excluded"

 6. LANDED = product_cost_per_piece + freight_per_piece    # <- the answer
```

Notes on step 2: `x fx x 1.07` is arithmetically identical to `x fx x (1 + handling_pct/100)` with
`handling_pct = 7`. Some of our UIs expose it as a multiplier, others as a percentage. They are
the same number; pick one representation and label it clearly.

Notes on step 5: freight is allocated by **volume, not weight**. Our mix is bulky and light
(packaging, textiles), so volumetric allocation is the binding constraint. If you ever source
dense goods (ceramics, metal), this model under-charges them and needs a weight-based branch.

---

## 5. Downstream of landed (so the other tool matches ours)

```
keep_rate       = 1 - (fee_shopee_pct + fee_fulfilment_pct)/100         # 0.67

market_per_piece = market_price_rm / max(1, shopee_pack)

net_revenue      = market_per_piece * keep_rate
profit_per_piece = net_revenue - LANDED                                  # only if market known
roi              = profit_per_piece / LANDED
margin_pct       = 100 * profit_per_piece / market_per_piece

min_viable_price = LANDED / keep_rate        # break-even list price; NEVER list below this
rsp_gold         = LANDED * markup_gold      # 1.8x, fallback RSP when no market price
rsp_tier2        = LANDED * markup_t2        # 1.6x
rsp_razor        = LANDED * razor            # 1.9x, the team's quick pricing rule
headroom         = market_per_piece - rsp_razor   # >0 means our rule-of-thumb price fits under market

bundle_cost_rm   = LANDED * bundle_size      # for listings sold as multi-packs
position_cost    = LANDED * order_qty
```

**Hard rule (learned the expensive way):** when `market_price_rm` is unknown, `profit` is `null`,
not "landed x markup - landed". Showing a synthetic markup as if it were profit made a whole
buying list look viable when it was not. Show landed and the suggested RSP, and label the item
"no market price".

---

## 6. Worked examples / test vectors

Use these to verify an implementation. Parameters = section 2 defaults
(`fx 0.61`, `mult 1.07`, `m3 rate 410`, fees `25 + 8` -> keep `0.67`).

### A. Cake board (simple, per-piece supplier price)

| Input | Value |
|---|---|
| unit_cost_cny | 1.20 |
| pieces_per_selling_unit | 1 |
| carton | 40 x 30 x 50 cm |
| pieces_per_carton | 500 |
| market_price_rm | 8.90 (shopee_pack 1) |

| Output | Value |
|---|---|
| carton_m3 | 0.060000 |
| freight_per_piece | 0.04920 |
| product_cost_per_piece | 0.78324 |
| **landed** | **0.83244** |
| net_revenue | 5.9630 |
| profit_per_piece | 5.1306 |
| roi | 6.163 |
| margin_pct | 57.6% |
| min_viable_price | 1.2424 |

### B. Same item, carton dims missing

| Output | Value |
|---|---|
| freight_per_piece | 0 (flag `freight_excluded`) |
| **landed** | **0.78324** |
| profit_per_piece | 5.1798 |

Landed is ~6% optimistic. This is exactly why the flag must surface in the UI.

### C. Bulk pack (supplier sells 50pcs/bag, competitor lists 10pcs)

| Input | Value |
|---|---|
| unit_cost_cny | 18.00 **per bag** |
| pieces_per_selling_unit | 50 |
| carton | 52 x 38 x 34 cm |
| pieces_per_carton | **2000** (40 bags x 50pcs) |
| market_price_rm | 25.90 for a 10-piece listing (shopee_pack 10) |

| Output | Value |
|---|---|
| carton_m3 | 0.067184 |
| freight_per_piece | 0.01377 |
| product_cost_per_piece | 0.23497 |
| **landed** | **0.24874** |
| market_per_piece | 2.59 |
| profit_per_piece | 1.4866 |
| roi | 5.976 |
| margin_pct | 57.4% |

If an implementation returns `landed = 11.75` here it forgot step 3; if it returns
`freight = 0.689` it counted bags instead of pieces in `pieces_per_carton`.

### D. Socks (5-pair competitor listing, thin margin)

| Input | Value |
|---|---|
| unit_cost_cny | 2.30 (per pair) |
| carton | 60 x 40 x 40 cm, 300 pcs/carton |
| market_price_rm | 14.90 for a 5-pair pack |

| Output | Value |
|---|---|
| carton_m3 | 0.096000 |
| freight_per_piece | 0.13120 |
| **landed** | **1.63241** |
| market_per_piece | 2.98 |
| profit_per_piece | 0.3642 |
| roi | 0.223 |
| margin_pct | 12.2% |
| min_viable_price | 2.4364 |

Freight is 8% of landed here. On low-value bulky SKUs freight is the decision, which is why
missing carton dims are treated as a data defect and not a rounding issue.

---

## 7. Guardrails and sanity checks

Copy these; they exist because each one caught a real bad row.

| Check | Trigger | Action |
|---|---|---|
| Missing cost | `unit_cost_cny` empty / 0 | Return `null`. Never substitute 0 (renders as infinite ROI). |
| Placeholder price | `unit_cost_cny >= 9999` or `landed >= 9999` | Flag `placeholder`, hide margin. |
| Near-zero price | `0 < unit_cost_cny < 0.05` | Flag `near_zero`, hide margin. |
| Implausible margin | `market_per_piece / landed > 30` | Flag `margin_too_high` - almost always an undivided bundle price. Hide margin until resolved. |
| Markup cap | For planning/ordering, cap effective market at `landed x 12` | Stops one mispriced row dominating a budget optimiser. |
| Currency confusion | Entered spend / (units x landed) between ~3.5x and 5x | Flag "RMB typed as RM?" - the FX ratio is the tell. |
| No carton dims | any of L/W/H or `pieces_per_carton` missing | Flag `no carton dims -> freight excluded`. Landed is a floor, not a truth. |
| No market price | `market_price_rm` empty | `profit = null`, show landed + suggested RSP only. |
| Unverified pack basis | `pieces_per_selling_unit` or `shopee_pack` assumed rather than read | Flag `basis_unverified`. Our practice: vision-check the listing photo before trusting it. |

Rounding: keep full float precision through the chain, round **only at display**. Landed to 2 dp
for money display, 4-5 dp when it feeds another computation (per-piece landed on cheap consumables
is often < RM 0.10, and 2 dp there throws ROI off by double digits).

---

## 8. Legacy model: the 0.891 multiplier (do not use for new work)

You will find `landed_rm_est = price_cny x 0.891` all over our older scraping outputs
(`MY_LANDED_MULT` in `supplier_sites_scrape/signal_check.py:37`, and the CSV column
`landed_rm_est`). It came from `sourcing-plan/docs/02-financial-model.md`:

```
0.891 = FX 0.66 x (1 + shipping 20% + duty/SST 5% + handling 10%)
```

It is a **screening estimate from before we had carton dimensions**, and it is now wrong twice
over: the FX rate has moved (0.66 -> 0.61) and freight is a flat 20% of FOB rather than
volumetric. It over-states cost on dense cheap items and badly under-states it on bulky ones.

Rules for the new tool:
- **Do not implement 0.891** as a costing path.
- If you ingest our CSVs, treat `landed_rm_est` as a *sort key for discovery only*, never as a
  number shown next to the word "profit".
- Prefer `honest_landed_rm` / `honest_landed_unit_rm` where present (those come from the read
  supplier tier-1 price with pack count divided out), and re-derive freight yourself from carton
  dims using section 4.
- The current-model equivalent of a "quick multiplier", if you truly need one for a first-pass
  screen with no carton data, is `0.61 x 1.07 = 0.6527` **plus a stated freight-excluded flag**.

---

## 9. Two secondary models you may see in our UIs

Both are *pricing* views layered on top of the same landed cost. Implement landed first; these
are optional.

**Model 1 - "Occam"** (fast field pricing, no fee modelling)
```
occam_landed = product_cost_per_piece + freight_per_piece   # note: NO handling multiplier
occam_rsp    = occam_landed * razor (1.9)
headroom     = market_per_piece - occam_rsp
```
Used at a booth when the buyer needs a yes/no in ten seconds. Deliberately omits the 7% on-cost,
so it is slightly optimistic; it is a filter, not a P&L.

**Model 2 - "Detailed"** (the real P&L, and the same as section 4 + 5)
```
LC          = product_cost_per_piece * (1 + handling_pct/100) + freight_per_piece
fees        = market_per_piece * (fee_shopee_pct + fee_fulfilment_pct)/100
profit      = market_per_piece - fees - LC
```
`product_cost_mult 1.07` and `handling_pct 7` are the same parameter wearing different clothes.
If you expose both models, make sure they share one settings object.

---

## 10. Reference implementation

Semantics are identical in both; port either.

### Python

```python
DEFAULTS = {
    "fx_cny_rm": 0.61,
    "product_cost_mult": 1.07,
    "shipping_rate_rm_per_m3": 410,
    "fee_shopee_pct": 25,
    "fee_fulfilment_pct": 8,
    "markup_gold": 1.8,
    "markup_t2": 1.6,
    "razor": 1.9,
}


def landed_cost(item, cp=None):
    """Return the per-piece landed cost + margin block, or None if uncostable.

    item keys: unit_cost_cny, pieces_per_selling_unit, ctn_l, ctn_w, ctn_h (cm),
               pieces_per_carton, market_price_rm, shopee_pack, override_cost_rm
    """
    cp = {**DEFAULTS, **(cp or {})}
    flags = []

    def num(x):
        try:
            v = float(x)
        except (TypeError, ValueError):
            return 0.0
        return v if v == v else 0.0  # NaN guard

    cny = num(item.get("unit_cost_cny"))
    override = num(item.get("override_cost_rm"))
    if cny <= 0 and override <= 0:
        return None                                     # no cost -> no model

    # 1-3. product cost, normalised to ONE piece
    per_unit_rm = override if override > 0 else cny * cp["fx_cny_rm"] * cp["product_cost_mult"]
    pcs_per_unit = max(1.0, num(item.get("pieces_per_selling_unit")) or 1.0)
    product_cost = per_unit_rm / pcs_per_unit

    # 4-5. freight, allocated by carton volume, per piece
    l, w, h = num(item.get("ctn_l")), num(item.get("ctn_w")), num(item.get("ctn_h"))
    pcs_ctn = num(item.get("pieces_per_carton"))
    carton_m3 = (l * w * h) / 1_000_000 if (l > 0 and w > 0 and h > 0) else 0.0
    if carton_m3 > 0 and pcs_ctn > 0:
        freight = (carton_m3 * cp["shipping_rate_rm_per_m3"]) / pcs_ctn
    else:
        freight = 0.0
        flags.append("freight_excluded")                # carton dims / pcs-per-carton missing

    # 6. THE ANSWER
    landed = product_cost + freight

    # downstream
    keep = 1 - (cp["fee_shopee_pct"] + cp["fee_fulfilment_pct"]) / 100
    pack = max(1.0, num(item.get("shopee_pack")) or 1.0)
    market_listing = num(item.get("market_price_rm"))
    market_pp = market_listing / pack if market_listing > 0 else None

    if market_pp is None:
        profit = roi = margin_pct = None
        flags.append("no_market_price")
    else:
        profit = market_pp * keep - landed
        roi = profit / landed if landed > 0 else None
        margin_pct = 100 * profit / market_pp

    if landed >= 9999 or cny >= 9999:
        flags.append("placeholder")
    if 0 < cny < 0.05:
        flags.append("near_zero")
    if market_pp and landed > 0 and market_pp / landed > 30:
        flags.append("margin_too_high")

    return {
        "carton_m3": carton_m3,
        "product_cost_per_piece": product_cost,
        "freight_per_piece": freight,
        "landed": landed,                               # RM per piece
        "keep_rate": keep,
        "market_per_piece": market_pp,
        "net_revenue": (market_pp * keep) if market_pp else None,
        "profit_per_piece": profit,
        "roi": roi,
        "margin_pct": margin_pct,
        "min_viable_price": landed / keep if keep > 0 else None,
        "rsp_gold": landed * cp["markup_gold"],
        "rsp_tier2": landed * cp["markup_t2"],
        "rsp_razor": landed * cp["razor"],
        "flags": flags,
    }
```

### JavaScript

```js
const DEFAULTS = {
  fx_cny_rm: 0.61, product_cost_mult: 1.07, shipping_rate_rm_per_m3: 410,
  fee_shopee_pct: 25, fee_fulfilment_pct: 8,
  markup_gold: 1.8, markup_t2: 1.6, razor: 1.9,
};

function landedCost(item, costParams) {
  const cp = { ...DEFAULTS, ...(costParams || {}) };
  const n = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
  const flags = [];

  const cny = n(item.unit_cost_cny), override = n(item.override_cost_rm);
  if (cny <= 0 && override <= 0) return null;

  const perUnitRm = override > 0 ? override : cny * cp.fx_cny_rm * cp.product_cost_mult;
  const pcsPerUnit = Math.max(1, n(item.pieces_per_selling_unit) || 1);
  const productCost = perUnitRm / pcsPerUnit;

  const l = n(item.ctn_l), w = n(item.ctn_w), h = n(item.ctn_h), pcsCtn = n(item.pieces_per_carton);
  const cartonM3 = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 1e6 : 0;
  let freight = 0;
  if (cartonM3 > 0 && pcsCtn > 0) freight = (cartonM3 * cp.shipping_rate_rm_per_m3) / pcsCtn;
  else flags.push('freight_excluded');

  const landed = productCost + freight;                      // <- the answer

  const keep = 1 - (cp.fee_shopee_pct + cp.fee_fulfilment_pct) / 100;
  const pack = Math.max(1, n(item.shopee_pack) || 1);
  const listing = n(item.market_price_rm);
  const marketPp = listing > 0 ? listing / pack : null;

  let profit = null, roi = null, marginPct = null;
  if (marketPp === null) flags.push('no_market_price');
  else {
    profit = marketPp * keep - landed;
    roi = landed > 0 ? profit / landed : null;
    marginPct = (100 * profit) / marketPp;
  }

  if (landed >= 9999 || cny >= 9999) flags.push('placeholder');
  if (cny > 0 && cny < 0.05) flags.push('near_zero');
  if (marketPp && landed > 0 && marketPp / landed > 30) flags.push('margin_too_high');

  return {
    cartonM3, productCostPerPiece: productCost, freightPerPiece: freight, landed,
    keepRate: keep, marketPerPiece: marketPp,
    netRevenue: marketPp === null ? null : marketPp * keep,
    profitPerPiece: profit, roi, marginPct,
    minViablePrice: keep > 0 ? landed / keep : null,
    rspGold: landed * cp.markup_gold, rspTier2: landed * cp.markup_t2, rspRazor: landed * cp.razor,
    flags,
  };
}
```

---

## 11. UI expectations (what our team is used to seeing)

If the new tool shows costs to the same people, mirror these or they will mistrust it:

- A **cost breakdown strip** per item: `Product RM x.xx + Shipping RM x.xx = Landed RM x.xx`,
  with the shipping line spelling out the derivation
  (`0.06000 m3 x RM410 / 500 per carton`) so a buyer can eyeball it.
- **Landed is always shown**; profit/ROI appear only when a market price exists.
- **Flags are visible on the card**, not buried: "no carton dims -> freight excluded" is the one
  that matters most.
- A single **gear icon** opening the global cost settings (section 2), with the note that it is
  shared with the team and affects every number in the app.
- Prices editable inline; edits recompute immediately, no save-and-refresh round trip.

---

## 12. Where this lives in the trend-hunter repo (for cross-checking)

| Concern | File |
|---|---|
| Cost-param defaults (canonical) | `scripts/build_trip_pack.py:22` |
| Field-trip PWA costing (JS, canonical) | `scripts/build_field_trip_tool.py:252` (`roi()`), deployed copy `cloudflare-fieldtrip/public/index.html:162` |
| Server-side recompute of field captures | `scripts/merge_captures_overnight.py:24,35` |
| Order sheets / post-trip landed + min-viable | `scripts/build_orders_sheet.py:27,190` |
| Full two-model calculator (Occam + Detailed) | `scripts/build_reverse_match_tool.py:2756` (defaults), `:3131` (`computeDDay`) |
| Profit / budget optimiser constants | `scripts/build_profit_report.py:25` |
| Pack-count + honest landed from the Yiwugo listing | `scripts/yiwugo_detail_enrich.py:403` |
| Legacy 0.891 screening multiplier | `supplier_sites_scrape/signal_check.py:37` |
| Original derivation of 0.891 | `sourcing-plan/docs/02-financial-model.md` |
| Pricing floor rule in the operating SOP | `sourcing-plan/docs/sops/02-listing.md` (never below `landed / 0.67`) |

---

## 13. Change control

The parameters in section 2 are business decisions, not engineering ones.

- **FX** - review monthly; a 5% FX move is ~5% off every landed cost in the catalogue.
- **Freight RM/m3** - re-quote per shipment; it moved with carrier rates and is the number most
  likely to be stale.
- **Fees** - re-check whenever Shopee changes commission tiers or a campaign levy lands.
- Whoever changes a parameter should say so in the shared settings note, because every historical
  margin recomputes silently. If the new tool stores decisions, store the `cost_params` snapshot
  **alongside** each decision so old numbers can be explained later. Our field tool does this via
  a `computed_snapshot_json` on each capture; recommend the same.

Questions on intent (why 1.07 and not itemised duty, why volumetric freight, why 0.67):
ask Ben. Questions on the arithmetic: this document is the source of truth.
