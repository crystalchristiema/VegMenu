import 'dotenv/config';
import express    from 'express';
import cors       from 'cors';
import Anthropic  from '@anthropic-ai/sdk';

const app  = express();
const PORT = process.env.PORT || 3000;
const MODEL      = 'claude-sonnet-4-6';
const MODEL_FAST = 'claude-haiku-4-5-20251001'; // pre-checks and text analysis

// ── Anthropic client ──────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '50mb' }));  // images arrive as base64

app.use(cors({
  origin(origin, cb) {
    // Allow Chrome extensions and curl/Insomnia (no origin header)
    const allowed = !origin
      || origin === 'null'
      || /^chrome-extension:\/\//.test(origin);
    allowed ? cb(null, true) : cb(new Error(`CORS blocked: ${origin}`));
  }
}));

// ── Pricing ───────────────────────────────────────────────────────────────────
// https://www.anthropic.com/pricing
const PRICING = {
  [MODEL]:      { in: 3.00 / 1_000_000, out: 15.00 / 1_000_000 },
  [MODEL_FAST]: { in: 0.80 / 1_000_000, out:  4.00 / 1_000_000 }
};

function estimateCost(inputTokens, outputTokens, model = MODEL) {
  const p = PRICING[model] ?? PRICING[MODEL];
  const usd = inputTokens * p.in + outputTokens * p.out;
  return `$${usd.toFixed(4)}`;
}

function elapsed(start) { return `${Date.now() - start}ms`; }

// ── Prompt helpers ────────────────────────────────────────────────────────────

function filterDescription(filterType) {
  const map = {
    vegetarian:    'vegetarian (no meat, poultry, or seafood)',
    vegan:         'vegan (no animal products whatsoever)',
    'plant-based': 'plant-based (made primarily from plants, minimal or no animal products)'
  };
  return map[filterType] || map.vegetarian;
}

const ITEM_SCHEMA = '{"name":"","description":"","price":"","isVegetarian":false,"isVegan":false}';

const DRINKS_SUBCATS = [
  'Cocktails','Zero Proof Spirits','Sparkling Wine','Natural Wine',
  'White Wine','Red Wine','Soju & Rice Wine','Beer','Non-Alcoholic Beer','Tea & Spritz'
];

function itemMatchesFilter(item, filterType) {
  if (filterType === 'vegan') return !!item.isVegan;
  return !!item.isVegetarian;
}

// Filter a parsed categories array down to only matching items, recursing into subcategories.
// Returns { categories (filtered), vegetarianItems (flat list), allItems (flat list) }
// If Claude returned old-format { allItems } instead of { categories }, promote allItems to a
// single category so items aren't silently dropped.
function processCategories(rawCategories, filterType, fallbackAllItems) {
  if ((!rawCategories || rawCategories.length === 0) && fallbackAllItems?.length > 0) {
    rawCategories = [{ name: 'MENU ITEMS', items: fallbackAllItems }];
  }
  const vegetarianItems = [];
  const allItems        = [];

  const filtered = (rawCategories || []).reduce((out, cat) => {
    if (cat.subcategories) {
      const subs = cat.subcategories.reduce((sa, sub) => {
        const items = (sub.items || []);
        allItems.push(...items);
        const kept = items.filter(i => itemMatchesFilter(i, filterType));
        vegetarianItems.push(...kept);
        return kept.length ? [...sa, { name: sub.name, items: kept }] : sa;
      }, []);
      return subs.length ? [...out, { name: cat.name, subcategories: subs }] : out;
    } else {
      const items = (cat.items || []);
      allItems.push(...items);
      const kept = items.filter(i => itemMatchesFilter(i, filterType));
      vegetarianItems.push(...kept);
      return kept.length ? [...out, { name: cat.name, items: kept }] : out;
    }
  }, []);

  return { categories: filtered, vegetarianItems, allItems };
}

function jsonRules() {
  const exampleSchema = JSON.stringify({
    isMenu: true, confidence: 92,
    categories: [
      { name: 'APPETIZERS', items: [JSON.parse(ITEM_SCHEMA)] },
      { name: 'DRINKS', subcategories: [{ name: 'Cocktails', items: [JSON.parse(ITEM_SCHEMA)] }] }
    ]
  });
  return (
    `Respond ONLY with valid JSON — no markdown, no explanation:\n${exampleSchema}\n\n` +
    `Rules:\n` +
    `- "isMenu": true if this is a restaurant/food-service menu\n` +
    `- "confidence": 0–100\n` +
    `- "categories": organize ALL menu items into named category objects\n` +
    `  - Each category has "name" (ALL CAPS) and "items" array\n` +
    `  - For any DRINKS/BEVERAGES/BAR category, use "subcategories" instead of "items"\n` +
    `    Choose subcategory names from: ${DRINKS_SUBCATS.join(', ')}\n` +
    `  - Include every item regardless of dietary type\n` +
    `  - "isVegetarian": true if no meat, poultry, or seafood\n` +
    `  - "isVegan": true if no animal products at all\n` +
    `- If not a menu: isMenu=false, confidence=..., categories=[]\n` +
    `JSON safety:\n` +
    `- Escape double-quotes inside strings as \\"\n` +
    `- No newlines/tabs inside string values\n` +
    `- No trailing commas`
  );
}

