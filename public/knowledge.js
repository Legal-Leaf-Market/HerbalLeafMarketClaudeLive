/* =====================================================================
 *  HERBAL LEAF MARKET - BOTANICAL KNOWLEDGE MATRIX  (credibility layer)
 *  ---------------------------------------------------------------------
 *  Source of truth that grounds every "Build Your Ritual" recommendation.
 *  Nothing is recommended unless it maps to a cited entry here.
 *
 *  SCHEMA (per botanical):
 *    label          - display name
 *    category       - functional class (nervine_sedative, adaptogen, etc.)
 *    intoxicating   - false for everything we sell
 *    match          - regex to find matching inventory
 *    mechanism      - real pharmacology (education, not a claim)
 *    structureFn    - FDA-style STRUCTURE/FUNCTION claim (compliant; the ONLY
 *                     phrasing shown on-site). Never a disease claim.
 *    evidence       - per-goal tier key: strong|moderate|preliminary|mixed|traditional
 *    tierLabel      - human label for the strongest evidence
 *    cite           - real citation(s)
 *    goals          - which goals it qualifies for + that goal's tier
 *    enabled        - default on/off (Admin can override live)
 *
 *  COMPLIANCE RULE (baked in): structureFn uses "supports / promotes /
 *  helps maintain" language - NEVER "treats / cures / relieves [disease]".
 * ===================================================================== */
