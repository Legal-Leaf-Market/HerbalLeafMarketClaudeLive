/* HERBAL LEAF LOCAL — the shop registry.
 *
 * These are shops with a counter and no checkout. Everything on the national
 * shelf arrives from a feed; nothing here does, because these shops mostly do
 * not have one. See the Columbus radius audit: of eight independents inside a
 * thirty minute drive, three had a website at all and none had a readable
 * product feed.
 *
 * So this file is written by hand, and that is the point rather than a
 * shortcoming. It is the only honest way to list a shop that never went
 * online.
 *
 * TWO STATES PER SHOP, AND THE DIFFERENCE IS CONSENT:
 *
 *   listed: false   A directory entry. Name, address, hours, phone. This is
 *                   ordinary public information of the kind every local
 *                   directory carries, and it needs nobody's permission.
 *                   No products, no prices, no list, no commission.
 *
 *   listed: true    The shop has agreed. Products appear, a shopper can build
 *                   a list, and the QR at the end of it is worth money to us.
 *                   Nothing reaches this state without a conversation.
 *
 * The line between them is prices. Publishing a shop's name and hours is a
 * listing; publishing what they charge, gathered from inside their shop, is a
 * different act and needs their agreement first.
 *
 * `asOf` IS NOT DECORATION. Hand-entered prices go stale, and a stale price is
 * usually a LOW price, which means the shop that has not been walked in three
 * weeks ranks better than the one checked yesterday. Legal Leaf's Coldwater
 * page learned this the expensive way and prints a per-shop freshness stamp
 * for it. Same rule here: every listed shop carries the date its prices were
 * last confirmed, and the page shows it.
 */

/* Real shops, from the thirty minute audit. Directory entries only: not one of
 * these has been contacted about being listed, so not one of them has a single
 * product or price in this file. */
var LOCAL_SHOPS = [
  {
    id: "awoke", name: "Awoke", listed: false,
    town: "Columbus", state: "IN", stateName: "Indiana",
    address: "3447 W Jonathan Moore Pike, Columbus, IN 47201",
    carries: "Crystals, healing stones, herbs, candles and aromatherapy",
    asOf: "",
  },
  {
    id: "wood-fairy", name: "Wood Fairy Apothecary", listed: false,
    town: "Nashville", state: "IN", stateName: "Indiana",
    address: "84 S Van Buren St, Nashville, IN 47448",
    phone: "(812) 720-7037", web: "woodfairyapothecary.com",
    carries: "Small batch skincare, mood mist, and the Goblin Girl salves, balms, salts and sprays",
    hours: "Seven days, 10 to 5, and 10 to 6 Friday and Saturday",
    asOf: "",
  },
  {
    id: "crystal-source", name: "The Crystal Source", listed: false,
    town: "Nashville", state: "IN", stateName: "Indiana",
    address: "110 S Van Buren St, Nashville, IN 47448",
    carries: "Fossils, rocks and hand crafted jewellery",
    asOf: "",
  },
  {
    id: "redhead", name: "Redhead Apothecary", listed: false,
    town: "Nashville", state: "IN", stateName: "Indiana",
    address: "211 S Van Buren St, Suite L2A, Nashville, IN 47448",
    phone: "(812) 720-7018", web: "redheadapothecary.com",
    carries: "Celtic rooted bath and body made in Nashville, with plants, herbs and crystals",
    hours: "Closed Wednesdays",
    asOf: "",
  },
  {
    id: "bc-rock-shop", name: "Brown County Rock Shop", listed: false,
    town: "Nashville", state: "IN", stateName: "Indiana",
    web: "browncountyrockshop.com",
    carries: "Gemstones and fossils",
    asOf: "",
  },
  {
    id: "flower-herb-barn", name: "The Flower & Herb Barn", listed: false,
    town: "Nashville", state: "IN", stateName: "Indiana",
    address: "5171 Bean Blossom Rd, Nashville, IN 47448",
    phone: "(812) 988-7232",
    carries: "Country garden centre and farmhouse cafe. Herbs here are mostly living plants",
    hours: "Spring to first frost",
    asOf: "",
  },
  {
    id: "herbal-alternative", name: "The Herbal Alternative", listed: false,
    town: "Seymour", state: "IN", stateName: "Indiana",
    address: "2015 N Ewing St, Seymour, IN 47274",
    phone: "(812) 271-1850", web: "theherbalalternatives.com",
    carries: "Supplements from Emerald Labs, Nature's Sunshine and Nordic Naturals",
    asOf: "",
  },
  {
    id: "natura-wellness", name: "Natura Wellness", listed: false,
    town: "Franklin", state: "IN", stateName: "Indiana",
    address: "30 S Water St, Suite B, Franklin, IN 46131",
    carries: "Wellness. Whether this is a shop, a practice or both is not yet established",
    asOf: "",
  },

  /* A worked example, and labelled as one everywhere it appears.
   *
   * Without it there is nothing to click: no real shop has agreed yet, so the
   * list, the QR and the redemption have nothing to operate on and cannot be
   * shown to anybody. This shop is fictional, its prices are invented, and
   * every surface that renders it says so. It comes out the day a real shop
   * takes its place. */
  {
    id: "demo", name: "Sample Apothecary", listed: true, demo: true,
    town: "Columbus", state: "IN", stateName: "Indiana",
    address: "A shop that does not exist, in a town that does",
    carries: "An invented shelf, so the list and the pickup code can be tried out",
    hours: "Mon to Sat, 10 to 5:30",
    asOf: "2026-08-31",
  },
];

/* Products, per shop id. A shop with `listed: false` must have no entry here,
 * and localCheck() in local.js enforces that at load rather than trusting it. */
var LOCAL_PRODUCTS = {
  demo: [
    { id: "demo-nettle",     name: "Nettle Leaf, loose",        cat: "Bulk herbs",  price: 6.50,  size: "2 oz", note: "The one we reach for first for spring allergies." },
    { id: "demo-chamomile",  name: "Chamomile Flowers",         cat: "Bulk herbs",  price: 7.25,  size: "2 oz", note: "Whole flowers, not the dust in tea bags." },
    { id: "demo-elderberry", name: "Elderberries, whole",       cat: "Bulk herbs",  price: 9.00,  size: "4 oz", note: "" },
    { id: "demo-skullcap",   name: "Skullcap",                  cat: "Bulk herbs",  price: 8.75,  size: "1 oz", note: "" },
    { id: "demo-tulsi",      name: "Tulsi and Rose Tea",        cat: "Tea",         price: 12.95, size: "3 oz", note: "Our best seller, and the one people come back for." },
    { id: "demo-dandelion",  name: "Roasted Dandelion Root",    cat: "Tea",         price: 8.50,  size: "4 oz", note: "" },
    { id: "demo-magnesium",  name: "Magnesium Glycinate",       cat: "Supplements", price: 24.99, size: "120 ct", note: "Glycinate, not oxide. Ask us why before you buy the cheap one." },
    { id: "demo-d3",         name: "Vitamin D3 with K2",        cat: "Supplements", price: 19.95, size: "60 ct", note: "" },
    { id: "demo-salve",      name: "All Purpose Herbal Salve",  cat: "Topicals",    price: 14.00, size: "2 oz", note: "Made two towns over." },
    { id: "demo-arnica",     name: "Arnica Rub",                cat: "Topicals",    price: 16.50, size: "3 oz", note: "" },
  ],
};