// ── Response parser ───────────────────────────────────────────────────────────

// Walk character-by-character and escape any unescaped quotes / bare newlines
// that appear inside string values. This handles Claude hallucinating unescaped
// quotes in descriptions (e.g. 8oz "prime" cut).
function repairJSON(text) {
  let out = '';
  let inStr = false;
  let esc   = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (esc) { out += c; esc = false; continue; }

    if (c === '\\') {
      out += c;
      if (inStr) esc = true;
      continue;
    }

    if (c === '"') {
      if (!inStr) {
        inStr = true;
        out += c;
      } else {
        // Peek past whitespace: if the next structural char is , } ] or : this
        // is a legitimate closing quote. Otherwise it's an embedded unescaped quote.
        let j = i + 1;
        while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
        const next = j < text.length ? text[j] : '';
        if (!next || next === ',' || next === '}' || next === ']' || next === ':' || next === '\n' || next === '\r') {
          inStr = false;
          out += c;
        } else {
          out += '\\"'; // escape the embedded quote
        }
      }
      continue;
    }

    if (inStr) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
    }

    out += c;
  }

  return out;
}

// If Claude's JSON was truncated (max_tokens hit), close all open brackets so
// the partial response is at least parseable.
function recoverTruncatedJSON(text) {
  let inString = false, escape = false;
  const stack = [];        // track open { and [
  let lastDepth1End = -1;  // position after last complete depth-1 element

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape)                  { escape = false; continue; }
    if (c === '\\' && inString)  { escape = true;  continue; }
    if (c === '"')               { inString = !inString; continue; }
    if (inString)                continue;

    if (c === '{' || c === '[')  { stack.push(c); }
    else if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 1) lastDepth1End = i + 1; // just closed a top-level array element
    }
  }

  if (stack.length === 0) return text; // already balanced

  // Trim to last complete top-level element, then close all open brackets
  const trimmed  = lastDepth1End > 0 ? text.slice(0, lastDepth1End) : text;
  const closing  = stack.slice().reverse().map(c => c === '{' ? '}' : ']').join('');
  return trimmed + closing;
}

function parseJSON(text) {
  // 1. Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  let cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // 1b. Strip control characters never valid inside JSON strings
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Extract the first {...} block once — used in all retry attempts
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = objMatch ? objMatch[0] : cleaned;

  // 2. Direct parse (fast path — usually works)
  try { return JSON.parse(candidate); } catch (e1) {

    // 3. Repair: escape unescaped quotes / bare newlines inside string values
    const repaired = repairJSON(candidate);
    try { return JSON.parse(repaired); } catch (e2) {

      // 4. Recovery: close unclosed brackets if response was truncated
      const recovered = recoverTruncatedJSON(repaired);
      if (recovered !== repaired) {
        try {
          const result = JSON.parse(recovered);
          console.warn('[VegMenu] JSON truncated — recovered', result.categories?.length ?? 0, 'categories');
          return result;
        } catch (e3) { /* fall through to diagnostics */ }
      }

      // Diagnostics: show exactly where parsing fails and what character is there
      const posMatch = e2.message.match(/position (\d+)/);
      const pos = posMatch ? parseInt(posMatch[1]) : -1;
      console.error('[VegMenu] JSON parse error:', e2.message);
      if (pos >= 0) {
        const lo = Math.max(0, pos - 100), hi = Math.min(repaired.length, pos + 100);
        const badChar = repaired[pos];
        console.error(`[VegMenu] Char at ${pos}: ${JSON.stringify(badChar)} (U+${(badChar?.charCodeAt(0) ?? 0).toString(16).padStart(4,'0')})`);
        console.error('[VegMenu] Context:', JSON.stringify(repaired.slice(lo, hi)));
      }
      console.error('[VegMenu] Raw response (first 300):', text.slice(0, 300));
      throw new Error(`JSON parse failed at position ${pos}: ${e2.message}`);
    }
  }
}

