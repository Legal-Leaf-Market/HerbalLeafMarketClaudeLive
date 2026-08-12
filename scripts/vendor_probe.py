"""Read a candidate Shopify feed before it goes on the shelf.

    py -3 scripts/vendor_probe.py                     # every pending maker
    py -3 scripts/vendor_probe.py teaforguys.com      # one domain
    py -3 scripts/vendor_probe.py https://a.com b.com # several

This is the tool that turns `pending: true` in SHOPIFY_STORES into a real
registration. A store is added to lib/hlm.ts pending because nobody has read
its feed, and an unread feed cannot be given an honest `include` allow-list:
guess too wide and the shelf fills with teaware, gift cards and subscription
boxes; guess too narrow and the store silently matches nothing, which reads on
the site as a maker who sells nothing rather than as a mistake.

So: run this, read the product_type histogram it prints, write the include list
and categoryMap from what is actually in the feed, drop the pending flag.

It deliberately mirrors fetchStoreProducts() in lib/hlm.ts rather than being
clever, so what it counts is what the site would ingest: same 250-row pages,
same 4-page runaway cap, same "a short page means the end" rule. If this script
and that function ever disagree, this script is wrong.

Two things it CANNOT settle, both of which still need a human:
  - the shipping rate. Shopify's published policy page is prose, and prose says
    "free shipping on orders over $50" in a dozen ways, some of them stale. The
    SHIPPING map in public/app.js is a promise the cart makes on the maker's
    behalf, so its numbers come off a real checkout, not off this output.
  - the coupon. Same rule, same reason: Shopify silently drops an invalid
    ?discount= code, so only the checkout's own verdict counts.
"""
import json
import re
import sys
import urllib.error
import urllib.request

# Mirrors SHOPIFY_PAGE_LIMIT / SHOPIFY_MAX_PAGES in lib/hlm.ts.
PAGE_LIMIT = 250
MAX_PAGES = 4

# The pending roster in lib/hlm.ts, so a bare run probes exactly what is held
# back. St. Francis Herb Farm is absent because they are on WordPress and have
# no products.json for this to read.
PENDING = [
    ("Tea For Guys", "https://teaforguys.com", "tfg"),
    ("Purest Mushrooms", "https://purestmushrooms.com", "pmush"),
    ("Wooden Spoon Herbs", "https://woodenspoonherbs.com", "wsh"),
    ("Balls Deep Tea Company", "https://ballsdeeptea.com", "bdt"),
    ("Republic of Tea", "https://www.republicoftea.com", "rot"),
    ("Tea Sparrow", "https://www.teasparrow.ca", "tspw"),
]

# product_types that are almost never botanicals. Only a HINT for the eye: the
# include list is written from the histogram, not from this list, because one
# maker's "KITS" is a gift box and another's is a starter set of teas.
SUSPECT = re.compile(
    r"\b(accessor|teaware|ware|mug|cup|pot|kettle|infuser|strainer|gift|merch|apparel|"
    r"shirt|hat|book|card|sample|subscription|box|bundle|wholesale|misc|other|free)\b",
    re.I,
)

UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if r.status != 200:
            raise urllib.error.HTTPError(url, r.status, "not 200", r.headers, None)
        return r.read().decode("utf-8", "replace")


def fetch_products(domain):
    """Page products.json exactly the way lib/hlm.ts does."""
    all_ = []
    for page in range(1, MAX_PAGES + 1):
        url = f"{domain}/products.json?limit={PAGE_LIMIT}&page={page}"
        try:
            batch = (json.loads(get(url)) or {}).get("products") or []
        except Exception as e:
            if page == 1:
                raise
            print(f"  page {page} failed ({e}); keeping the {len(all_)} rows already read")
            return all_, False
        all_.extend(batch)
        if len(batch) < PAGE_LIMIT:
            return all_, False
    return all_, True


def probe(vendor, domain, prefix):
    print("=" * 72)
    print(f"{vendor}  {domain}")
    print("=" * 72)
    try:
        prods, capped = fetch_products(domain)
    except Exception as e:
        print(f"  NO FEED: {e}")
        print("  Either the maker is not on Shopify (or has closed products.json), in")
        print("  which case they cannot go in SHOPIFY_STORES at all and need a scraper")
        print("  of their own, or this machine simply could not reach them. A 403 on the")
        print("  CONNECT, a tunnel error or a timeout is the second case: re-run from a")
        print("  box with open egress before concluding anything about the store.\n")
        return

    if not prods:
        print("  Feed answered but is empty. Nothing to ingest.\n")
        return

    types = {}
    for p in prods:
        t = (p.get("product_type") or "").strip()
        row = types.setdefault(t, {"n": 0, "stock": 0, "eg": p.get("title") or ""})
        row["n"] += 1
        if any(v.get("available") for v in (p.get("variants") or [])):
            row["stock"] += 1

    print(f"  {len(prods)} products, {len(types)} product_types"
          + ("   *** HIT THE 4-PAGE CAP, catalogue may be truncated ***" if capped else ""))
    if "" in types:
        print(f"  {types['']['n']} products carry an EMPTY product_type: an include list")
        print("  cannot reach them, and with no include list they render an unlabelled chip.")
    print()
    print(f"  {'product_type':32} {'n':>5} {'in stock':>9}  example")
    print(f"  {'-' * 32} {'-' * 5} {'-' * 9}  {'-' * 30}")
    for t, row in sorted(types.items(), key=lambda kv: -kv[1]["n"]):
        mark = " <- check" if (SUSPECT.search(t) or not t) else ""
        print(f"  {(t or '(empty)')[:32]:32} {row['n']:>5} {row['stock']:>9}  {row['eg'][:30]}{mark}")

    keep = [t for t in types if t and not SUSPECT.search(t)]
    print()
    print("  Starting point for lib/hlm.ts, with the suspect types dropped. Read the")
    print("  histogram and edit it before pasting: this is a suggestion, not a verdict.")
    inc = ", ".join(json.dumps(t) for t in sorted(keep))
    print(f'  {{ vendor: {json.dumps(vendor)}, domain: {json.dumps(domain)}, prefix: {json.dumps(prefix)},')
    print(f"    include: [{inc}] }},")
    print()
    print("  Then, before the flag comes off: put an item in that maker's cart, read the")
    print("  shipping rate the CHECKOUT quotes, and write it into SHIPPING in app.js.")
    print("  A maker with no verified rate stays {unknown:true}, never a guessed flat.")
    print()


def main():
    args = sys.argv[1:]
    if args:
        todo = []
        for a in args:
            d = a if a.startswith("http") else "https://" + a
            host = re.sub(r"^https?://(www\.)?", "", d).split("/")[0]
            todo.append((host, d.rstrip("/"), host.split(".")[0][:5]))
    else:
        todo = PENDING
    for vendor, domain, prefix in todo:
        probe(vendor, domain, prefix)


if __name__ == "__main__":
    main()