var HLM_KNOWLEDGE = {
  tierLabels: {
    strong:"Clinical-trial supported", moderate:"Multiple human studies",
    preliminary:"Emerging research", mixed:"Mixed / debated evidence", traditional:"Traditional use"
  },
  evidenceRank: { strong:5, moderate:4, preliminary:3, mixed:2, traditional:1 },

  compounds: {
    "cbd": { label:"CBD (cannabidiol)", category:"cannabinoid", intoxicating:false,
      match:/\bcbd\b|cannabidiol/i,
      mechanism:"Non-intoxicating cannabinoid; interacts with 5-HT1A serotonin receptors and endocannabinoid signaling.",
      structureFn:"Supports a calm, balanced mood and a healthy response to everyday stress.",
      goals:{ calm:"strong", sleep:"moderate", focus:"preliminary" }, tierLabel:"Clinical-trial supported",
      cite:"Blessing 2015 (Neurotherapeutics); Epidiolex (FDA-approved for certain seizures)", enabled:true },
    "cbg": { label:"CBG (cannabigerol)", category:"cannabinoid", intoxicating:false,
      match:/\bcbg\b|cannabigerol/i,
      mechanism:"Non-intoxicating 'mother cannabinoid'; interacts with adrenergic and CB receptors.",
      structureFn:"Supports focus and a calm, clear headspace without intoxication.",
      goals:{ focus:"preliminary", calm:"preliminary" }, tierLabel:"Emerging research",
      cite:"Cuttler 2024 (Scientific Reports) - first human CBG trial", enabled:true },
    "cbn": { label:"CBN (cannabinol)", category:"cannabinoid", intoxicating:false,
      match:/\bcbn\b|cannabinol/i,
      mechanism:"Mild CB1 partial agonist; widely marketed for sleep.",
      structureFn:"Often used as part of a wind-down routine to support restful sleep.",
      goals:{ sleep:"mixed" }, tierLabel:"Mixed / debated evidence",
      cite:"Corroon 2021 (Cannabis Cannabinoid Res) found evidence insufficient; TruCBN RCT 2024 (SLEEP) found it comparable to melatonin", enabled:true },
    "chamomile": { label:"Chamomile (apigenin)", category:"nervine", intoxicating:false,
      match:/chamomile|apigenin|matricaria/i,
      mechanism:"Apigenin binds the benzodiazepine site on GABA-A receptors, gently enhancing GABA tone.",
      structureFn:"Supports relaxation and helps maintain healthy, restful sleep.",
      goals:{ calm:"moderate", sleep:"moderate", ritual:"traditional" }, tierLabel:"Multiple human studies",
      cite:"Mao 2016 (GAD RCT, Phytomedicine); Zick 2011 (BMC CAM, sleep)", enabled:true },
    "lavender": { label:"Lavender (linalool)", category:"nervine_sedative", intoxicating:false,
      match:/lavender|linalool|silexan/i,
      mechanism:"Linalool modulates voltage-gated calcium channels and 5-HT1A serotonin signaling; standardized oil (Silexan) is anxiolytic in trials.",
      structureFn:"Supports a healthy stress response and a sense of calm relaxation.",
      goals:{ calm:"strong", sleep:"moderate", ritual:"traditional" }, tierLabel:"Clinical-trial supported",
      cite:"Kasper 2018 (World J Biol Psychiatry); Yap 2019 (Sci Reports meta-analysis)", enabled:true },
    "passionflower": { label:"Passionflower", category:"nervine", intoxicating:false,
      match:/passion ?flower|passiflora|maypop/i,
      mechanism:"Flavonoids (chrysin, vitexin) appear to modulate the GABA system.",
      structureFn:"Supports a calm mind and helps ease occasional nervous tension.",
      goals:{ calm:"moderate", sleep:"preliminary" }, tierLabel:"Multiple human studies",
      cite:"Janda 2020 (review); Harit 2024 (RCT, stress & sleep)", enabled:true },
    "valerian": { label:"Valerian root", category:"nervine_sedative", intoxicating:false,
      match:/valerian|valeriana|valerenic/i,
      mechanism:"Valerenic acid modulates GABA-A signaling.",
      structureFn:"A traditional wind-down herb used to support restful sleep.",
      goals:{ sleep:"mixed" }, tierLabel:"Mixed / debated evidence",
      cite:"Shinjyo 2020 (meta-analysis, positive) vs. Valente 2024 (umbrella review, inconclusive)", enabled:true },
    "ltheanine": { label:"L-theanine", category:"amino_acid", intoxicating:false,
      match:/theanine|l-?theanine/i,
      mechanism:"Increases alpha brain-wave activity and GABA; softens caffeine's edge.",
      structureFn:"Supports 'calm alertness' and a relaxed, focused state.",
      goals:{ calm:"moderate", focus:"moderate" }, tierLabel:"Multiple human studies",
      cite:"Evans 2021 (Neurol Ther) - alpha power & salivary cortisol", enabled:true },
    "lemonbalm": { label:"Lemon balm", category:"nervine", intoxicating:false,
      match:/lemon ?balm|melissa/i,
      mechanism:"May inhibit GABA transaminase, raising GABA availability.",
      structureFn:"Supports a calm mood and a relaxed sense of ease.",
      goals:{ calm:"preliminary", sleep:"preliminary" }, tierLabel:"Emerging research",
      cite:"Scholey 2014 (Nutrients)", enabled:true },
    "damiana": { label:"Damiana", category:"traditional_relaxant", intoxicating:false,
      match:/damiana|turnera/i,
      mechanism:"Traditional relaxing/mood botanical; limited modern mechanistic data.",
      structureFn:"A traditional smoking-blend base valued for a gently relaxing, uplifting character.",
      goals:{ calm:"traditional", ritual:"traditional" }, tierLabel:"Traditional use",
      cite:"Szewczyk 2014 (review); ethnobotanical use", enabled:true },
    "mugwort": { label:"Mugwort", category:"traditional_dream", intoxicating:false,
      match:/mugwort|artemisia/i,
      mechanism:"Traditional 'dream' herb; minimal modern trial data.",
      structureFn:"Traditionally part of an evening wind-down and dream ritual.",
      goals:{ sleep:"traditional", ritual:"traditional" }, tierLabel:"Traditional use",
      cite:"Ethnobotanical use", enabled:true },
    "bluelotus": { label:"Blue lotus", category:"traditional_ceremonial", intoxicating:false,
      match:/blue lotus|blue water lily|nymphaea/i,
      mechanism:"Contains nuciferine/apomorphine; traditionally calming.",
      structureFn:"An ancient ceremonial botanical valued for a dreamy, relaxed mood.",
      goals:{ calm:"traditional", ritual:"traditional", sleep:"traditional" }, tierLabel:"Traditional use",
      cite:"Ethnobotanical use", enabled:true },
    "peppermint": { label:"Peppermint", category:"aromatic", intoxicating:false,
      match:/peppermint|mentha|spearmint/i,
      mechanism:"Menthol aroma associated with perceived alertness in small studies.",
      structureFn:"A bright, refreshing herb that supports a feeling of alertness.",
      goals:{ focus:"preliminary" }, tierLabel:"Emerging research",
      cite:"Moss 2008 (Int J Neurosci)", enabled:true },
    "yerbamate": { label:"Yerba mate", category:"stimulant_herb", intoxicating:false,
      match:/yerba|mate\b|ilex/i,
      mechanism:"Naturally caffeinated xanthines support energy and alertness.",
      structureFn:"Naturally energizing (contains caffeine) to support daytime focus.",
      goals:{ focus:"moderate" }, tierLabel:"Multiple human studies",
      cite:"Heck 2007 (J Food Sci, review)", enabled:true },
    "lionsmane": { label:"Lion's mane", category:"functional_mushroom", intoxicating:false,
      match:/lions? mane|hericium/i,
      mechanism:"Hericenones/erinacines studied for NGF-related cognitive support.",
      structureFn:"A functional mushroom used to support focus and cognitive clarity.",
      goals:{ focus:"preliminary" }, tierLabel:"Emerging research",
      cite:"Mori 2009 (Phytother Res, small RCT)", enabled:true }
  },

  goals: {
    calm:  { title:"Calm & Ease", emoji:"\uD83C\uDF3F", enabled:true,
      blurb:"Take the edge off a busy, anxious day.",
      ritual:"Steep or burn something calming; slow your breath for a few minutes as the aroma settles.",
      compounds:["lavender","cbd","chamomile","passionflower","ltheanine","lemonbalm","damiana","bluelotus"] },
    sleep: { title:"Deep Sleep", emoji:"\uD83C\uDF19", enabled:true,
      blurb:"Wind down and drift off.",
      ritual:"Begin ~30-45 min before bed as a warm tea or gentle wind-down ritual; dim the lights.",
      compounds:["chamomile","lavender","valerian","cbn","passionflower","mugwort","lemonbalm","cbd"] },
    focus: { title:"Focus & Energy", emoji:"\u2600\uFE0F", enabled:true,
      blurb:"Clear, bright, dialed-in.",
      ritual:"Best in the morning or early afternoon; pair with water and a clear intention.",
      compounds:["ltheanine","cbg","yerbamate","peppermint","lionsmane","cbd"] },
    ritual:{ title:"Earthy Ritual", emoji:"\u2728", enabled:true,
      blurb:"A grounding, sensory moment.",
      ritual:"A slow, intentional pause \u2014 light, breathe, and be present with the plant.",
      compounds:["damiana","bluelotus","mugwort","lavender","chamomile"] }
  }
};

/* Merge server-side Admin overrides (enable/claim) onto the default matrix.
 * overrides = { compounds:{ id:{enabled,structureFn} }, goals:{ key:{enabled} }, rules:{...} } */
function hlmApplyMatrixOverrides(ov){
  if(!ov) return; try{
    if(ov.compounds){ for(var id in ov.compounds){ if(HLM_KNOWLEDGE.compounds[id]){ var o=ov.compounds[id];
      if(o.enabled!==undefined) HLM_KNOWLEDGE.compounds[id].enabled=!!o.enabled;
      if(o.structureFn) HLM_KNOWLEDGE.compounds[id].structureFn=String(o.structureFn); } } }
    if(ov.goals){ for(var g in ov.goals){ if(HLM_KNOWLEDGE.goals[g] && ov.goals[g].enabled!==undefined) HLM_KNOWLEDGE.goals[g].enabled=!!ov.goals[g].enabled; } }
  }catch(e){}
}