// ── Debug helpers ─────────────────────────────────────────────────────────────

function logCategories(categories) {
  for (const cat of categories) {
    if (cat.subcategories) {
      const total = cat.subcategories.reduce((n, s) => n + (s.items?.length || 0), 0);
      console.log(`  ${cat.name} (${total} veg items):`);
      for (const sub of cat.subcategories) {
        console.log(`    └─ ${sub.name} (${sub.items?.length || 0}): ${sub.items?.map(i => i.name).join(', ')}`);
      }
    } else {
      console.log(`  ${cat.name} (${cat.items?.length || 0}): ${cat.items?.map(i => i.name).join(', ')}`);
    }
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status:           'ok',
    model:            MODEL,
    apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    version:          '1.0.0'
  });
});

app.post('/api/scan-menu', async (req, res) => {
  const { images = [], text = '', filterType = 'vegetarian', mode = 'popup' } = req.body;
  // mode: 'highlight' = fast name-list only (for on-page highlights, ~1-2s)
  //       'popup'     = full categorization (for accordion panel, ~20s)

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'ANTHROPIC_API_KEY is not set on the server. Check your .env file.'
    });
  }
  if (images.length === 0 && !text.trim()) {
    return res.status(400).json({ success: false, error: 'Provide at least one image or some text.' });
  }

  const filter    = filterDescription(filterType);
  const textMenus  = [];
  const imageMenus = [];
  let totalIn  = 0;
  let totalOut = 0;
  const t0scan = Date.now();

  // ── Text analysis ───────────────────────────────────────────────────────────
  if (text.trim()) {
    const t0text = Date.now();

    if (mode === 'highlight') {
      // ── HIGHLIGHT MODE: name-list only, ~1-2s ──────────────────────────────
      console.log('\n[VegMenu] ── HIGHLIGHT MODE (Haiku, names only) ──────────────');
      console.log(`[VegMenu] ${text.length} chars of page text`);

      const hlPrompt =
        `Below is text from a webpage. If it's a restaurant menu, list the ` +
        `${filterDescription(filterType)} item names only.\n\n` +
        `Respond ONLY with valid JSON — no markdown, no explanation:\n` +
        `{"isMenu":true,"vegetarianNames":["Item Name 1","Item Name 2"]}\n\n` +
        `Rules:\n` +
        `- isMenu: true only if text clearly contains food items with descriptions or prices\n` +
        `- vegetarianNames: exact item names that are ${filterDescription(filterType)}\n` +
        `- If not a menu: {"isMenu":false,"vegetarianNames":[]}\n` +
        `JSON safety: escape double-quotes inside strings as \\"\n\n` +
        `PAGE TEXT:\n${text}`;

      try {
        const msg = await anthropic.messages.create({
          model: MODEL_FAST, max_tokens: 512,  // names only — tiny output
          messages: [{ role: 'user', content: hlPrompt }]
        });
        totalIn  += msg.usage.input_tokens;
        totalOut += msg.usage.output_tokens;
        console.log(`[VegMenu] Highlight extraction: ${elapsed(t0text)} (${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out tokens)`);

        const parsed = parseJSON(msg.content[0].text);
        const names  = parsed.vegetarianNames || [];
        const vegetarianItems = names.map(n => ({ name: n, isVegetarian: true, isVegan: false }));
        console.log(`[VegMenu] ${vegetarianItems.length} vegetarian names extracted`);
        if (vegetarianItems.length) console.log(`[VegMenu] Names: ${names.join(', ')}`);

        textMenus.push({
          isMenu:     parsed.isMenu ?? false,
          confidence: parsed.confidence ?? 80,
          categories:      [],
          vegetarianItems,
          allItems:        []
        });
      } catch (err) {
        console.error('[VegMenu] Highlight extraction failed:', err.message);
      }

    } else {
      // ── POPUP MODE: full categorization, ~20s ──────────────────────────────
      console.log('\n[VegMenu] ── POPUP MODE — Text Analysis (Haiku) ─────────────');
      console.log(`[VegMenu] ${text.length} chars of page text`);

      const prompt =
        `Below is text extracted from a webpage. Does it contain a restaurant menu?\n` +
        `If yes, list ALL items on it — vegetarian AND non-vegetarian.\n\n` +
        jsonRules() + '\n\n' +
        `Additional rule: set isMenu=true only if the text clearly contains ` +
        `food items with descriptions or prices — not just mentions of a menu.\n\n` +
        `PAGE TEXT:\n${text}`;

      try {
        const msg = await anthropic.messages.create({
          model: MODEL_FAST, max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }]
        });
        totalIn  += msg.usage.input_tokens;
        totalOut += msg.usage.output_tokens;
        console.log(`[VegMenu] Text analysis: ${elapsed(t0text)} (${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out tokens)`);

        const parsed = parseJSON(msg.content[0].text);
        const { categories, vegetarianItems, allItems } =
          processCategories(parsed.categories, filterType, parsed.allItems);

        console.log('\n[VegMenu] Claude categories (vegetarian items only):');
        logCategories(categories);
        console.log(`[VegMenu] ${vegetarianItems.length} veg / ${allItems.length} total items`);

        textMenus.push({
          isMenu:     parsed.isMenu     ?? false,
          confidence: parsed.confidence ?? 0,
          categories,
          vegetarianItems,
          allItems
        });
      } catch (err) {
        console.error('[VegMenu] Text analysis failed:', err.message);
        // Non-fatal: image scanning can still proceed
      }
    }
  }

  // ── Image analysis ──────────────────────────────────────────────────────────
  for (const img of images) {
    // Accept either a plain base64 string or { data, mimeType }
    const imageData = (typeof img === 'string')
      ? { data: img, mimeType: 'image/jpeg' }
      : img;

    const prompt =
      `Is this a restaurant menu? If yes, list ALL items on it — vegetarian AND non-vegetarian.\n\n` +
      jsonRules();

    const imgIndex = images.indexOf(img) + 1;
    console.log(`\n[VegMenu] ── Image ${imgIndex}/${images.length} ──────────────────────────────`);
    const t0img = Date.now();

    const imgSource = {
      type: 'base64', media_type: imageData.mimeType, data: imageData.data
    };

    try {
      // ── Step 1: Haiku pre-check (~0.3s) — skip Sonnet for non-menu images ──
      const preCheck = await anthropic.messages.create({
        model: MODEL_FAST, max_tokens: 16,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: imgSource },
            { type: 'text',  text: 'Is this image a restaurant menu showing food items and/or prices? Reply YES or NO only.' }
          ]
        }]
      });
      totalIn  += preCheck.usage.input_tokens;
      totalOut += preCheck.usage.output_tokens;
      const preAnswer = preCheck.content[0].text.trim().toUpperCase();
      console.log(`[VegMenu] Pre-check: ${preAnswer} (${elapsed(t0img)})`);

      if (!preAnswer.startsWith('YES')) {
        imageMenus.push({ isMenu: false, confidence: 5, categories: [], vegetarianItems: [], allItems: [] });
        continue;
      }

      // ── Step 2: Sonnet full analysis (only for confirmed menus) ─────────────
      const t1img = Date.now();
      const msg = await anthropic.messages.create({
        model: MODEL, max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: imgSource },
            { type: 'text',  text: prompt }
          ]
        }]
      });
      totalIn  += msg.usage.input_tokens;
      totalOut += msg.usage.output_tokens;
      console.log(`[VegMenu] Full analysis: ${elapsed(t1img)} | total image: ${elapsed(t0img)}`);

      const parsed = parseJSON(msg.content[0].text);
      const { categories, vegetarianItems, allItems } =
        processCategories(parsed.categories, filterType, parsed.allItems);

      console.log('[VegMenu] Claude categories (vegetarian items only):');
      logCategories(categories);
      console.log(`[VegMenu] ${vegetarianItems.length} veg / ${allItems.length} total items`);

      imageMenus.push({
        isMenu:     parsed.isMenu     ?? false,
        confidence: parsed.confidence ?? 0,
        categories,
        vegetarianItems,
        allItems
      });
    } catch (err) {
      console.error('[VegMenu] Image analysis failed:', err.message);
      imageMenus.push({
        isMenu: false, confidence: 0, allItems: [], vegetarianItems: [],
        error: err.message
      });
    }
  }

  console.log(`\n[VegMenu] ── TOTAL SCAN TIME: ${elapsed(t0scan)} ──────────────────`);

  res.json({
    success: true,
    results: { textMenus, imageMenus },
    tokenUsage:    { inputTokens: totalIn, outputTokens: totalOut },
    estimatedCost: estimateCost(totalIn, totalOut),
    scanTimeMs:    Date.now() - t0scan
  });
});

// ── Global error handler ──────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[VegMenu Server]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🌿 VegMenu backend  →  http://localhost:${PORT}`);
  console.log(`   API key : ${process.env.ANTHROPIC_API_KEY
    ? '✓ configured'
    : '✗ NOT SET  —  set ANTHROPIC_API_KEY in backend/.env'}`);
  console.log(`   Model   : ${MODEL}\n`);
});
