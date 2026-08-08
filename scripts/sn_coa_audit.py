"""Audit the Secret Nature COA join against the LIVE feed and lab page.

    py -3 scripts/sn_coa_audit.py

This is the reference implementation of the matcher that lives in
lib/hlm.ts (attachSecretNatureCoas and friends); the two are line-for-line
ports of each other and MUST be kept in sync. Run this whenever Secret Nature
adds strains or the on-site links look wrong: it prints every join it would
make, so a bad one can be caught by eye before it reaches a card.

Why the identity is (strain key, form, cannabinoid), learned in prototyping
on 2026-08-08 (90/207 matched, hand-audited):
  - camelCase must be split: half the files are CherryKushTHCA.pdf style
  - empty keys never match: "D8 Live Resin" matched an unrelated file because
    both keys normalised to nothing
  - form matters: Secret Nature publishes Cherry Kush as flower COA,
    CBD-gummy COA and THC-gummy COA; a gummy must never link a flower cert
  - cannabinoid matters: newest-first alone handed BloodDiamondCBD the
    BloodDiamondTHCA.pdf
A wrong certificate on a card is far worse than a missing link; prefer
under-matching.
"""
import json
import re
import urllib.request
from collections import defaultdict

LAB_PAGE = "https://secretnature.com/pages/laboratory-test-results"

STOP = {
    "thca", "thc", "cbd", "cbg", "cbn", "thcv", "d8", "d9", "delta", "live", "resin",
    "rosin", "infused", "flower", "flowers", "preroll", "prerolls", "pre", "roll",
    "rolls", "vape", "vapes", "cart", "cartridge", "gummy", "gummies", "smokes",
    "blunt", "blunts", "joint", "joints", "pack", "ct", "count", "oz", "gram",
    "grams", "g", "mg", "premium", "exotic", "indoor", "greenhouse", "organic",
    "hemp", "cannabis", "sungrown", "smalls", "bud", "buds", "grade", "tube",
    "tubes", "pdf", "rdf", "pt", "rd", "gh", "final", "copy", "updated", "new",
    "coa", "secret", "nature", "sa", "at", "drink", "drinks", "wholesale",
}
GUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")


def words(s):
    s = GUID.sub(" ", s)
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s)
    s = re.sub(r"([A-Za-z])(\d)", r"\1 \2", s)
    s = re.sub(r"(\d)([A-Za-z])", r"\1 \2", s)
    s = s.lower()
    s = re.sub(r"[_\-.]+", " ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return s.split()


def key(s):
    return " ".join(sorted(t for t in words(s) if not t.isdigit() and t not in STOP))


def cann(s):
    w = set(words(s))
    if "thca" in w: return "thca"
    if "cbd" in w: return "cbd"
    if "cbg" in w: return "cbg"
    if "thcv" in w: return "thcv"
    if "d8" in w or ({"delta", "8"} <= w) or ({"d", "8"} <= w): return "d8"
    if "d9" in w or ({"delta", "9"} <= w) or ({"d", "9"} <= w) or "thc" in w: return "thc"
    return ""


def form(s):
    t = s.lower()
    if re.search(r"gumm|60\s*_?ct|smacker", t): return "gummy"
    if re.search(r"tube", t): return "tube"
    if re.search(r"pre[-_ ]?roll|blunt|joint|cigarette", t): return "preroll"
    if re.search(r"vape|cart(ridge)?\b|pod|disposable", t): return "vape"
    if re.search(r"drink|soda|beverage|seltzer|tonic", t): return "drink"
    if re.search(r"distillate|extract|diamond|sauce|badder|concentrate|tincture|oil\b", t): return "extract"
    return "flower"


def main():
    prods, page = [], 1
    while True:
        batch = json.loads(get(f"https://secretnature.com/products.json?limit=250&page={page}"))["products"]
        if not batch: break
        prods += batch
        if len(batch) < 250: break
        page += 1

    html = get(LAB_PAGE)
    pdfs = sorted(set(re.findall(r"href=[\"']([^\"']+\.pdf[^\"']*)[\"']", html)))
    pdfs = [u for u in pdfs if "legal_opinion" not in u.lower()]

    fmap = defaultdict(list)
    for u in pdfs:
        name = u.split("/")[-1].split("?")[0]
        base = re.sub(r"\.pdf", "", name, flags=re.I)
        k = key(base)
        if not k: continue
        vm = re.search(r"[?&]v=(\d+)", u)
        fmap[(k, form(name))].append((cann(base), int(vm.group(1)) if vm else 0, u))

    def pick(cands, pcann):
        if not cands: return None
        newest = lambda xs: sorted(xs, key=lambda c: -c[1])[0][2]
        exact = [c for c in cands if c[0] == pcann]
        if exact: return newest(exact)
        unmarked = [c for c in cands if c[0] == ""]
        if unmarked: return newest(unmarked)
        if pcann == "" and len({c[0] for c in cands}) == 1: return newest(cands)
        return None

    matched = 0
    print(f"{'form':8} {'cann':5} product  <-  document")
    for p in prods:
        pk = key(p["title"])
        if not pk: continue
        pf = form(p["title"] + " " + (p.get("product_type") or ""))
        pc = cann(p["title"])
        url = pick(fmap.get((pk, pf)), pc)
        if url:
            matched += 1
            print(f"{pf:8} {pc or '-':5} {p['title'][:44]!r:48} <- {url.split('/')[-1].split('?')[0][:55]}")
    print(f"\npdfs: {len(pdfs)}  products: {len(prods)}  matched: {matched}")
    print("baseline 2026-08-08 was 90/207; a big drop means their page moved or renamed.")


if __name__ == "__main__":
    main()
