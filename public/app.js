/* HerbalLeafMarket - Storefront + Cart + Wishlist/Garden + Ritual v2 + Checkout + Tracking */
let PRODUCTS = [];
function getSeedProducts(){ return (typeof SEED_PRODUCTS!=="undefined"&&Array.isArray(SEED_PRODUCTS))?SEED_PRODUCTS.slice():[]; }

var SISTER_URL="https://legal-leafmarket.com";
var FACTS_URL="?page=facts";
var HLM_SHOP_URL="https://herballeafmarket.com";  /* email/button fallback */
const AWIN_PUBLISHER_ID = "3004653";
const BRAND_AFFILIATES = {
  "Bear Blend":{awinmid:"",ref:"JAC6375",couponCode:"JACOBKENNEDY",percent:10},
  "Puff Herbals":{awinmid:"74076",couponCode:"JACOBKENNEDY",percent:15},
  "Secret Nature":{awinmid:"",couponCode:"JACOBKENNEDY",percent:15},
  "Soul CBD":{awinmid:"",couponCode:"JACOBKENNEDY",percent:20},
  "Natural Smoke Shop":{awinmid:"",trackParam:{key:"tr",val:"138"},couponCode:"JACOBKENNEDY",percent:10},
  "Charlotte's Web":{awinmid:"",couponCode:"",percent:0}
};
function getCoupon(vendor){ var c=BRAND_AFFILIATES[vendor]; if(!c||!c.couponCode||!(c.percent>0))return null; return {code:c.couponCode,percent:c.percent}; }
function vendorCode(vendor){ var c=BRAND_AFFILIATES[vendor]; return (c&&c.couponCode)?c.couponCode:""; }
var SHIPPING={ "Bear Blend":{flat:6.95,freeOver:75},"Puff Herbals":{flat:5.99,freeOver:50},"Secret Nature":{flat:6.00,freeOver:50},"Soul CBD":{flat:5.95,freeOver:60},"Natural Smoke Shop":{flat:5.95,freeOver:35},"Charlotte's Web":{flat:5.99,freeOver:50} };
function shipInfo(vendor,after){ var s=SHIPPING[vendor]; if(!s) return {cost:0,free:true,freeOver:0}; var free=(s.freeOver>0&&after>=s.freeOver)||!(s.flat>0); return {cost:free?0:s.flat,free:free,freeOver:s.freeOver||0}; }
function appendParam(url,key,val){ if(!url||url==="#"||!/^https?:\/\//i.test(url)) return url; if(new RegExp("[?&]"+key+"=").test(url)) return url; return url+(url.indexOf("?")===-1?"?":"&")+key+"="+encodeURIComponent(val); }
function withAffiliate(product){ var base=(product&&product.url)?product.url:"#"; var cfg=BRAND_AFFILIATES[product.vendor];
  if(cfg && AWIN_PUBLISHER_ID && cfg.awinmid){ return "https://www.awin1.com/cread.php?awinmid="+encodeURIComponent(cfg.awinmid)+"&awinaffid="+encodeURIComponent(AWIN_PUBLISHER_ID)+"&ued="+encodeURIComponent(base); }
  if(cfg && cfg.ref){ return appendParam(base,"ref",cfg.ref); }
  if(cfg && cfg.trackParam && cfg.trackParam.key){ return appendParam(base,cfg.trackParam.key,cfg.trackParam.val); }
  return base; }
function hlmSiteOrigin(){ try{ return new URL(HLM_SHOP_URL).origin; }catch(e){ return "https://herballeafmarket.com"; } }
function hlmOutUrl(vendor,endUrl){ var dest=withAffiliate({vendor:vendor,url:endUrl}); if(!dest||dest==="#") dest=endUrl||HLM_SHOP_URL; return hlmSiteOrigin()+"/?go="+encodeURIComponent(dest)+"&ref=herballeafmarket"; }
function hlmHandleGo(){ var go=""; try{ var m=(window.location.search||"").match(/[?&]go=([^&]*)/); if(m&&m[1]) go=decodeURIComponent(m[1]); }catch(e){}
  if(!go||!/^https?:\/\//i.test(go)) return false;
  try{ document.cookie="hlm_ref=herballeafmarket;path=/;max-age=2592000"; }catch(e){}
  try{ if(typeof google!=="undefined"&&google.script&&google.script.run){ google.script.run.hlmLogClick({type:"garden-out",device:(isMobileDevice()?"mobile":"desktop"),page:"go",email:((getUser()||{}).email||""),product:go}); } }catch(e){}
  try{ window.location.replace(go); }catch(e){ window.location.href=go; } return true; }
/* Email "Add to Herbal Leaf Cart" deep link. Reads ?add=<id>::<variantId>,
   drops that exact line into CART, and signals hlmInit to open the drawer.
   Same guards as hlmHandleGo. Returns true if something was added. */
function hlmHandleAdd(){ var raw=""; try{ var m=(window.location.search||"").match(/[?&]add=([^&]*)/); if(m&&m[1]) raw=decodeURIComponent(m[1]); }catch(e){}
  if(!raw) return false;
  var key=raw, id=baseId(raw), p=productById(id); if(!p) return false;
  /* Fallback: bare id but product needs a size -> single variant, else drop-down default (SELV). */
  if(key.indexOf("::")===-1 && p.variants && p.variants.length){
    var v = p.variants.length===1 ? p.variants[0] : p.variants[parseInt(SELV[id],10)||0];
    if(v&&v.id) key=id+"::"+v.id;
  }
  CART[key]=(CART[key]||0)+1; saveCart();
  try{ if(typeof google!=="undefined"&&google.script&&google.script.run){ google.script.run.hlmLogClick({type:"garden-add",device:(isMobileDevice()?"mobile":"desktop"),page:"add",email:((getUser()||{}).email||""),product:key}); } }catch(e){}
  return true; }
function hlmImg(u){ if(!u) return u; if(u.indexOf("smokingblends.com")!==-1){ return "https://wsrv.nl/?url=ssl:"+u.replace(/^https?:\/\//,"")+"&w=648&h=648&fit=cover&output=webp"; } return u; }

var BB_IDS={"50-pack-original-herbal-cigarettes":239,"agarwood-rope-incense":240,"air-tea-kettle-dry-herb-vaporizer":412,"amazon":24,"amazon-chew":56,"amazon-herbal-cigarettes":198,"amazon-herbal-cigarettes-50-pack":243,"amazon-herbal-cigars":432,"amazon-liquid-herbz":37,"amazon-liquid-herbz-1ml-cartridge-clove":216,"amazon-liquid-herbz-2ml-disposable":208,"amazon-rolliez":32,"bear-blend":16,"black-sage-smudge-sticks-mini":303,"calendula-smokable-herbs-non-og":157,"dream-lodge":26,"dream-lodge-chew":59,"dream-lodge-herbal-cigarettes":135,"dream-lodge-herbal-cigarettes-50-pack":261,"dream-lodge-liquid-herbz":39,"dream-lodge-liquid-herbz-1ml-cartridge-coconut":218,"dream-lodge-liquid-herbz-2ml-disposable-coconut":210,"elements-rolling-papers":105,"flower-of-life":28,"frankincense-rope-incense":299,"hemp-prerolls":229,"herbal-cigarette-flower-of-life":187,"herbal-cigars":411,"herbal-cigars-3":433,"herbalicious":177,"hexahedron-concrete-incense-burner":226,"holiday-white-sage":93,"juniper-rope-incense":315,"kin-nik-nik":17,"kin-nik-nik-chew":55,"kin-nik-nik-herbal-cigarettes":174,"kin-nik-nik-herbal-cigarettes-50-pack":238,"kin-nik-nik-herbal-cigars":434,"kin-nik-nik-liquid-herbz":36,"kin-nik-nik-liquid-herbz-1ml-cartridge":215,"kin-nik-nik-liquid-herbz-2ml-disposable":207,"liquid-herbz-flower-of-life":123,"lobelia-smokable-herbs-non-og":163,"loose-cedar-bulk":180,"lovers-ritual-bundle":297,"mintz":18,"mintz-chew":61,"mintz-herbal-cigarettes":186,"mintz-herbal-cigarettes-50-pack":237,"mintz-herbal-cigars":436,"mintz-liquid-herbz":35,"mintz-liquid-herbz-1ml-cartridge-spearmint":219,"mintz-liquid-herbz-2ml-disposable-spearmint":211,"moon":27,"moon-chew":57,"moon-cigarettes-50-pack":462,"moon-herbal-cigarettes":137,"moon-herbal-cigars":435,"moon-liquid-herbz":40,"moon-liquid-herbz-1ml-cartridge-berry":220,"moon-liquid-herbz-2ml-disposable-berry":212,"nepali-desert-rose-rope-incense":317,"nepali-himalayan-cedar-rope-incense":241,"nepali-patchouli-rope-incense":305,"nepali-sai-baba-nag-champa-dhoop-rope-incense-copy":191,"nepali-sandalwood-rope-incense":190,"nepali-sandalwood-rope-incense-and-burner":183,"nepali-three-mixed-rope-incense":307,"nova-bubbler-attachment-stainless-steel-v2":227,"nova-carbon-black-v2":223,"nova-silver-v2":231,"og-bear-blend-chew":60,"og-bear-blend-liquid-herbz":34,"original-herbal-cigarettes":139,"original-herbal-cigars":437,"original-liquid-herbz-1ml-cartridge-vanilla":217,"original-liquid-herbz-2ml-disposable-vanilla":209,"palo-santo-rope-incense":311,"passion-flower-smokable-herbs":214,"quadrate-concrete-incense-burner":242,"raw-classic-pre-rolled-cone-6-piece":267,"raw-hemp-wick-10ft":179,"raw-rolling-machine-classic":188,"raw-rolling-papers":175,"raw-rolling-tips":189,"rolliez-flower-of-life-tubes-of-two":287,"shaman":54,"shaman-1ml-cartridge":440,"shaman-disposable":441,"shaman-herbal-cigarettes":141,"shaman-herbal-cigars":438,"shaman-rolliez-tube-of-2":443,"silver-510-thread-battery-variable-twist":228,"skullcap-smokable-herbs":293,"smokers-essentials-kit":195,"soapstone-smudge-bowl":184,"spikenard-rope-incense":313,"spiral-design-clay-rope-incense-burner":301,"tube-of-2-dream-lodge-rolliez":277,"tube-of-2-mintz-rolliez":275,"tube-of-two-amazon-rolliez":285,"tube-of-two-kin-nik-nik-rolliez":281,"tube-of-two-moon-rolliez":278,"tube-of-two-original-rolliez":279,"tube-of-two-vizion-rolliez":283,"vizion":25,"vizion-chew":58,"vizion-herbal-cigarettes":185,"vizion-herbal-cigarettes-50-pack":236,"vizion-herbal-cigars":439,"vizion-liquid-herbz":38,"vizion-liquid-herbz-1ml-cartridge-citrus":221,"vizion-liquid-herbz-2ml-disposable-citrus":213,"vizion-rolliez":29,"white-bear-claw-tin":197,"white-sage-cedar-large-smudge-stick-8-9-inch":309,"wildcrafted-sage-with-lavender-and-rosemary":77,"wooden-cobra-tripod-stand-for-smudge-bowl":225};
function bbIdFor(p){ if(p.bbId) return p.bbId; var m=(p.url||"").match(/\/product\/([^\/?#]+)/); return m?(BB_IDS[m[1]]||null):null; }

/* ---- PETS detector (routes pet items to a Pets category) ---- */
function isPet(p){ var h=((p.name||"")+" "+(p.blurb||"")+" "+(p.category||"")).toLowerCase();
  if(/cat'?s?\s*claw/.test(h)) return false;            /* "cat's claw" is an herb, not a pet item */
  if(/\b(pet|pets|dog|dogs|canine|feline|puppy|puppies|kitten|kittens|fur ?baby|four-?legged)\b/.test(h)) return true;
  if(/\bcats?\b/.test(h)) return true;                  /* cat / cats (cat's-claw already excluded) */
  if(/for (your )?(dog|cat|pet|pup)/.test(h)) return true;
  return false; }

const NONCONSUMABLE_PATTERN=/\b(glass(es|ware)?|pint glass|mug|tea ?cup|tea ?pot|teapot|infuser|kettle|strainer|lighter|matchbook|matches|pipe|bong|grinder|herb mill|rolling tray|tray|ashtray|poker|booklet|books?|journal|zine|sticker|magnet|button|pin|patch|tote|t-?shirt|\btee\b|apparel|hoodie|hat|beanie|keychain|merch|candles?|beeswax|hemp wick|\bwick\b|spice jar|apothecary jar|smudge bowl|tripod)\b/i;
function isNonConsumable(p){ return NONCONSUMABLE_PATTERN.test((p.name||"")+" "+(p.category||"")); }
function isWrap(p){ var n=(p.name||""); if(/herbal pre-?rolls?/i.test(n))return false; return /\b(rolling papers?|wraps?|pre-?roll cones?|roll-?up tips?|rolling tips?|\btips\b|filters?)\b/i.test(n)||/rose petal cone\b/i.test(n); }
function isPreRoll(p){ return /pre[- ]?rolls?/i.test((p.name||"")+" "+(p.blurb||"")); }
function isBundle(p){ var h=(p.name||"")+" "+(p.blurb||"")+" "+(p.category||""); if(/\b(bundle|trifecta|trio|flower of life|variety pack|build[- ]your[- ]own|carton|kit|packet|set of|starter kit|sampler)\b/i.test(h))return true; if(/\b\d+\s*(packs|tins|boxes)\b/i.test(h))return true; return false; }
function isTopical(p){ var h=(p.name||"")+" "+(p.category||""); if(/soft ?gel|capsule|\bpills?\b|tablet/i.test(h))return false; return /(roll[- ]?on|topical|balm|salve|lotion|cream|ointment|\bgel\b|\brub\b|muscle rub|body oil|relief stick)/i.test(h); }
function isGummy(p){ return /\bgummies?\b|\bgummy\b/i.test((p.name||"")+" "+(p.category||"")); }
function isHempFlower(p){ var n=(p.name||"").toLowerCase(), b=(p.blurb||"").toLowerCase(), hay=n+" "+b;
  if(/\b(cream|balm|salve|lotion|roll[- ]?on|softgel|soft gel|capsule|topical|cannex|gummies?|gummy|edible|tincture|\boil\b|drops?|vape|cartridge|disposable|pre-?rolls?|cigarettes?|cigs?|\bpod\b|battery|drink|soda|\btea\b|relief stick)\b/.test(n)) return false;
  if(/\b(hemp flower|cbd flower|hemp nugz?)\b/.test(hay)) return true;
  if(/\bflower\b/.test(n) && /\bcbd\b|\bhemp\b/.test(n)) return true; if(/\bstrain\b/.test(n)) return true; return false; }
function hasUnnegatedTHC(p){ var name=(p.name||""), blurb=(p.blurb||"");
  if(/\bthc\b/i.test(name) && !/\bthc[-\s]?free\b/i.test(name)) return true;
  if(/\b\d+\s*mg\s*thc\b/i.test(blurb)) return true;
  if(/\bthc\s+(soda|gummies|gummy|edible|beverage|drink|seltzer|chocolate)\b/i.test(blurb)) return true; return false; }
function isCBD(p){ if(p.vendor==="Bear Blend"||p.vendor==="Natural Smoke Shop") return false; if(hasUnnegatedTHC(p)) return false; if(isHempFlower(p)) return true;
  var hay=(p.name||"")+" "+(p.blurb||""); if(!/\bcbd\b/i.test(hay)) return false;
  var cleaned=hay.replace(/\b(no|non|without|zero|free of|free-of)\s+cbd\b/gi,"").replace(/\bcbd[-\s]?free\b/gi,""); return /\bcbd\b/i.test(cleaned); }
function isCBG(p){ return /\bcbg\b|cannabigerol/i.test((p.name||"")+" "+(p.blurb||"")); }
function isTea(p){ if(p.vendor!=="Natural Smoke Shop") return false; return (p.category==="Single Herbs"||p.category==="Herbal Blends"); }
function seriesKey(p){ var n=(p.name||"").toLowerCase();
  n=n.replace(/\bog bear blend\b/g,"original").replace(/\bog\b/g,"original").replace(/\bbear blend\b/g,"");
  n=n.replace(/\b(herbal|ceremonial|blend|cigarettes?|cigars?|rolliez|chew|liquid herbz?|diffuser|cartridge|disposable|2ml|1ml|50 ?pack|tube of (two|2)|tubes? of (two|2)|smokable herbs?|pre-?rolls?|flower|cbd|hemp|organic|full spectrum|full-spectrum|broad spectrum|the|with|and|a|of|-|\(|\)|indica|sativa|hybrid|vanilla|berry|clove|citrus|coconut|cherry|spearmint)\b/g," ");
  return n.replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim(); }
var SINGLE_HERB_PATTERN=/\b(burdock|butterfly pea|chamomile|dandelion|elderberr(y|ies)|hibiscus|peppermint|spearmint|field mint|skullcap|catnip|passion ?flower|calendula|red clover|clover|cloves?|\brose\b|roses|damiana|mullein|lavender|mugwort|blue lotus|blue water lily|red lotus|white lotus|yellow lotus|sacred lotus|lotus|reishi|cordyceps|lions? mane|chaga|marshmallow|uva ursi|lobelia|raspberry|nettle|hops|jasmine|wormwood|yerba|calea|perilla|klip dagga|great lettuce|wild lettuce|poppy)\b/i;
function isSingleHerb(p){ var n=(p.name||"");
  if(/\b(pre-?rolls?|cones?|cigarettes?|cigs?|rolliez|bundle|box|kit|trio|trifecta|sampler|pack|packet|carton|diffuser|cartridge|disposable|tincture|elixir|liquid herbz?|liquid|drops?|blend|tonic|capsule|softgel|gel|balm|roll[- ]?on|gummies?|gummy|hemp flower|cbd flower|nugz|strain|chew|grinder|jar|tray|mill|wick|poker)\b/i.test(n)) return false;
  return SINGLE_HERB_PATTERN.test(n); }
var DIFFUSER_SINGLE="Herbal Diffusers (Single-Use)";
function canonCategory(cat,name){ var c=(cat||"").toLowerCase(), n=(name||"").toLowerCase();
  if(/wholesale|bulk|general|all products|shop all|^\s*$/.test(c)){
    if(/\bchew\b/.test(n))return "Herbal Blends"; if(/roll-?up tips?|rolling tips?|rolling papers?|pre-?roll cones?/.test(n))return "Wraps";
    if(/hemp flower|cbd flower|hemp nugz?|\bstrain\b/.test(n))return "Hemp Flower"; if(/gummies?|gummy/.test(n))return "Gummies";
    if(/capsule|softgel|soft gel|pills?|tablet/.test(n))return "Pills"; if(/roll[- ]?on|topical|balm|salve|lotion|cream|ointment|\bgel\b|\brub\b/.test(n))return "Topicals";
    if(/cigarette|cigs?\b|pre-?roll|rolliez|cones?|smokes?/.test(n))return "Herbal Smokes"; if(/single-?use/.test(n))return DIFFUSER_SINGLE;
    if(/rechargeable|pod|battery|hardware|charger|510|diffuser|vape|disposable|cartridge|puffs/.test(n))return "Herbal Diffusers";
    if(/powder/.test(n))return "Powders"; if(/tincture|liquid herb|elixir|drops?/.test(n))return "Tinctures";
    if(/tea|matcha|chai|tonic|rooibos|concentrate|sachet|latte|drink/.test(n))return "Tea"; return "Herbal Blends"; }
  if(/\bchew\b/.test(n))return "Herbal Blends"; if(/roll-?up tips?|rolling tips?|rolling papers?|pre-?roll cones?/.test(n))return "Wraps";
  if(/hemp flower|cbd flower|hemp nugz?|\bstrain\b/.test(c))return "Hemp Flower"; if(/gummies?|gummy/.test(c))return "Gummies";
  if(/capsule|softgel|soft gel|pills?|tablet/.test(c))return "Pills"; if(/roll[- ]?on|topical|balm|salve|lotion|cream|ointment|\bgel\b|\brub\b/.test(c))return "Topicals";
  if(/cigarette|cigs?\b|pre-?roll|rolliez|herbal smokes?/.test(c))return "Herbal Smokes"; if(/single-?use/.test(c))return DIFFUSER_SINGLE;
  if(/rechargeable|pod|battery|hardware|charger|510|diffuser|vape|disposable|cartridge|puffs/.test(c))return "Herbal Diffusers";
  if(/tincture|liquid herb|elixir|extract|drops?/.test(c))return "Tinctures"; if(/\btea\b|matcha|chai|tonic|rooibos|kombucha|concentrate|sachet|latte|drink|beverage|sparkling/.test(c))return "Tea";
  if(/gift ?set|bundle|variety|sampler|trio|trifecta|kit|collection/.test(c))return "Bundles"; if(/powder/.test(c))return "Powders";
  if(/blend|loose.?leaf/.test(c))return "Herbal Blends"; if(/single herb|smok(e|able) herb|loose herb|botanical|flower/.test(c))return "Single Herbs";
  if(/gemstone|crystal|essence|energetic|misc|accessor|merch|glass|pipe/.test(c))return "Misc"; return cat||"Misc"; }
function classifyByName(p){ var n=(p.name||"").toLowerCase(), nd=n+" "+(p.blurb||"").toLowerCase();
  if(p.category===DIFFUSER_SINGLE || p.category==="Herbal Diffusers"){ if(/\b(battery|charger|hardware)\b/.test(nd)) return "Herbal Diffusers"; return p.category; }
  if(/\bchew\b/.test(n)) return "Herbal Blends"; if(/roll-?up tips?|rolling tips?|\btips\b|rolling papers?|pre-?roll cones?|filters?/.test(n)) return "Wraps";
  if(/\bgrinder\b|herb mill|rolling tray|spice jar|apothecary jar|\bpoker\b|hemp wick|smudge bowl|tripod/.test(n)) return "Misc";
  if(/\bsoftgels?\b|soft gel|\bcapsules?\b|\bpills?\b|\btablets?\b/.test(n)) return "Pills";
  if(/roll[- ]?on|topical|\bbalm\b|\bsalve\b|lotion|cream|ointment|\bgel\b|\brub\b|relief stick/.test(n)) return "Topicals";
  if(isHempFlower(p)) return "Hemp Flower"; if(/\bgummies?\b|\bgummy\b/.test(n)) return "Gummies";
  if(/\bbundle\b|\bsampler\b|\bgift ?set\b|\bcollection\b/.test(n) && !/free gift/.test(n)) return "Bundles";
  if(/\bincense\b|resin|frankincense|myrrh|sandalwood|agarwood|dragon.s blood|amber resin|frankinmyrrh/.test(nd)) return "Misc";
  if(/\b(gemstone|crystal|tourmaline|amethyst)\b/.test(nd)) return "Misc";
  if(/\b(liquid herbz?|elixir)\b/.test(n)) return "Tinctures"; if(/\btincture\b|oil drops?|oil tincture|\bcbd oil\b|hemp oil|hemp extract oil/.test(nd)) return "Tinctures";
  if(/\b(battery|charger|510 thread|510-thread|hardware)\b/.test(nd)) return "Herbal Diffusers"; if(/single-?use/.test(nd)) return DIFFUSER_SINGLE;
  if(/\b(rechargeable|pod kit|pods?\b)\b/.test(nd)) return "Herbal Diffusers"; if(/\bpuffs?\b|diffuser|aroma|disposable|cartridge|vape pen/.test(n)) return "Herbal Diffusers";
  if(/\byerba mate\b/.test(n)) return "Single Herbs";
  if(/\b(cigarettes?|cigs?|ciggies|filtered herbal)\b/.test(n)) return "Herbal Smokes";
  if(/smoking blend|smoking mixture|smokable tea|herbal shisha|shisha|coneheads|for cones/.test(nd)) return "Herbal Blends";
  if(/\bpowder\b/.test(n)) return "Single Herbs";
  if(isSingleHerb(p)) return "Single Herbs"; return null; }
function isDiffuserHardware(p){ return /\b(battery|charger|510 thread|510-thread|hardware)\b/.test(((p.name||"")+" "+(p.blurb||"")).toLowerCase()); }
function normalizeCategories(list){ (list||[]).forEach(function(p){
    if(typeof IMAGE_OVERRIDES!=="undefined"&&IMAGE_OVERRIDES[p.id]) p.image=IMAGE_OVERRIDES[p.id];
    p.category=canonCategory(p.category,p.name);
    var bn=classifyByName(p); if(bn) p.category=bn;
    var locked=(bn==="Herbal Smokes"||bn==="Tinctures"||bn==="Single Herbs"||bn==="Herbal Diffusers"||bn===DIFFUSER_SINGLE||bn==="Tea"||bn==="Bundles"||bn==="Pills"||bn==="Powders"||bn==="Topicals"||bn==="Gummies"||bn==="Hemp Flower"||bn==="Herbal Blends"||bn==="Wraps"||bn==="Misc");
    if(isHempFlower(p)) p.category="Hemp Flower"; else if(isGummy(p)) p.category="Gummies"; else if(isTopical(p)) p.category="Topicals"; else if(isWrap(p)) p.category="Wraps"; else if(isNonConsumable(p)&&p.category!=="Tinctures") p.category="Misc";
    if(!locked&&isPreRoll(p)&&["Misc","Wraps","Topicals","Gummies","Hemp Flower"].indexOf(p.category)===-1) p.category="Herbal Smokes";
    if(!locked&&isBundle(p)&&["Misc","Wraps","Topicals","Gummies","Hemp Flower"].indexOf(p.category)===-1) p.category="Bundles";
    if(p.category==="Tea"||p.category==="Beverages") p.category="Misc";
    if(/out of office|\bsoda\b|seltzer|sparkling|kombucha|\bcanned\b|beverage|\bdrinks?\b|tonic/i.test((p.name||"")+" "+(p.blurb||""))) p.category="Misc";
    if(isPet(p)) p.category="Pets";   /* final override: anything pet-related -> Pets */
  }); return list; }

/* ---- NSS live variation patch ---- */
var NSS_IDMAP={}; var NSS_FILL_WIN=null;
function nssSlug(p){ var m=(p.url||"").match(/\/product\/([^\/?#]+)/); return m?m[1]:null; }
function nssNormSize(s){ return String(s||"").toLowerCase().replace(/[-_]/g," ").replace(/\s+/g," ").trim(); }
function applyNSSIds(){ try{ if(!NSS_IDMAP||!Object.keys(NSS_IDMAP).length) return;
  PRODUCTS.forEach(function(p){ if(p.vendor!=="Natural Smoke Shop"||!p.variants) return; var slug=nssSlug(p); if(!slug) return; var list=NSS_IDMAP[slug]; if(!list||!list.length) return;
    p.variants.forEach(function(v){ var found=null,i;
      for(i=0;i<list.length;i++){ if(Math.abs((Number(list[i].price)||0)-(Number(v.price)||0))<0.01){ found=list[i]; break; } }
      if(!found){ var t=nssNormSize(v.title); for(i=0;i<list.length;i++){ if(nssNormSize(list[i].size)===t){ found=list[i]; break; } } }
      if(found&&found.id) v.wooId=found.id; }); }); }catch(e){} }
function collectNSSSlugs(){ var set={}; PRODUCTS.forEach(function(p){ if(p.vendor==="Natural Smoke Shop"){ var s=nssSlug(p); if(s) set[s]=1; } }); return Object.keys(set); }
function loadNSSIds(){ if(typeof google==="undefined"||!google.script||!google.script.run) return; var slugs=collectNSSSlugs(); if(!slugs.length) return;
  google.script.run.withSuccessHandler(function(map){ try{ if(map&&typeof map==="object"){ NSS_IDMAP=map; applyNSSIds(); renderCart(); } }catch(e){} }).withFailureHandler(function(){}).getSmokingBlendsIds(slugs); }

/* ---- Admin rules + matrix overrides ---- */
var HLM_RULES=null;
function loadMatrixRules(){ if(typeof google==="undefined"||!google.script||!google.script.run) return;
  google.script.run.withSuccessHandler(function(res){ try{ if(res){ HLM_RULES=res.rules||null; if(typeof hlmApplyMatrixOverrides==="function") hlmApplyMatrixOverrides(res.overrides||{}); } }catch(e){} }).withFailureHandler(function(){}).hlmGetMatrix(); }
function rule(k,def){ return (HLM_RULES && HLM_RULES[k]!==undefined)?HLM_RULES[k]:def; }

let activeCategory="All", activeStore="All", activeSort="featured";
function buildStoreFilter(){ var sel=document.getElementById("storeFilter"); if(!sel)return;
  var vendors=Array.from(new Set(PRODUCTS.filter(function(p){return p.inStock!==false&&!isExcluded(p);}).map(function(p){return p.vendor;}))); vendors.sort(function(a,b){return a.localeCompare(b);});
  var cur=sel.value||"All"; sel.innerHTML='<option value="All">All Stores</option>'+vendors.map(function(v){return '<option value="'+v+'">'+v+'</option>';}).join(""); sel.value=cur; }
function setStore(v){ activeStore=v; var sel=document.getElementById("storeFilter"); if(sel)sel.value=v; render(); }
function setSort(v){ activeSort=v; render(); }
const CATEGORY_ORDER=["Herbal Blends","Herbal Smokes","Herbal Diffusers","Herbal Diffusers (Single-Use)","Hemp Flower","Single Herbs","Tinctures","Topicals","Pills","Powders","Gummies","Tea","Beverages","Bundles","Wraps","Pets","Misc"];
function catRank(c){ if(c==="CBD")return -2; if(c==="Tea")return -1; var i=CATEGORY_ORDER.indexOf(c); return i===-1?500:i; }
function nssRank(p){ return p.vendor==="Natural Smoke Shop"?0:1; }
const EXCLUDE_PATTERN=/\b(thca|delta[\s-]?8|delta[\s-]?9|delta[\s-]?10|diet[\s-]?8|\bd8\b|\bd9\b|\bd10\b|\bhhc\b|thcv|thcp|courses?|class(es)?|workshops?|webinars?|masterclass|meditation club|membership|breath ?work|wim hof|consultations?|gift ?cards?|e-?gift|free gift|digital downloads?|videos?|savedby|package protection|sample pack|test [a-z0-9]\b)\b/i;
function isExcluded(p){ if(/\bwholesale\b/i.test(p.name||"")) return true; if(EXCLUDE_PATTERN.test((p.name||"")+" "+(p.category||""))) return true; if(hasUnnegatedTHC(p)) return true; return false; }
function orderedCategories(){ var live=PRODUCTS.filter(function(p){return p.inStock!==false&&!isExcluded(p)&&(Number(p.price)||0)>0;});
  var present=Array.from(new Set(live.map(function(p){return p.category;}))); present.sort(function(a,b){return catRank(a)-catRank(b)||a.localeCompare(b);});
  if(live.some(function(p){return isTea(p);})) present.unshift("Tea");
  if(live.some(function(p){return isCBD(p);})) present.unshift("CBD"); return present; }
function buildFilters(){ var box=document.getElementById("filters"); if(!box)return; var cats=["All"].concat(orderedCategories());
  var wn=wishCount(); var wchip=(wn>0)?('<div class="chip wish '+(activeCategory==="__wish"?"active":"")+'" onclick="setCategory(\'__wish\')">\u2764 My Garden ('+wn+')</div>'):"";
  box.innerHTML=wchip+cats.map(function(c){return '<div class="chip '+(c===activeCategory?'active':'')+'" onclick="setCategory(\''+c+'\')">'+c+'</div>';}).join(""); syncMobileCat(); }
function setCategory(c){ activeCategory=c; buildFilters(); render(); }
function updateCounts(filtered){ var el=document.getElementById("prodCounts"); if(!el)return; var total=0;
  PRODUCTS.forEach(function(p){ if(p.inStock===false||isExcluded(p)||(Number(p.price)||0)<=0)return; total++; });
  el.innerHTML='<strong>'+total+'</strong> total &middot; <strong>'+filtered+'</strong> shown'; }
function openMnav(){ var o=document.getElementById("mnavOverlay"),m=document.getElementById("mnav"); if(o)o.classList.add("open"); if(m)m.classList.add("open"); buildMobileNav(); }
function closeMnav(){ var o=document.getElementById("mnavOverlay"),m=document.getElementById("mnav"); if(o)o.classList.remove("open"); if(m)m.classList.remove("open"); }
function buildMobileNav(){ var cats=["All"].concat(orderedCategories()); var cw=document.getElementById("mnavCats");
  if(cw) cw.innerHTML=cats.map(function(c){return '<a class="mnav-link '+(c===activeCategory?'active':'')+'" onclick="setCategory(\''+c+'\');closeMnav();">'+c+'</a>';}).join("");
  var vendors=["All"].concat(Array.from(new Set(PRODUCTS.filter(function(p){return p.inStock!==false&&!isExcluded(p);}).map(function(p){return p.vendor;}))).sort());
  var sw=document.getElementById("mnavStores");
  if(sw) sw.innerHTML=vendors.map(function(v){return '<a class="mnav-link '+(v===activeStore?'active':'')+'" onclick="setStore(\''+(v==="All"?"All":v.replace(/'/g,"\\'"))+'\');closeMnav();">'+(v==="All"?"All Stores":v)+'</a>';}).join(""); }
function syncMobileCat(){ var sel=document.getElementById("mobileCat"); if(!sel)return; var cats=["All"].concat(orderedCategories());
  sel.innerHTML=cats.map(function(c){return '<option value="'+c+'"'+(c===activeCategory?' selected':'')+'>'+(c==="All"?"All Categories":c)+'</option>';}).join(""); }

/* ---- Wishlist ---- */
var WISH={};
function loadWish(){ try{WISH=JSON.parse(localStorage.getItem("hlm_wish"))||{};}catch(e){WISH={};} if(typeof WISH!=="object"||WISH===null)WISH={}; }
function saveWish(){ try{localStorage.setItem("hlm_wish",JSON.stringify(WISH));}catch(e){} }
function wishCount(){ return Object.keys(WISH).length; }
function isWished(id){ return !!WISH[baseId(id)]; }
function absUrl(u){ u=String(u||""); if(!u||u==="#") return ""; if(/^https?:\/\//i.test(u)) return u; if(u.charAt(0)==="/") return HLM_SHOP_URL+u; return u; }
function gardenItemSnapshot(id){ id=baseId(id); var p=productById(id); if(!p) return null;
  /* Capture the size the user actually chose in the drop-down (SELV[id]).
     For a multi-variant product this pins the SELECTED variant's id, title
     (the QUANTITY, e.g. "1 oz") and its real price — instead of the "from"
     base price. Falls back to the first variant (drop-down default) or, for
     single-price products, to p.unit. */
  var hasVars=p.variants&&p.variants.length;
  var sel=hasVars?(parseInt(SELV[p.id],10)||0):-1;
  var v=(hasVars&&p.variants[sel])?p.variants[sel]:(hasVars?p.variants[0]:null);
  var variantTitle=v?(v.title||""):((p.unit&&p.unit!=="from")?p.unit:"");
  var variantId=v?(v.id||""):"";
  var price=v?(Number(v.price)||0):(Number(p.price)||0);
  var raw=absUrl(p.url); var url = raw || absUrl(vendorOrigin(p.vendor)) || HLM_SHOP_URL;   /* never dead */
  return { id:p.id, name:p.name||"", vendor:p.vendor||"", price:price, unit:(v?"":(p.unit||"")), variant:variantTitle, variantId:variantId, image:hlmImg(p.image||""), url:hlmOutUrl(p.vendor,url), blurb:p.blurb||"", category:p.category||"" }; }
function gardenAllSnapshots(){ return Object.keys(WISH).map(gardenItemSnapshot).filter(Boolean); }
var _gardenPrompted=false;
function toggleWish(id){ id=baseId(id); var adding=!WISH[id]; if(adding) WISH[id]=1; else delete WISH[id]; saveWish();
  var btn=document.querySelector('.wish-btn[data-id="'+id+'"]'); if(btn){ btn.classList.toggle("on",adding); btn.setAttribute("aria-pressed",adding); }
  buildFilters(); if(activeCategory==="__wish") render();
  if(adding){ if(isLoggedIn()){ hlmToast("Saved \u2764 \u2014 we'll email your Garden alert"); gardenNotify(id); } else { hlmToast("Saved to My Garden \u2764"); gardenMaybePrompt(); } }
  else { hlmToast("Removed from My Garden"); } }
function gardenNotify(id){ if(typeof google==="undefined"||!google.script||!google.script.run) return; var u=getUser(); if(!u||!u.email) return;
  var it=gardenItemSnapshot(id); if(!it) return; google.script.run.withSuccessHandler(function(){}).withFailureHandler(function(err){ hlmToast("Couldn't send your Garden alert \u2014 I'll retry next save."); }).hlmWatchItem({email:u.email,name:u.name||"",item:it}); }
function gardenFlushWatches(){ try{ var u=getUser(); if(!u||!u.email) return; if(typeof google==="undefined"||!google.script||!google.script.run) return;
  gardenAllSnapshots().forEach(function(it){ if(!it) return; google.script.run.withSuccessHandler(function(){}).withFailureHandler(function(){}).hlmWatchItem({email:u.email,name:u.name||"",item:it}); }); }catch(e){} }
function gardenMaybePrompt(){ if(_gardenPrompted){ return; } _gardenPrompted=true; openGarden(); }
function openGarden(){ var n=wishCount(); var s=document.getElementById("gardenCount"); if(s)s.textContent=n+(n===1?" item":" items");
  var o=document.getElementById("gardenOverlay"),m=document.getElementById("gardenModal"); if(o)o.classList.add("open"); if(m)m.classList.add("open"); }
function closeGarden(){ var o=document.getElementById("gardenOverlay"),m=document.getElementById("gardenModal"); if(o)o.classList.remove("open"); if(m)m.classList.remove("open"); }
function gardenSignupSubmit(){
  var email=(document.getElementById("gEmail").value||"").trim(), name=(document.getElementById("gName").value||"").trim(), consent=document.getElementById("gConsent").checked, err=document.getElementById("gErr");
  if(!email||email.indexOf("@")===-1){ if(err){err.textContent="Please enter a valid email.";err.style.display="block";} return; }
  if(!consent){ if(err){err.textContent="Please check the box so we can email your Garden alerts.";err.style.display="block";} return; }
  if(err)err.style.display="none"; setUser({email:email,name:name||email.split("@")[0],joined:Date.now()});
  var items=gardenAllSnapshots();
  if(typeof google!=="undefined"&&google.script&&google.script.run){ google.script.run.withSuccessHandler(function(){}).withFailureHandler(function(){}).hlmCreateAccount({email:email,name:name,items:items,consent:true}); }
  closeGarden(); hlmToast("Garden saved \uD83C\uDF3F Check your email!"); }

let CART={}; let SELV={};
function loadCart(){ try{CART=JSON.parse(localStorage.getItem("hlm_cart"))||{};}catch(e){CART={};} if(typeof CART!=="object"||CART===null)CART={}; }
function saveCart(){ try{localStorage.setItem("hlm_cart",JSON.stringify(CART));}catch(e){} }
/* Persist the drop-down size choices so background re-sends (gardenFlushWatches)
   report the size the user actually picked, not the drop-down default.
   Same pattern/guards as hlm_cart & hlm_wish. */
function loadSelv(){ try{SELV=JSON.parse(localStorage.getItem("hlm_selv"))||{};}catch(e){SELV={};} if(typeof SELV!=="object"||SELV===null)SELV={}; }
function saveSelv(){ try{localStorage.setItem("hlm_selv",JSON.stringify(SELV));}catch(e){} }
function cartCount(){ var n=0; for(var k in CART)n+=CART[k]; return n; }
function baseId(lineKey){ return String(lineKey).split("::")[0]; }
function variantOfKey(lineKey){ var p=String(lineKey).split("::"); return p.length>1?p[1]:""; }
function productById(id){ id=baseId(id); return PRODUCTS.find(function(p){return p.id===id;}); }
function variantById(p,vid){ if(!p||!p.variants)return null; for(var i=0;i<p.variants.length;i++){ if(p.variants[i].id===vid) return p.variants[i]; } return null; }
function lineInfo(lineKey){ var p=productById(lineKey); if(!p)return {p:null,variantId:"",price:0,sizeTxt:"",wooId:""}; var vid=variantOfKey(lineKey); var v=vid?variantById(p,vid):null;
  var price=v?v.price:(Number(p.price)||0); var sizeTxt=v?v.title:((p.unit&&p.unit!=="from")?p.unit:""); var wooId=v&&v.wooId?v.wooId:(p.variants&&p.variants.length===1&&p.variants[0].wooId?p.variants[0].wooId:""); return {p:p,variantId:vid,price:price,sizeTxt:sizeTxt,wooId:wooId}; }
function cartItemsForVendor(v){ var o=[]; for(var k in CART){var p=productById(k);if(p&&p.vendor===v){var li=lineInfo(k);o.push({p:p,qty:CART[k],key:k,variantId:li.variantId,price:li.price,sizeTxt:li.sizeTxt,wooId:li.wooId});}} return o; }
function selVariant(id,idx){ SELV[id]=parseInt(idx,10)||0; saveSelv(); var p=productById(id); if(!p||!p.variants)return; var v=p.variants[SELV[id]];
  var el=document.getElementById("price-"+id); if(el&&v){ var cp=getCoupon(p.vendor); if(cp){var d=v.price*(1-cp.percent/100); el.innerHTML='<span style="text-decoration:line-through;color:var(--muted);font-weight:400;font-size:.85rem;margin-right:7px;">$'+v.price.toFixed(2)+'</span>$'+d.toFixed(2);} else { el.textContent="$"+v.price.toFixed(2); } } }
function addToCart(id){ var p=productById(id); var key=id;
  if(p&&p.variants&&p.variants.length>1){ var idx=SELV[id]||0; var v=p.variants[idx]; if(v&&v.id) key=id+"::"+v.id; }
  else if(p&&p.variants&&p.variants.length===1&&p.variants[0].id){ key=id+"::"+p.variants[0].id; }
  CART[key]=(CART[key]||0)+1; saveCart(); updateCartBadge(); renderCart(); hlmToast((p?p.name:"Item")+" added to your cart"); pulseCart(); }
function setQty(id,q){ q=parseInt(q,10); if(isNaN(q)||q<=0)delete CART[id]; else CART[id]=q; saveCart(); updateCartBadge(); renderCart(); }
function bumpQty(id,d){ setQty(id,(CART[id]||0)+d); }
function removeItem(id){ delete CART[id]; saveCart(); updateCartBadge(); renderCart(); }
function clearCart(){ CART={}; saveCart(); updateCartBadge(); renderCart(); }
function updateCartBadge(){ var b=document.getElementById("cartCount"); if(!b)return; var n=cartCount(); b.textContent=n; b.style.display=n>0?"flex":"none"; }
function openCart(){ var d=document.getElementById("cartDrawer"),o=document.getElementById("cartOverlay"); if(d)d.classList.add("open"); if(o)o.classList.add("open"); }
function closeCart(){ var d=document.getElementById("cartDrawer"),o=document.getElementById("cartOverlay"); if(d)d.classList.remove("open"); if(o)o.classList.remove("open"); }
let _tt=null;
function hlmToast(m){ var t=document.getElementById("hlmToast"),s=document.getElementById("hlmToastMsg"); if(!t)return; if(s)s.textContent=m; t.classList.add("show"); clearTimeout(_tt); _tt=setTimeout(function(){t.classList.remove("show");},3200); }
function pulseCart(){ var b=document.querySelector(".cart-btn"); if(!b)return; b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse"); }

function getUser(){ try{return JSON.parse(localStorage.getItem("hlm_user"));}catch(e){return null;} }
function setUser(u){ try{localStorage.setItem("hlm_user",JSON.stringify(u));}catch(e){} updateAccountUI(); }
function signOut(){ try{localStorage.removeItem("hlm_user");}catch(e){} updateAccountUI(); hlmToast("Signed out"); }
function isLoggedIn(){ var u=getUser(); return !!(u&&u.email); }
function updateAccountUI(){ var el=document.getElementById("acctLabel"); if(!el)return; var u=getUser(); el.textContent=(u&&u.name)?("Hi, "+u.name.split(" ")[0]):(u&&u.email?u.email:"Sign in"); }
let PENDING=null;
function requireLoginThen(fn){ if(isLoggedIn()){fn();return;} PENDING=fn; openAuth("You're one step from the garden gate"); }
function openAuth(sub){ var o=document.getElementById("authOverlay"),m=document.getElementById("authModal"),s=document.getElementById("authSub"); if(s&&sub)s.textContent=sub; if(o)o.classList.add("open"); if(m)m.classList.add("open"); }
function closeAuth(){ var o=document.getElementById("authOverlay"),m=document.getElementById("authModal"); if(o)o.classList.remove("open"); if(m)m.classList.remove("open"); PENDING=null; }
let AUTH_MODE="signup";
function setAuthMode(mode){ AUTH_MODE=mode; var nr=document.getElementById("authNameRow"),t=document.getElementById("authTitle"),s=document.getElementById("authSubmit"),tg=document.getElementById("authToggle");
  if(mode==="signup"){ if(nr)nr.style.display="block"; if(t)t.textContent="Create your account"; if(s)s.textContent="Create account & continue"; if(tg)tg.innerHTML="Already have an account? <a href='#' onclick=\"setAuthMode('login');return false;\">Sign in</a>"; }
  else { if(nr)nr.style.display="none"; if(t)t.textContent="Welcome back"; if(s)s.textContent="Sign in & continue"; if(tg)tg.innerHTML="New here? <a href='#' onclick=\"setAuthMode('signup');return false;\">Create an account</a>"; } }
function submitAuth(){ var email=(document.getElementById("authEmail").value||"").trim(),name=(document.getElementById("authName").value||"").trim(),err=document.getElementById("authErr");
  if(!email||email.indexOf("@")===-1){ if(err){err.textContent="Please enter a valid email.";err.style.display="block";} return; }
  if(AUTH_MODE==="signup"&&!name){ if(err){err.textContent="Please enter your name.";err.style.display="block";} return; }
  if(err)err.style.display="none"; setUser({email:email,name:name||email.split("@")[0],joined:Date.now()});
  gardenFlushWatches();
  hlmToast("Welcome, "+(name?name.split(" ")[0]:"friend")+"!");
  var o=document.getElementById("authOverlay"),m=document.getElementById("authModal"); if(o)o.classList.remove("open"); if(m)m.classList.remove("open");
  var fn=PENDING; PENDING=null; if(typeof fn==="function")setTimeout(fn,150); }

var SHOPIFY_VENDORS=["Puff Herbals","Secret Nature","Soul CBD","Charlotte's Web"];
var HOUSE_CODE="JACOBKENNEDY";
function copyCode(){ try{ navigator.clipboard && navigator.clipboard.writeText(HOUSE_CODE); }catch(e){} }
function copyText(t){ try{ if(navigator.clipboard){ navigator.clipboard.writeText(t); return true; } }catch(e){} return false; }
function hlmShare(title,text,url){ try{ if(navigator.share){ navigator.share(url?{title:title,text:text,url:url}:{title:title,text:text}).catch(function(){}); return true; } }catch(e){} copyText(text+(url?("\n"+url):"")); hlmToast("Cart list + code copied"); return false; }
function vendorOrigin(vendor){ var it=PRODUCTS.find(function(p){return p.vendor===vendor&&p.url;}); if(!it)return ""; try{return new URL(it.url).origin;}catch(e){return it.url;} }
function buildShopifyCheckoutUrl(vendor){ var origin=vendorOrigin(vendor)||HLM_SHOP_URL, items=cartItemsForVendor(vendor), code=vendorCode(vendor);
  var parts=items.map(function(x){ var vid=x.variantId||x.p.variantId; return vid?(encodeURIComponent(vid)+":"+x.qty):null; }).filter(function(x){return x;});
  if(parts.length) return origin+"/cart/"+parts.join(",")+(code?("?discount="+encodeURIComponent(code)):"");
  return code?(origin+"/discount/"+encodeURIComponent(code)+"?redirect=/cart"):(origin+"/cart"); }
function hlmTrack(type,extra){ try{ if(typeof google==="undefined"||!google.script||!google.script.run) return;
  var u=getUser()||{}; var pg=""; try{ pg=(window.location.search||"").replace(/^\?/,"")||"home"; }catch(e){}
  var payload={ type:type||"outbound", device:(isMobileDevice()?"mobile":"desktop"), page:pg, email:(u.email||""), ref:activeStore+"/"+activeCategory };
  if(extra){ for(var k in extra){ payload[k]=extra[k]; } }
  google.script.run.withSuccessHandler(function(){}).withFailureHandler(function(){}).hlmLogClick(payload);
}catch(e){} }
function trackVendorCheckout(vendor){ var items=cartItemsForVendor(vendor); var names=items.map(function(x){return x.p.name;}).slice(0,3).join(", ");
  var total=items.reduce(function(a,x){return a+(x.price*x.qty);},0); hlmTrack("checkout",{vendor:vendor,product:names+(items.length>3?" +"+(items.length-3):""),price:total,category:"cart"}); }
function doCheckout(vendor){ var items=cartItemsForVendor(vendor); if(!items.length)return; var code=vendorCode(vendor); if(code)copyCode();
  trackVendorCheckout(vendor); var isShop=SHOPIFY_VENDORS.indexOf(vendor)!==-1; var url=isShop?buildShopifyCheckoutUrl(vendor):(vendorOrigin(vendor)||HLM_SHOP_URL);
  hlmToast(isShop?("Cart sent to "+vendor+(code?(" - code "+code+" applied"):"")):("Opening "+vendor+(code?(" - code "+code+" copied"):"")));
  window.open(withAffiliate({vendor:vendor,url:url}),"_blank","noopener"); }
function checkoutVendor(v){ if(v==="Bear Blend"){ requireLoginThen(bearBlendCheckout); return; } if(v==="Natural Smoke Shop"){ requireLoginThen(naturalSmokeCheckout); return; } requireLoginThen(function(){ doCheckout(v); }); }

function isMobileDevice(){ return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent||""); }
function buildBearBlendBookmarklet(pairs){ var items=JSON.stringify(pairs);
  return "javascript:(function(){var ITEMS="+items+",CODE='"+HOUSE_CODE+"',AFF='herballeafmarket';"+
    "var t=(document.querySelector('meta[name=\\'csrf-token\\']')||{}).content||'';"+
    "if(!t){alert('Open bearblend.com first, then click this.');return;}"+
    "var b=document.createElement('div');b.style.cssText='position:fixed;top:16px;right:16px;z-index:999999;background:#1c1712;color:#8fe0a8;font:14px sans-serif;padding:14px 18px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.4)';b.textContent='Building your Herbal Leaf Market cart...';document.body.appendChild(b);"+
    "try{document.cookie='hlm_ref='+AFF+';path=/;max-age=2592000'}catch(e){}"+
    "function P(u,p){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':t,'X-Requested-With':'XMLHttpRequest','Accept':'application/json'},body:JSON.stringify(p)})}"+
    "function add(i){if(i>=ITEMS.length)return code();P('/cart/add',{product_id:ITEMS[i][0],quantity:ITEMS[i][1],ref:AFF}).then(function(r){return r.json()}).then(function(){b.textContent='Added '+(i+1)+'/'+ITEMS.length+'...';add(i+1)}).catch(function(){add(i+1)})}"+
    "function code(){b.textContent='Applying '+CODE+'...';if(window.bbCart&&window.bbCart.applyCode){Promise.resolve(window.bbCart.applyCode(CODE)).then(fin).catch(fin)}else{P('/cart/apply-code',{code:CODE}).then(fin).catch(fin)}}"+
    "function fin(){b.textContent='Done! Opening cart...';setTimeout(function(){location.href='/cart'},700)}add(0)})();"; }
function bearBlendCartPairs(){ var pairs=[], missing=0; for(var k in CART){ var p=productById(k); if(!p||p.vendor!=="Bear Blend")continue; var bid=bbIdFor(p); if(bid){pairs.push([bid,CART[k]]);}else{missing++;} } return { pairs:pairs, missing:missing }; }
function bearBlendMobileText(){ var items=cartItemsForVendor("Bear Blend"); return "Herbal Leaf Market - Bear Blend cart:\n"+items.map(function(x){return "- "+x.qty+"x "+x.p.name;}).join("\n")+"\n\nCoupon: "+HOUSE_CODE; }
function shareBearBlend(){ hlmShare("Bear Blend cart", bearBlendMobileText(), withAffiliate({vendor:"Bear Blend",url:"https://bearblend.com/shop"})); }
function bearBlendCheckout(){ var info=bearBlendCartPairs(); if(!info.pairs.length){ hlmToast("No Bear Blend items ready to send."); return; }
  copyCode(); trackVendorCheckout("Bear Blend");
  if(isMobileDevice()){ var items=cartItemsForVendor("Bear Blend"); copyText(bearBlendMobileText());
    var ml=document.getElementById("bbMobileList"); if(ml) ml.innerHTML=items.map(function(x){ var u=withAffiliate({vendor:"Bear Blend",url:(x.p.url||"https://bearblend.com/shop")}); return '<li><a href="'+u+'" target="_blank" rel="noopener">'+x.qty+'&times; '+x.p.name+' &nearr;</a></li>'; }).join("");
    var first=(items[0]&&items[0].p.url)?items[0].p.url:"https://bearblend.com/shop"; var go=document.getElementById("bbMobGo"); if(go) go.setAttribute("href", withAffiliate({vendor:"Bear Blend",url:first}));
    var mov=document.getElementById("bbMobOverlay"), mmd=document.getElementById("bbMobModal"); if(mov)mov.classList.add("open"); if(mmd)mmd.classList.add("open"); hlmToast("Your list + code "+HOUSE_CODE+" are copied."); return; }
  var bm=buildBearBlendBookmarklet(info.pairs); var link=document.getElementById("bbCoBookmarklet"); if(link) link.setAttribute("href", bm);
  var miss=document.getElementById("bbCoMissing"); if(miss){ miss.style.display=info.missing?"block":"none"; if(info.missing) miss.textContent=info.missing+" Bear Blend item(s) need a manual add."; }
  var ov=document.getElementById("bbCoOverlay"), md=document.getElementById("bbCoModal"); if(ov)ov.classList.add("open"); if(md)md.classList.add("open"); }
function closeBearBlendCheckout(){ var ov=document.getElementById("bbCoOverlay"),md=document.getElementById("bbCoModal"); if(ov)ov.classList.remove("open"); if(md)md.classList.remove("open"); }
function closeBearBlendMobile(){ var ov=document.getElementById("bbMobOverlay"),md=document.getElementById("bbMobModal"); if(ov)ov.classList.remove("open"); if(md)md.classList.remove("open"); }
function openBearBlendSite(){ window.open(withAffiliate({vendor:"Bear Blend",url:"https://bearblend.com/shop"}),"_blank","noopener"); }

function naturalSmokeCartItems(){ var out=[], missing=0; var items=cartItemsForVendor("Natural Smoke Shop");
  items.forEach(function(x){ var slug=nssSlug(x.p); if(!slug){ missing++; return; } var entry=[slug,x.qty]; if(x.sizeTxt) entry.push(x.sizeTxt); out.push(entry); }); return { items:out, missing:missing }; }
function buildNSSBookmarklet(items){ return "javascript:(function(){"+
  "var ITEMS="+JSON.stringify(items)+";var CODE='"+HOUSE_CODE+"';var AFF='herballeafmarket';var GOTO='/cart/';var API='/wp-json/wc/store/v1';"+
  "var box=document.createElement('div');box.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;background:#1c1712;color:#8fe0a8;font:14px sans-serif;padding:14px 18px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.4)';box.textContent='Building your Herbal Leaf Market cart...';document.body.appendChild(box);"+
  "try{document.cookie='hlm_ref='+AFF+';path=/;max-age=2592000';}catch(e){}"+
  "function cu(){try{var a=document.querySelector('a.cart-contents,a.wc-block-mini-cart__button,a[href*=\"/cart\"]');if(a&&a.getAttribute('href')){return a.href;}}catch(e){}return location.origin+GOTO;}"+
  "function g(u){return fetch(u,{credentials:'same-origin',headers:{'Accept':'application/json'}});}"+
  "function resolve(it){var slug=it[0],qty=it[1]||1,size=it[2];return g(API+'/products?slug='+encodeURIComponent(slug)).then(function(r){return r.json();}).then(function(a){var p=a&&a[0];if(!p){throw 'missing:'+slug;}if(p.type!=='variable'){return {id:p.id,quantity:qty};}var vs=p.variations||[];var v=null;if(size){v=vs.filter(function(x){return (x.attributes||[]).some(function(at){return String(at.value).toLowerCase()===String(size).toLowerCase();});})[0];}if(!v){v=vs[0];}if(!v){return {id:p.id,quantity:qty};}return {id:v.id,quantity:qty};});}"+
  "function addAll(nonce,list,i){if(i>=list.length){return applyCode(nonce);}var it=list[i];box.textContent='Adding '+(i+1)+'/'+list.length+'...';fetch(API+'/cart/add-item',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Nonce':nonce},body:JSON.stringify(it)}).then(function(r){return r.json().catch(function(){return {};});}).then(function(){addAll(nonce,list,i+1);}).catch(function(){addAll(nonce,list,i+1);});}"+
  "function applyCode(nonce){box.textContent='Applying '+CODE+'...';fetch(API+'/cart/apply-coupon',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Nonce':nonce},body:JSON.stringify({code:CODE})}).then(done).catch(done);}"+
  "function done(){box.textContent='Done! Opening cart...';setTimeout(function(){location.href=cu();},700);}"+
  "box.textContent='Finding '+ITEMS.length+' products...';"+
  "Promise.all(ITEMS.map(resolve)).then(function(list){return g(API+'/cart').then(function(r){return r.headers.get('Nonce')||r.headers.get('X-WC-Store-API-Nonce')||'';}).then(function(n){addAll(n,list,0);});}).catch(function(e){box.textContent='Error: '+e;});"+
  "})();"; }
function naturalSmokeMobileText(){ var items=cartItemsForVendor("Natural Smoke Shop"); return "Herbal Leaf Market - Natural Smoke Shop cart:\n"+items.map(function(x){return "- "+x.qty+"x "+x.p.name+(x.sizeTxt?(" ("+x.sizeTxt+")"):"");}).join("\n")+"\n\nCoupon: "+HOUSE_CODE; }
function shareNaturalSmoke(){ hlmShare("Natural Smoke Shop cart", naturalSmokeMobileText(), withAffiliate({vendor:"Natural Smoke Shop",url:"https://www.smokingblends.com/shop/"})); }
function nssRenderList(listId){ var items=cartItemsForVendor("Natural Smoke Shop"); var ml=document.getElementById(listId); if(!ml) return 0; var eligible=0;
  ml.innerHTML=items.map(function(x){ var base=(x.p.url||"https://www.smokingblends.com/shop/"); var u=withAffiliate({vendor:"Natural Smoke Shop",url:base}); var wid=x.wooId||""; if(wid) eligible++;
    var label=x.qty+'&times; '+x.p.name+(x.sizeTxt?(' &middot; '+x.sizeTxt):''); var right = wid ? '' : ' <a href="'+u+'" target="_blank" rel="noopener" style="color:var(--sage-dk);font-weight:600">(open &nearr;)</a>';
    return '<li style="list-style:none;margin:7px 0"><label style="display:flex;gap:9px;align-items:flex-start;cursor:pointer"><input type="checkbox" class="nss-pick" '+(wid?'checked':'')+' data-wid="'+wid+'" data-qty="'+x.qty+'" style="margin-top:3px;width:18px;height:18px;accent-color:#2f6b4f"><span>'+label+right+'</span></label></li>'; }).join(""); return eligible; }
function renderNSSMobileList(){ return nssRenderList("nssMobileList"); }
function nssToggleAll(ck,listId){ [].slice.call(document.querySelectorAll("#"+(listId||"nssMobileList")+" .nss-pick")).forEach(function(b){ if(b.getAttribute("data-wid")) b.checked=ck; }); }
function nssViewCart(){ var cartUrl=withAffiliate({vendor:"Natural Smoke Shop",url:"https://www.smokingblends.com/cart/"}); try{ if(NSS_FILL_WIN && !NSS_FILL_WIN.closed){ NSS_FILL_WIN.location.href=cartUrl; NSS_FILL_WIN.focus(); return; } }catch(e){} NSS_FILL_WIN=window.open(cartUrl,"hlmNSSfill"); try{ if(NSS_FILL_WIN) NSS_FILL_WIN.focus(); }catch(e){} }
function nssShowViewCart(){ ["nssMobViewCart","nssCoViewCart"].forEach(function(id){ var b=document.getElementById(id); if(b){ b.style.display="block"; } }); }
function nssAddAllSelected(listId){ var boxes=[].slice.call(document.querySelectorAll("#"+(listId||"nssMobileList")+" .nss-pick")); var chosen=boxes.filter(function(b){ return b.checked && b.getAttribute("data-wid"); });
  if(!chosen.length){ hlmToast("Tap an item's (open) link to add it manually."); return; }
  copyCode(); trackVendorCheckout("Natural Smoke Shop"); var origin="https://www.smokingblends.com";
  var urls=chosen.map(function(b){ return withAffiliate({vendor:"Natural Smoke Shop",url:origin+"/cart/?add-to-cart="+encodeURIComponent(b.getAttribute("data-wid"))+"&quantity="+encodeURIComponent(b.getAttribute("data-qty")||"1")}); });
  NSS_FILL_WIN=window.open(urls[0],"hlmNSSfill"); if(!NSS_FILL_WIN){ hlmToast("Allow pop-ups for this site, then tap the button again."); return; }
  try{ NSS_FILL_WIN.focus(); }catch(e){} hlmToast("Adding "+urls.length+" item(s) to Smoking Blends..."); var i=1, total=urls.length;
  (function step(){ if(i>=total){ nssShowViewCart(); return; } setTimeout(function(){ try{ NSS_FILL_WIN.location.href=urls[i]; }catch(e){} i++; step(); }, 2300); })(); if(total===1) nssShowViewCart(); }
function naturalSmokeCheckout(){ var info=naturalSmokeCartItems(); if(!info.items.length){ hlmToast("No Natural Smoke Shop items ready to send."); return; }
  copyCode(); trackVendorCheckout("Natural Smoke Shop");
  if(isMobileDevice()){ copyText(naturalSmokeMobileText()); var eligible=renderNSSMobileList(); var sa=document.getElementById("nssSelAll"); if(sa) sa.checked=true;
    var addBtn=document.getElementById("nssAddAllBtn"); if(addBtn){ if(eligible>0){ addBtn.style.display="block"; addBtn.textContent="\u26A1 Add "+eligible+" item(s) & go to cart"; } else { addBtn.style.display="none"; } }
    var hint=document.getElementById("nssAddAllHint"); if(hint){ hint.style.display=eligible>0?"none":"block"; }
    var vb=document.getElementById("nssMobViewCart"); if(vb) vb.style.display="none";
    var first=(cartItemsForVendor("Natural Smoke Shop")[0]||{}).p; first=(first&&first.url)?first.url:"https://www.smokingblends.com/shop/"; var go=document.getElementById("nssMobGo"); if(go) go.setAttribute("href", withAffiliate({vendor:"Natural Smoke Shop",url:first}));
    var mov=document.getElementById("nssMobOverlay"), mmd=document.getElementById("nssMobModal"); if(mov)mov.classList.add("open"); if(mmd)mmd.classList.add("open"); hlmToast("Your list + code "+HOUSE_CODE+" are copied."); return; }
  var bm=buildNSSBookmarklet(info.items); var link=document.getElementById("nssCoBookmarklet"); if(link) link.setAttribute("href", bm);
  var eligibleD=nssRenderList("nssCoList"); var sad=document.getElementById("nssCoSelAll"); if(sad) sad.checked=true;
  var addBtnD=document.getElementById("nssCoAddAllBtn"); if(addBtnD){ if(eligibleD>0){ addBtnD.style.display="block"; addBtnD.textContent="\u26A1 Add "+eligibleD+" item(s) & go to cart"; } else { addBtnD.style.display="none"; } }
  var vbd=document.getElementById("nssCoViewCart"); if(vbd) vbd.style.display="none";
  var miss=document.getElementById("nssCoMissing"); if(miss){ miss.style.display=info.missing?"block":"none"; if(info.missing) miss.textContent=info.missing+" item(s) couldn't be matched."; }
  var ov=document.getElementById("nssCoOverlay"), md=document.getElementById("nssCoModal"); if(ov)ov.classList.add("open"); if(md)md.classList.add("open"); }
function closeNaturalSmokeCheckout(){ var ov=document.getElementById("nssCoOverlay"),md=document.getElementById("nssCoModal"); if(ov)ov.classList.remove("open"); if(md)md.classList.remove("open"); }
function closeNaturalSmokeMobile(){ var ov=document.getElementById("nssMobOverlay"),md=document.getElementById("nssMobModal"); if(ov)ov.classList.remove("open"); if(md)md.classList.remove("open"); }
function openNaturalSmokeSite(){ window.open("https://www.smokingblends.com/shop/","_blank","noopener"); }

var _deferredInstall=null;
window.addEventListener("beforeinstallprompt", function(e){ e.preventDefault(); _deferredInstall=e; var b=document.getElementById("pwaInstall"); if(b)b.style.display="inline-flex"; });
function hlmInstallApp(){ if(_deferredInstall){ _deferredInstall.prompt(); _deferredInstall.userChoice.then(function(){ _deferredInstall=null; var b=document.getElementById("pwaInstall"); if(b)b.style.display="none"; }); } else { hlmToast("On iPhone: tap Share, then 'Add to Home Screen'."); } }
window.addEventListener("appinstalled", function(){ var b=document.getElementById("pwaInstall"); if(b)b.style.display="none"; });

function renderCart(){ var body=document.getElementById("cartBody"); if(!body)return; var ids=Object.keys(CART);
  if(!ids.length){ body.innerHTML='<div class="cart-empty"><svg width="40" height="46" style="opacity:.5;margin-bottom:10px"><use href="#lilyIcon"/></svg><p>Your cart is empty.</p><span>Gather a few botanicals and they will bloom here, grouped by maker.</span></div>'; return; }
  var groups={}; ids.forEach(function(k){ var p=productById(k); if(!p)return; (groups[p.vendor]=groups[p.vendor]||[]).push({p:p,qty:CART[k],key:k}); });
  var gO=0,gF=0,gShip=0,html="";
  Object.keys(groups).sort().forEach(function(vendor){ var coupon=getCoupon(vendor), vO=0, isShop=SHOPIFY_VENDORS.indexOf(vendor)!==-1;
    var rows=groups[vendor].map(function(it){ var p=it.p,qty=it.qty,key=it.key,li=lineInfo(key),line=li.price*qty; vO+=line;
      var img=p.image?'<img src="'+hlmImg(p.image)+'" alt="'+p.name+'" onerror="this.parentNode.innerHTML=\'<div class=cart-noimg></div>\'">':'<div class="cart-noimg"></div>';
      var sizeLbl=li.sizeTxt?(' <span>&middot; '+li.sizeTxt+'</span>'):""; var kEsc=key.replace(/'/g,"\\'");
      return '<div class="cart-item"><div class="cart-thumb">'+img+'</div><div class="cart-item-info"><div class="cart-item-name">'+p.name+'</div><div class="cart-item-price">$'+li.price.toFixed(2)+sizeLbl+'</div><div class="cart-qty"><button onclick="bumpQty(\''+kEsc+'\',-1)">-</button><input type="text" value="'+qty+'" onchange="setQty(\''+kEsc+'\',this.value)" /><button onclick="bumpQty(\''+kEsc+'\',1)">+</button><button class="cart-remove" onclick="removeItem(\''+kEsc+'\')">remove</button></div></div><div class="cart-line-total">$'+line.toFixed(2)+'</div></div>'; }).join("");
    var vF=coupon?vO*(1-coupon.percent/100):vO; gO+=vO; gF+=vF; var ship=shipInfo(vendor,vF); gShip+=ship.cost; var otd=vF+ship.cost;
    var bd='<div class="cart-bd"><div class="cart-bd-row"><span>Subtotal</span><span>$'+vO.toFixed(2)+'</span></div>';
    if(coupon) bd+='<div class="cart-bd-row save"><span>Code '+coupon.code+' ('+coupon.percent+'% off)</span><span>-$'+(vO-vF).toFixed(2)+'</span></div>';
    if(ship.free){ var near=(ship.freeOver>0)?' <span class="cart-bd-hint">(free over $'+ship.freeOver.toFixed(0)+')</span>':''; bd+='<div class="cart-bd-row"><span>Est. shipping'+near+'</span><span class="ship-free">FREE</span></div>'; }
    else { var away=ship.freeOver>0?(ship.freeOver-vF):0; var h2=(away>0)?' <span class="cart-bd-hint">(add $'+away.toFixed(2)+' for free ship)</span>':''; bd+='<div class="cart-bd-row"><span>Est. shipping'+h2+'</span><span>$'+ship.cost.toFixed(2)+'</span></div>'; }
    bd+='<div class="cart-bd-row otd"><span>Est. out-the-door</span><span>$'+otd.toFixed(2)+'</span></div></div>';
    var note=isShop?'<div class="cart-checkout-note">Cart auto-fills at '+vendor+(vendorCode(vendor)?(' with code '+vendorCode(vendor)+' applied'):'')+'.</div>':'<div class="cart-checkout-note">Opens '+vendor+(vendorCode(vendor)?(' with code '+vendorCode(vendor)+' copied'):'')+'.</div>';
    html+='<div class="cart-group"><div class="cart-group-head"><span class="cart-vendor">'+vendor+'</span></div>'+rows+bd+'<button class="cart-checkout" onclick="checkoutVendor(\''+vendor.replace(/'/g,"\\'")+'\')">Checkout at '+vendor+' &rarr;</button>'+note+'</div>'; });
  var acct=isLoggedIn()?"":'<p class="cart-login-note">A quick (free) Herbal Leaf Market sign-in is required at checkout - it keeps your cart together as you hand off to each maker.</p>';
  var gOTD=gF+gShip; var grand='<div class="cart-grand"><div class="cart-grand-row sm"><span>Items subtotal</span><span>$'+gO.toFixed(2)+'</span></div>';
  if(gF<gO) grand+='<div class="cart-grand-row sm save"><span>Coupon savings</span><span>-$'+(gO-gF).toFixed(2)+'</span></div>';
  grand+='<div class="cart-grand-row sm"><span>Est. shipping</span><span>'+(gShip>0?('$'+gShip.toFixed(2)):'FREE')+'</span></div>';
  grand+='<div class="cart-grand-row"><span>Est. out-the-door</span><span>$'+gOTD.toFixed(2)+'</span></div></div>';
  body.innerHTML=html+grand+acct+'<p class="cart-note">Totals are <strong>estimates</strong> including each maker\'s typical shipping &amp; your code. Final price (incl. tax &amp; exact shipping) shows at each maker\'s checkout.</p><button class="cart-clear" onclick="clearCart()">Empty cart</button>'; }

function cbdCrossBanner(){ return '<a class="xsell" href="'+SISTER_URL+'" target="_blank" rel="noopener" onclick="hlmTrack(\'sister-banner\',{vendor:\'Legal Leaf Market\',category:\'CBD\'})"><span class="xsell-emoji" aria-hidden="true"></span><span class="xsell-txt"><b>Want more &mdash; and more affordable &mdash; CBD?</b> Our sister shop <u>Legal Leaf Market</u> carries a wider CBD selection at friendlier prices.</span><span class="xsell-go">Visit Legal Leaf Market &rarr;</span></a>'; }
function cannaChip(p){ var label="",tip=""; if(isCBG(p)){ label="CBG"; tip="Cannabigerol - non-intoxicating. Early research suggests calming effects."; } else if(isCBD(p)){ label="CBD"; tip="Cannabidiol - non-intoxicating. FDA-approved (Epidiolex) for certain seizures."; } if(!label) return "";
  return '<a class="canna-chip" href="'+FACTS_URL+'" target="_top" title="'+tip+' Tap to learn more."><span class="ci">\u24D8</span> '+label+' &middot; non-intoxicating <span class="cl">learn</span></a>'; }
function injectProductLd(items){ var el=document.getElementById("hlmProductLd"); if(!el) return;
  var list=items.slice(0,40).map(function(p,i){ return {"@type":"ListItem","position":i+1,"item":{"@type":"Product","name":p.name||"","brand":{"@type":"Brand","name":p.vendor||""},"category":p.category||"","image":p.image||undefined,"offers":{"@type":"Offer","priceCurrency":"USD","price":(Number(p.price)||0).toFixed(2),"availability":(p.inStock===false?"https://schema.org/OutOfStock":"https://schema.org/InStock")}}}; });
  try{ el.textContent=JSON.stringify({"@context":"https://schema.org","@type":"ItemList","itemListElement":list}); }catch(e){} }

/* ========= BUILD YOUR RITUAL v2 (grounded + 3 bundles + thumbs + smart pairing) ========= */
var RITUAL_FB={};
function loadRitualFB(){ try{ RITUAL_FB=JSON.parse(localStorage.getItem("hlm_ritual_fb"))||{}; }catch(e){ RITUAL_FB={}; } if(typeof RITUAL_FB!=="object"||!RITUAL_FB) RITUAL_FB={}; }
function saveRitualFB(){ try{ localStorage.setItem("hlm_ritual_fb",JSON.stringify(RITUAL_FB)); }catch(e){} }
function K(){ return (typeof HLM_KNOWLEDGE!=="undefined")?HLM_KNOWLEDGE:null; }
function evidenceFloorRank(){ var k=K(); if(!k) return 0; var floor=rule("evidenceFloor","traditional"); return k.evidenceRank[floor]||1; }
function ritualGoalsAvailable(){ var k=K(); if(!k) return []; return Object.keys(k.goals).filter(function(g){ return k.goals[g].enabled!==false; }); }
/* products matching a compound (excludes Pets + non-consumables from wellness rituals) */
function productsForCompound(cid){ var k=K(); if(!k||!k.compounds[cid]) return []; var c=k.compounds[cid]; if(c.enabled===false) return [];
  var pref=rule("preferInStock",true);
  return PRODUCTS.filter(function(p){ if(isExcluded(p)||(Number(p.price)||0)<=0) return false; if(p.category==="Pets") return false; if(pref&&p.inStock===false) return false; return c.match.test((p.name||"")+" "+(p.blurb||"")+" "+(p.category||"")); }); }
function ritualEligible(goalKey){ var k=K(); if(!k||!k.goals[goalKey]) return []; var floor=evidenceFloorRank(); var out=[];
  k.goals[goalKey].compounds.forEach(function(cid){ var c=k.compounds[cid]; if(!c||c.enabled===false) return; var tier=c.goals[goalKey]; if(!tier) return;
    if((k.evidenceRank[tier]||1) < floor) return; var prods=productsForCompound(cid); if(!prods.length) return;
    out.push({ cid:cid, compound:c, tier:tier, rank:(k.evidenceRank[tier]||1), products:prods }); });
  return out; }
function ritualWeight(e){ var w=e.rank*2; var fb=RITUAL_FB[e.cid]||0; w+=fb*3; if(w<0.2) w=0.2; return w; }
function weightedPick(list){ var tot=0,i; for(i=0;i<list.length;i++) tot+=list[i]._w; var r=Math.random()*tot; for(i=0;i<list.length;i++){ r-=list[i]._w; if(r<=0) return list[i]; } return list[list.length-1]; }
/* "logically go together" = pick distinct compounds AND diversify product FORM (category):
   a consumable helper + a complementary herb + a ritual object where possible. */
function ritualProductFor(e, usedProd, usedCat){
  var avail=e.products.filter(function(p){ return !usedProd[p.id]; }); if(!avail.length) avail=e.products;
  var fresh=avail.filter(function(p){ return !usedCat[p.category]; });          /* prefer a new form/category */
  var pool=fresh.length?fresh:avail;
  pool=pool.slice().sort(function(a,b){ return (Number(a.price)||0)-(Number(b.price)||0); });  /* keep it affordable */
  var idx=Math.min(pool.length-1, Math.floor(Math.random()*Math.min(3,pool.length)));           /* small variety */
  return pool[idx]||pool[0]; }
/* wrap "teach it" preference: starts high ("most of the time"), customer trains it down/up */
var WRAP_BASE_FREQ=0.72;
function wrapFB(){ var v=RITUAL_FB["__wrap"]; return (typeof v==="number")?v:0; }
function ritualWrapProb(){ var p=WRAP_BASE_FREQ + wrapFB()*0.1; if(p<0.05)p=0.05; if(p>0.95)p=0.95; return p; }
function ritualWrapProducts(){ var pref=rule("preferInStock",true); return PRODUCTS.filter(function(p){ if(isExcluded(p)||(Number(p.price)||0)<=0) return false; if(p.category==="Pets") return false; if(pref&&p.inStock===false) return false; return isWrap(p); }); }
function ritualPickWrap(usedProd){ var pool=ritualWrapProducts().filter(function(p){return !usedProd[p.id];}); if(!pool.length) return null;
  pool=pool.slice().sort(function(a,b){ return (Number(a.price)||0)-(Number(b.price)||0); }); var idx=Math.min(pool.length-1,Math.floor(Math.random()*Math.min(3,pool.length))); return pool[idx]||pool[0]; }
function ritualBuildBundle(goalKey,n){ var elig=ritualEligible(goalKey); if(!elig.length) return null;
  elig.forEach(function(e){ e._w=ritualWeight(e); });
  var pool=elig.slice(), picks=[], usedProd={}, usedCat={};
  var wantWrap=(Math.random()<ritualWrapProb()) && ritualWrapProducts().length>0;
  var slots=wantWrap?(n-1):n;
  for(var s=0; s<slots && pool.length; s++){ var e=weightedPick(pool); pool=pool.filter(function(x){return x!==e;});
    var prod=ritualProductFor(e, usedProd, usedCat); if(!prod) continue; usedProd[prod.id]=1; usedCat[prod.category]=1; picks.push({ cid:e.cid, compound:e.compound, tier:e.tier, p:prod }); }
  if(wantWrap){ var w=ritualPickWrap(usedProd); if(w){ usedProd[w.id]=1; picks.push({ wrap:true, p:w }); } }
  return picks.length?picks:null; }
function tierClass(t){ return "tier-"+t; }
var _ritualGoal=null, _ritualBundles=[];
function openRitual(){ loadRitualFB(); var m=document.getElementById("ritualModal"),o=document.getElementById("ritualOverlay"); if(o)o.classList.add("open"); if(m)m.classList.add("open"); ritualShowGoals(); hlmTrack("ritual-open"); }
function closeRitual(){ var m=document.getElementById("ritualModal"),o=document.getElementById("ritualOverlay"); if(o)o.classList.remove("open"); if(m)m.classList.remove("open"); }
function ritualShowGoals(){ var b=document.getElementById("ritualBody"); if(!b) return; _ritualGoal=null; _ritualBundles=[];
  var k=K(); if(!k){ b.innerHTML='<p class="ritual-lead">Knowledge base still loading&hellip; try again in a moment.</p>'; return; }
  var goals=ritualGoalsAvailable();
  b.innerHTML='<p class="ritual-lead">What are you looking for today? Every suggestion is grounded in our <a href="'+FACTS_URL+'" target="_top">evidence library</a>.</p><div class="ritual-goals">'+
    goals.map(function(g){ var G=k.goals[g]; return '<button class="ritual-goal" onclick="ritualChoose(\''+g+'\')"><span class="rg-emoji">'+G.emoji+'</span><span class="rg-t">'+G.title+'</span><span class="rg-s">'+G.blurb+'</span></button>'; }).join("")+'</div>'; }
function ritualChoose(goalKey){ _ritualGoal=goalKey; hlmTrack("ritual-goal",{category:goalKey}); ritualRegenerate(); }
function ritualRegenerate(){ var goalKey=_ritualGoal; var k=K(); if(!goalKey||!k) return; var n=3; /* locked to 3 items per bundle (wrap counts as one slot) */
  _ritualBundles=[]; var attempts=0; while(_ritualBundles.length<3 && attempts<14){ attempts++; var bundle=ritualBuildBundle(goalKey,n);
    if(bundle){ var sig=bundle.map(function(x){return x.p.id;}).sort().join("|"); var dupe=_ritualBundles.some(function(bd){ return bd.map(function(x){return x.p.id;}).sort().join("|")===sig; }); if(!dupe) _ritualBundles.push(bundle); } }
  ritualRender(); }
function ritualRender(){ var b=document.getElementById("ritualBody"); var k=K(); if(!b||!k) return; var G=k.goals[_ritualGoal];
  if(!_ritualBundles.length){ b.innerHTML='<div class="ritual-head2"><button class="ritual-back" onclick="ritualShowGoals()">&larr;</button><h4>'+G.emoji+' '+G.title+'</h4></div><p class="ritual-lead">Inventory is thin for this goal at your current evidence setting. Try another goal, or lower the evidence floor in Admin.</p>'; return; }
  var showBadge=rule("showEvidenceBadges",true), crossCBD=rule("crossSellCBD",true);
  var head='<div class="ritual-head2"><button class="ritual-back" onclick="ritualShowGoals()">&larr;</button><h4>'+G.emoji+' '+G.title+'</h4></div><p class="ritual-lead" style="margin:0 0 12px">'+G.ritual+' &mdash; here are 3 options. \uD83D\uDC4D / \uD83D\uDC4E to tune, then add your favorite.</p>';
  var cards=_ritualBundles.map(function(bundle,bi){ var total=0,coup=0;
    var items=bundle.map(function(x,ii){ var p=x.p; var cp=getCoupon(p.vendor); var price=Number(p.price)||0; var disc=cp?price*(1-cp.percent/100):price; total+=disc; if(cp)coup+=(price-disc);
      var img=p.image?'<img src="'+hlmImg(p.image)+'" alt="'+p.name+'" width="54" height="54" style="width:54px;height:54px;object-fit:cover;border-radius:9px;border:1px solid var(--line)" onerror="this.style.display=\'none\'">':'<div style="width:54px;height:54px;border-radius:9px;background:#eef0e2"></div>';
      var xbtn='<button class="ritual-x" title="Not this one \u2014 teach my ritual" onclick="ritualXItem('+bi+','+ii+')">&times;</button>';
      if(x.wrap){ return '<div class="ritual-item">'+xbtn+'<div>'+img+'</div><div class="ritual-info"><div class="ritual-name">'+p.name+'</div><div class="ritual-vendor">'+p.vendor+' <span class="ev-badge tier-traditional">wrap</span></div><div class="ritual-claim">Papers &amp; wraps to roll your ritual &mdash; added by default. Tap \u00d7 to teach fewer wraps.</div></div></div>'; }
      var badge=showBadge?'<span class="ev-badge '+tierClass(x.tier)+'">'+(x.compound.tierLabel||x.tier)+'</span>':'';
      var xs=(crossCBD&&isCBD(p))?'<a class="ritual-xs" href="'+SISTER_URL+'" target="_blank" rel="noopener" onclick="hlmTrack(\'sister-ritual\',{vendor:\'Legal Leaf Market\'})">more CBD \u2197</a>':'';
      return '<div class="ritual-item">'+xbtn+'<div>'+img+'</div><div class="ritual-info"><div class="ritual-name">'+p.name+'</div><div class="ritual-vendor">'+p.vendor+' '+badge+'</div><div class="ritual-claim">'+(x.compound.structureFn||"")+'</div><div class="ritual-cite">'+(x.compound.label||"")+' &middot; '+(x.compound.cite||"")+'</div>'+xs+'</div></div>'; }).join("");
    return '<div class="ritual-bundle"><div class="rb-head"><span class="rb-num">Option '+(bi+1)+'</span><div class="rb-vote"><button class="vote up" title="More like this" onclick="ritualVote('+bi+',1)">\uD83D\uDC4D</button><button class="vote down" title="Less like this" onclick="ritualVote('+bi+',-1)">\uD83D\uDC4E</button></div></div>'+items+'<div class="ritual-total"><span>Bundle'+(coup>0?' <span class="ritual-save">(save $'+coup.toFixed(2)+')</span>':'')+'</span><span>$'+total.toFixed(2)+'</span></div><button class="ritual-add" onclick="ritualAddBundle('+bi+')">Add this ritual to cart \uD83C\uDF3F</button></div>'; }).join("");
  b.innerHTML=head+'<div class="ritual-bundles">'+cards+'</div><button class="ritual-shuffle" onclick="ritualRegenerate()">\u21bb Shuffle all three</button><p class="ritual-fine">Educational, not medical advice. Statements not evaluated by the FDA. Items ship from each maker; final price &amp; shipping show at their checkout.</p>'; }
function ritualVote(bundleIdx,dir){ var bundle=_ritualBundles[bundleIdx]; if(!bundle) return;
  bundle.forEach(function(x){ if(x.wrap){ RITUAL_FB["__wrap"]=Math.max(-6,Math.min(6,wrapFB()+dir)); return; } if(!x.cid) return; RITUAL_FB[x.cid]=(RITUAL_FB[x.cid]||0)+dir; if(RITUAL_FB[x.cid]>6)RITUAL_FB[x.cid]=6; if(RITUAL_FB[x.cid]<-3)RITUAL_FB[x.cid]=-3; });
  saveRitualFB(); hlmTrack(dir>0?"ritual-up":"ritual-down",{category:_ritualGoal, product:bundle.map(function(x){return x.wrap?"wraps":(x.compound&&x.compound.label);}).join(", ")});
  hlmToast(dir>0?"More like this \uD83D\uDC4D updating picks\u2026":"Noted \uD83D\uDC4E fewer of those\u2026"); ritualRegenerate(); }
/* item-level teach: x down-weights that compound (or wraps) and re-rolls this option */
function ritualXItem(bundleIdx,idx){ var bundle=_ritualBundles[bundleIdx]; if(!bundle) return; var x=bundle[idx]; if(!x) return;
  if(x.wrap){ RITUAL_FB["__wrap"]=Math.max(-6,wrapFB()-1); hlmToast("Got it \u2014 fewer wraps from now on \uD83C\uDF3F"); }
  else if(x.cid){ RITUAL_FB[x.cid]=(RITUAL_FB[x.cid]||0)-2; if(RITUAL_FB[x.cid]<-3)RITUAL_FB[x.cid]=-3; hlmToast("Noted \u2014 less of that in your rituals"); }
  saveRitualFB(); hlmTrack("ritual-x",{category:_ritualGoal, product:(x.p&&x.p.name)||""});
  var n=3, replacement=null, tries=0;
  while(!replacement && tries<10){ tries++; var bnew=ritualBuildBundle(_ritualGoal,n); if(!bnew) break; var sig=bnew.map(function(y){return y.p.id;}).sort().join("|");
    var dupe=_ritualBundles.some(function(bd,bx){ return bx!==bundleIdx && bd.map(function(y){return y.p.id;}).sort().join("|")===sig; }); if(!dupe) replacement=bnew; }
  if(replacement) _ritualBundles[bundleIdx]=replacement; ritualRender(); }
function ritualAddBundle(bundleIdx){ var bundle=_ritualBundles[bundleIdx]; if(!bundle) return;
  bundle.forEach(function(x){ addToCart(x.p.id); if(x.wrap){ RITUAL_FB["__wrap"]=Math.min(6,wrapFB()+1); } else if(x.cid){ RITUAL_FB[x.cid]=(RITUAL_FB[x.cid]||0)+2; if(RITUAL_FB[x.cid]>6)RITUAL_FB[x.cid]=6; } }); saveRitualFB();
  hlmTrack("ritual-add",{category:_ritualGoal, product:bundle.map(function(x){return x.p.name;}).join(", "), price:bundle.reduce(function(a,x){return a+(Number(x.p.price)||0);},0)});
  closeRitual(); openCart(); }

function render(){
  var grid=document.getElementById("grid"); if(!grid)return;
  var se=document.getElementById("search"), q=(se&&se.value?se.value:"").toLowerCase().trim(); var wishMode=(activeCategory==="__wish");
  var items=PRODUCTS.filter(function(p){ if(isExcluded(p))return false; if((Number(p.price)||0)<=0)return false; if(p.inStock===false)return false;
    if(wishMode && !isWished(p.id))return false; if(activeStore!=="All"&&p.vendor!==activeStore)return false;
    var catOk=wishMode||activeCategory==="All"||p.category===activeCategory||(activeCategory==="CBD"&&isCBD(p))||(activeCategory==="Tea"&&isTea(p));
    var qOk=!q||((p.name||"")+(p.blurb||"")+(p.vendor||"")+(p.category||"")).toLowerCase().indexOf(q)!==-1; return catOk&&qOk; });
  var num=function(p){ return Number(p.price)||0; }; var hwRank=function(p){ return isDiffuserHardware(p)?0:1; };
  if(activeSort==="cheapest"){ items.sort(function(a,b){ return nssRank(a)-nssRank(b)||num(a)-num(b); }); }
  else if(activeSort==="highest"){ items.sort(function(a,b){ return nssRank(a)-nssRank(b)||num(b)-num(a); }); }
  else if(activeSort==="az"){ items.sort(function(a,b){ return nssRank(a)-nssRank(b)||(a.name||"").localeCompare(b.name||""); }); }
  else { items.sort(function(a,b){ return catRank(a.category)-catRank(b.category)||(a.category||"").localeCompare(b.category||"")||nssRank(a)-nssRank(b)||(a.vendor||"").localeCompare(b.vendor||"")||hwRank(a)-hwRank(b)||seriesKey(a).localeCompare(seriesKey(b))||(a.name||"").localeCompare(b.name||""); }); }
  var showHeaders=(!wishMode&&activeSort==="featured"&&activeStore==="All"&&activeCategory==="All"); updateCounts(items.length); injectProductLd(items);
  if(!items.length){ grid.innerHTML=wishMode?'<div class="empty">Your Garden is empty &mdash; tap the \u2764 on any product to save it here.</div>':'<div class="empty">No botanicals found. Try another whisper.</div>'; return; }
  var lastCat=null; var showXsell=(activeCategory==="CBD");
  var body=items.map(function(p){ var header=""; if(showHeaders&&p.category!==lastCat){ lastCat=p.category; header='<h2 class="cat-header"><span>'+p.category+'</span></h2>'; }
    var orig=Number(p.price)||0, coupon=getCoupon(p.vendor), priceHtml, couponHtml="";
    var fromTxt=(p.unit==="from")?'<span style="font-size:.7rem;color:var(--muted);font-family:var(--script);font-style:italic;margin-right:4px;">from</span>':"";
    if(coupon){ var disc=orig*(1-coupon.percent/100); priceHtml='<span class="price" id="price-'+p.id+'">'+fromTxt+'<span style="text-decoration:line-through;color:var(--muted);font-weight:400;font-size:.85rem;margin-right:7px;">$'+orig.toFixed(2)+'</span>$'+disc.toFixed(2)+'</span>'; couponHtml='<div class="coupon-pill">'+coupon.percent+'% off with code <strong>'+coupon.code+'</strong></div>'; }
    else { priceHtml='<span class="price" id="price-'+p.id+'">'+fromTxt+'$'+orig.toFixed(2)+'</span>'; }
    var unitTxt=(p.unit&&p.unit!=="from")?p.unit:""; var ph='<div class="thumb-ph"><svg class="ph-lily"><use href="#lilyIcon"/></svg><span>'+p.name+'</span></div>';
    var imgHtml=p.image?'<img src="'+hlmImg(p.image)+'" alt="'+p.name+'" width="600" height="600" loading="lazy" decoding="async" onerror="this.parentNode.classList.add(\'noimg\'); this.remove();" />'+ph:'<div class="noimg-wrap">'+ph+'</div>';
    var sizeHtml=""; if(p.variants&&p.variants.length>1){ var sel=SELV[p.id]||0; sizeHtml='<select class="size-sel" onchange="selVariant(\''+p.id+'\',this.value)" aria-label="Choose size">'+p.variants.map(function(v,i){var lbl=(v.title||("Option "+(i+1)))+" - $"+(Number(v.price)||0).toFixed(2)+(v.available===false?" (sold out)":"");return '<option value="'+i+'"'+(i===sel?" selected":"")+(v.available===false?" disabled":"")+'>'+lbl+'</option>';}).join("")+'</select>'; }
    var wcls=isWished(p.id)?" on":""; var wbtn='<button class="wish-btn'+wcls+'" data-id="'+p.id+'" aria-pressed="'+isWished(p.id)+'" aria-label="Save to My Garden" onclick="event.stopPropagation();toggleWish(\''+p.id+'\')"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.2C.5 8.3 2.2 5 5.5 5c2 0 3.3 1.2 4 2.2C10.2 6.2 11.5 5 13.5 5 16.8 5 18.5 8.3 17 11.8 14.5 16.4 12 21 12 21z"/></svg></button>';
    var canna=cannaChip(p);
    var xtag = isCBD(p) ? '<a class="cbd-xtag" href="'+SISTER_URL+'" target="_blank" rel="noopener" title="More CBD options &amp; better prices at Legal Leaf Market" onclick="hlmTrack(\'sister-card\',{vendor:\'Legal Leaf Market\',product:'+JSON.stringify(p.name)+',category:\'CBD\'})">More CBD &amp; better prices at our sister shop \u2197</a>' : "";
    return header+'<article class="card" id="'+p.id+'" data-id="'+p.id+'"><div class="thumb">'+(p.badge?'<span class="badge">'+p.badge+'</span>':"")+wbtn+imgHtml+'</div><div class="card-body"><div class="vendor">'+p.vendor+'</div><h3>'+p.name+'</h3>'+(canna?('<div class="canna-wrap">'+canna+'</div>'):"")+'<p class="blurb">'+p.blurb+'</p><div class="meta">'+priceHtml+'<span class="unit">'+unitTxt+'</span></div>'+couponHtml+sizeHtml+'<button class="add-cart" onclick="addToCart(\''+p.id+'\')">Add to Herbal Leaf Market Cart</button>'+xtag+'</div></article>'; }).join("");
  grid.innerHTML=(showXsell?cbdCrossBanner():"")+body;
  try{ document.dispatchEvent(new CustomEvent("hlm:render",{detail:{count:items.length,inventoryLoaded:!!window.__hlmInvLoaded}})); }catch(e){} }

function mergeLive(liveData){ var seed=normalizeCategories(getSeedProducts()); var live=normalizeCategories(liveData.slice());
  var lv={}; live.forEach(function(p){ if(p.vendor) lv[p.vendor]=true; }); return seed.filter(function(p){ return !lv[p.vendor]; }).concat(live); }
function loadLiveInventory(){ if(typeof google==="undefined" || !google.script || !google.script.run){ hideLoader(); return; }
  google.script.run.withSuccessHandler(function(data){ try{ if(Array.isArray(data)&&data.length){ PRODUCTS=mergeLive(data); applyNSSIds(); buildFilters(); buildStoreFilter(); window.__hlmInvLoaded=true; render(); renderCart(); } }catch(e){} try{ window.__hlmInvLoaded=true; document.dispatchEvent(new CustomEvent("hlm:inventory")); }catch(e){} hideLoader(); })
    .withFailureHandler(function(){ try{ window.__hlmInvLoaded=true; document.dispatchEvent(new CustomEvent("hlm:inventory")); }catch(e){} hideLoader(); }).getInventory(); }
function hideLoader(){ var el=document.getElementById("hlmLoader"); if(el){ el.classList.add("hide"); setTimeout(function(){ el.style.display="none"; },600); } }

function hlmInit(){ try{ if(hlmHandleGo()) return; var y=document.getElementById("year"); if(y)y.textContent=new Date().getFullYear();
  loadCart(); loadWish(); loadSelv(); loadRitualFB(); PRODUCTS=normalizeCategories(getSeedProducts());
  var _openCartFromAdd=hlmHandleAdd();
  buildFilters(); buildStoreFilter(); render(); updateCartBadge(); renderCart(); updateAccountUI(); setAuthMode("signup");
  if(_openCartFromAdd) openCart();
  loadLiveInventory(); loadNSSIds(); loadMatrixRules();
}catch(e){} setTimeout(hideLoader, 3500); }
if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",hlmInit); } else { hlmInit(); }
