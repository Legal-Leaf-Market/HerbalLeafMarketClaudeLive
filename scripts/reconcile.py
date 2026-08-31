#!/usr/bin/env python3
"""Reconcile what a shop BUYS against what its brands PUBLISH.

The problem this exists for
---------------------------
A shop with no e-commerce, no POS and no digital SKUs still has two things
written down somewhere: paperwork from its distributor saying what it bought,
and brands who publish full product data for those same items on their own
sites. Neither half is a catalogue. Joined, they are.

    order guide / invoices        brand catalogues
    (what they stock,      +      (names, sizes, photos,   =   a shelf
     how often, pack size)         real descriptions)

Nothing here scrapes a shop. The retailer side comes from the retailer, by
hand, with their agreement; the brand side is each maker's own public feed.

Why the matching is a ladder and not a lookup
---------------------------------------------
UPC is the only truly universal key, and roughly half of real inputs will be
missing it, because a shop that types its order guide by hand types the
description and not the barcode. So the matcher walks a ladder and RECORDS
WHICH RUNG IT LANDED ON. A join is only useful if you know how much to trust
each row: exact UPC is a fact, a fuzzy name match is a suggestion, and putting
both on a shelf without distinguishing them is how a shopper ends up buying the
4oz when the shop has the 8oz.

    upc      exact barcode, normalised.        trust it
    sku      brand + item code                 trust it
    name     brand + identical normalised name trust it
    fuzzy    token overlap over a threshold    review it
    (none)   unmatched                         somebody looks

ORDERED IS NOT CARRIED, which is the reconciliation that actually matters. One
line on one invoice is usually a special order for one customer, not something
that lives on a shelf. --min-months keeps only items seen in that many distinct
months of the window. Skip it and you publish a catalogue of things nobody can
walk in and buy, which is worse than publishing nothing.

CASE PACK, likewise. An order line reads 12/60ct: twelve bottles of sixty. The
shelf sells one bottle. Quantities are divided by the pack before they mean
anything, and a pack column that is missing is assumed to be 1 rather than
guessed at.

COST IS NOT RETAIL AND IS NEVER EMITTED. Invoices carry what the shop paid.
Publishing that would be a serious breach of somebody who let us see their
books, so cost is read only to sanity-check that a retail price is above it,
and no output of this script contains a cost column. Retail comes from a
shelf-tag file, or from a markup rule the shop states, or the row ships without
a price.

Usage
-----
    # brand catalogues are HLM product JSON, e.g. /api/deck?vendor=...
    reconcile.py --orders guide.csv --catalog wsh.json --catalog fatm.json \\
                 --min-months 3 --out shelf.json --unmatched review.csv

    # a retailer's own product list instead of an order guide
    reconcile.py --retailer lm.json --catalog wsh.json --report
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher

# ---------------------------------------------------------------- normalising

# Words that say nothing about WHICH product this is. Stripped before any name
# comparison so "Rose Colored Glasses - a Daily Mood Elixir" and
# "Rose-Colored Glasses" can meet. Deliberately short: every word added here is
# a word two genuinely different products are now allowed to agree on, and the
# failure that causes (confidently matching the wrong item) is worse and much
# harder to notice than the failure it prevents.
# Kept to genuine stopwords, and that is a correction rather than a preference.
# This list first held the domain words too: herbal, elixir, tonic, blend,
# daily, organic. On a herbal shelf those are frequently the product's actual
# name, and stripping them made "Herbal Coffee - Chicory and Maca" fail to
# match "Herbal Coffee", because the only word the two provably shared had been
# deleted as noise. A stopword list has to be about English, not about the
# subject; the similarity metric is what handles the subject.
NOISE = {
    "the", "a", "an", "and", "with", "for", "of", "by", "from", "to", "in",
    "oz", "ct", "count", "pack", "size",
}
UNIT_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:oz|ml|l|g|mg|kg|lb|ct|count|caps?|capsules?|tabs?|servings?)\b", re.I)


def norm_name(s: str) -> str:
    """Lowercase, drop punctuation, sizes and noise words, sort what is left.

    Sorted because word ORDER varies between a brand's own name for a thing and
    the way a retailer lists it, while the words themselves usually survive.
    """
    s = (s or "").lower()
    s = UNIT_RE.sub(" ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = [t for t in s.split() if t and t not in NOISE]
    return " ".join(sorted(toks))


def norm_upc(s: str) -> str:
    """Digits only, and UPC-12 widened to EAN-13.

    The same product is a 12-digit UPC on a US shelf tag and a 13-digit EAN in
    half of the databases that describe it, differing only by a leading zero.
    Comparing the raw strings misses every one of those.
    """
    d = re.sub(r"\D", "", s or "")
    if len(d) == 12:
        d = "0" + d
    return d


def similar(a: str, b: str) -> float:
    """How alike two normalised names are, 0 to 1.

    CONTAINMENT CARRIES THIS, not overlap, because of how the two sides
    actually differ. A retailer takes the brand's name and appends their own
    words to it: "Rose Colored Glasses" becomes "Rose Colored Glasses - a Daily
    Mood Elixir". Jaccard punishes that, since the union grows with every word
    the shop added, and the correct match scores lower the more helpfully the
    shop described it. Containment measures the right thing: is the shorter
    name essentially inside the longer one.

    TWO SHARED TOKENS MINIMUM, and this guard is load-bearing. Containment
    alone rates any one-word overlap a perfect match, and on the first real run
    it paired "Banded River Agate", a lump of rock, with "Inner Balance
    Bundle". Requiring two shared words costs nothing real, because a genuine
    product match essentially always shares at least two, and it removes the
    entire class of confident nonsense.
    """
    if not a or not b:
        return 0.0
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    jaccard = len(inter) / len(ta | tb)
    seq = SequenceMatcher(None, a, b).ratio()
    smaller = min(len(ta), len(tb))
    containment = (len(inter) / smaller) if smaller else 0.0
    if len(inter) < 2:
        # One word in common is a coincidence. Fall back to the strict
        # measures, which will not clear the threshold on their own.
        return max(jaccard, seq * 0.6)
    return max(jaccard, containment, seq)


def parse_pack(s) -> int:
    """'12/60ct' -> 12, '6 pk' -> 6, '' -> 1.

    Returns the number of SELLABLE UNITS in the case. The second number is the
    count inside one unit and is not a multiplier on anything the shelf sells.
    """
    if s is None:
        return 1
    t = str(s).strip()
    if not t:
        return 1
    m = re.match(r"^\s*(\d+)\s*[/xX]", t)
    if m:
        return max(1, int(m.group(1)))
    m = re.match(r"^\s*(\d+)\s*(?:pk|pack|cs|case)?\s*$", t, re.I)
    if m:
        return max(1, int(m.group(1)))
    return 1


def month_of(s: str) -> str:
    """Any date-ish string down to YYYY-MM. Empty if it cannot be read."""
    t = (s or "").strip()
    m = re.search(r"(\d{4})[-/](\d{1,2})", t)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    m = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})", t)
    if m:
        y = m.group(3)
        y = ("20" + y) if len(y) == 2 else y
        return f"{y}-{int(m.group(1)):02d}"
    return ""


# ------------------------------------------------------------------- loading

# Real exports name these columns a dozen different ways, and a shop is not
# going to rename them for us. Header matching is by substring, lowercased.
COLS = {
    "upc":   ("upc", "barcode", "gtin", "ean"),
    "sku":   ("sku", "item #", "item#", "item no", "item number", "product code", "prod code"),
    "brand": ("brand", "manufacturer", "vendor", "supplier", "mfg"),
    "name":  ("description", "item description", "product", "name", "title"),
    "pack":  ("pack", "case pack", "cs pack", "units", "uom"),
    "qty":   ("qty", "quantity", "cases", "ordered"),
    "date":  ("date", "invoice date", "order date", "ordered on", "period"),
    "cost":  ("cost", "unit cost", "wholesale", "net price"),
}


def pick(headers, kind):
    want = COLS[kind]
    for h in headers:
        hl = (h or "").strip().lower()
        for w in want:
            if w in hl:
                return h
    return None


def load_orders(path):
    """An order guide or invoice export. One row per line item."""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        return [], {}
    hdr = list(rows[0].keys())
    cmap = {k: pick(hdr, k) for k in COLS}
    if not cmap["name"] and not cmap["upc"]:
        sys.exit("No description or UPC column found. Headers seen: " + ", ".join(hdr))
    out = []
    for r in rows:
        get = lambda k: (r.get(cmap[k]) or "").strip() if cmap[k] else ""
        out.append({
            "upc": get("upc"), "sku": get("sku"), "brand": get("brand"),
            "name": get("name"), "pack": parse_pack(get("pack")),
            "qty": get("qty"), "month": month_of(get("date")),
            "cost": get("cost"),
        })
    return out, cmap


def load_catalog(paths):
    """Brand catalogues in HLM product shape (what /api/deck returns)."""
    items = []
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
        for it in (data if isinstance(data, list) else data.get("products", [])):
            items.append(it)
    return items


# ------------------------------------------------------------------ matching

def build_index(catalog):
    by_upc, by_sku, by_name = {}, {}, defaultdict(list)
    for it in catalog:
        for v in it.get("variants") or []:
            u = norm_upc(v.get("barcode") or v.get("upc") or "")
            if u:
                by_upc.setdefault(u, it)
            s = (v.get("sku") or "").strip().lower()
            if s:
                by_sku.setdefault(s, it)
        u = norm_upc(it.get("barcode") or it.get("upc") or "")
        if u:
            by_upc.setdefault(u, it)
        by_name[norm_name(it.get("name", ""))].append(it)
    return by_upc, by_sku, by_name


def match_one(row, idx, threshold):
    by_upc, by_sku, by_name = idx

    u = norm_upc(row.get("upc", ""))
    if u and u in by_upc:
        return by_upc[u], "upc", 1.0

    s = (row.get("sku") or "").strip().lower()
    if s and s in by_sku:
        return by_sku[s], "sku", 1.0

    n = norm_name(row.get("name", ""))
    if not n:
        return None, "none", 0.0

    exact = by_name.get(n) or []
    if len(exact) == 1:
        return exact[0], "name", 1.0
    if len(exact) > 1:
        # Two catalogue items normalising identically is a real condition (a
        # 4oz and an 8oz of the same thing once sizes are stripped). Refusing
        # to choose is correct: picking either would be a coin toss presented
        # as a fact.
        return None, "ambiguous", 1.0

    best, score = None, 0.0
    for cand_name, items in by_name.items():
        sc = similar(n, cand_name)
        if sc > score:
            best, score = items[0], sc
    if best is not None and score >= threshold:
        return best, "fuzzy", round(score, 3)
    return None, "none", round(score, 3)


# -------------------------------------------------------------------- report

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--orders", help="order guide / invoice export CSV")
    src.add_argument("--retailer", help="a retailer's own product JSON, HLM shape")
    ap.add_argument("--catalog", action="append", required=True, help="brand catalogue JSON (repeatable)")
    ap.add_argument("--min-months", type=int, default=0,
                    help="keep only items ordered in at least this many distinct months")
    ap.add_argument("--threshold", type=float, default=0.72, help="fuzzy name floor, 0 to 1")
    ap.add_argument("--out", help="write the matched shelf here as JSON")
    ap.add_argument("--unmatched", help="write everything that did not match here as CSV")
    ap.add_argument("--report", action="store_true", help="print the summary even without --out")
    a = ap.parse_args()

    catalog = load_catalog(a.catalog)
    idx = build_index(catalog)

    if a.orders:
        raw, cmap = load_orders(a.orders)
        # Collapse line items to one row per product, counting DISTINCT MONTHS
        # rather than line count: five lines in one week is one restock, not a
        # pattern, and treating it as five is how a one-off looks like a staple.
        agg = {}
        for r in raw:
            key = norm_upc(r["upc"]) or (r["brand"].lower() + "|" + norm_name(r["name"]))
            e = agg.setdefault(key, {**r, "months": set(), "units": 0})
            if r["month"]:
                e["months"].add(r["month"])
            try:
                e["units"] += (float(r["qty"] or 0)) * r["pack"]
            except ValueError:
                pass
        rows = list(agg.values())
        held = [r for r in rows if a.min_months and len(r["months"]) < a.min_months]
        rows = [r for r in rows if not (a.min_months and len(r["months"]) < a.min_months)]
        print(f"order guide: {len(raw)} lines -> {len(rows)+len(held)} products", file=sys.stderr)
        if a.min_months:
            print(f"  held back, seen in fewer than {a.min_months} months: {len(held)}", file=sys.stderr)
    else:
        with open(a.retailer, encoding="utf-8") as fh:
            data = json.load(fh)
        rows = [{"upc": "", "sku": "", "brand": it.get("vendor", ""), "name": it.get("name", ""),
                 "pack": 1, "qty": "", "month": "", "cost": "", "months": set(), "units": 0,
                 "_src": it}
                for it in (data if isinstance(data, list) else data.get("products", []))]
        print(f"retailer list: {len(rows)} products", file=sys.stderr)

    shelf, misses, how = [], [], Counter()
    for r in rows:
        hit, rung, score = match_one(r, idx, a.threshold)
        how[rung] += 1
        if hit is None:
            misses.append({"name": r["name"], "brand": r["brand"], "upc": r["upc"],
                           "why": rung, "best_score": score})
            continue
        shelf.append({
            "match": rung, "confidence": score,
            "shop_name": r["name"], "brand_name": hit.get("name"),
            "vendor": hit.get("vendor"), "category": hit.get("category"),
            "brand_price": hit.get("price"), "image": hit.get("image"),
            "url": hit.get("url"), "in_stock_at_brand": hit.get("inStock"),
            "months_ordered": len(r.get("months") or ()),
            "units_ordered": round(r.get("units") or 0, 2),
        })

    print("\nmatched %d of %d" % (len(shelf), len(rows)), file=sys.stderr)
    for rung in ("upc", "sku", "name", "fuzzy", "ambiguous", "none"):
        if how[rung]:
            print(f"  {rung:<10} {how[rung]}", file=sys.stderr)
    if shelf:
        need_eyes = [s for s in shelf if s["match"] == "fuzzy"]
        if need_eyes:
            print(f"\n{len(need_eyes)} fuzzy match(es) to eyeball:", file=sys.stderr)
            for s in sorted(need_eyes, key=lambda x: -x["confidence"]):
                print(f"  {s['confidence']:.2f}  {s['shop_name'][:44]:<44} -> {s['brand_name']}", file=sys.stderr)

    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(shelf, fh, indent=1)
        print(f"\nwrote {a.out}", file=sys.stderr)
    if a.unmatched and misses:
        with open(a.unmatched, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=["name", "brand", "upc", "why", "best_score"])
            w.writeheader()
            w.writerows(misses)
        print(f"wrote {a.unmatched} ({len(misses)} rows)", file=sys.stderr)
    if a.report and not a.out:
        json.dump(shelf, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
