import 'dotenv/config';
import express    from 'express';
import cors       from 'cors';
import Anthropic  from '@anthropic-ai/sdk';

const app  = express();
const PORT = process.env.PORT || 3000;
const MODEL = 'claude-sonnet-4-6';

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

// ── Pricing (claude-sonnet-4-6) ───────────────────────────────────────────────
// https://www.anthropic.com/pricing
const PRICE_INPUT_PER_TOKEN  = 3.00  / 1_000_000;   // $3.00  / M tokens
const PRICE_OUTPUT_PER_TOKEN = 15.00 / 1_000_000;   // $15.00 / M tokens

function estimateCost(inputTokens, outputTokens) {
  const usd = inputTokens * PRICE_INPUT_PER_TOKEN
            + outputTokens * PRICE_OUTPUT_PER_TOKEN;
  return `$${usd.toFixed(4)}`;
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

function filterDescription(filterType) {
  const map = {
    vegetarian:    'vegetarian (no meat, poultry, or seafood)',
    vegan:         'vegan (no animal products whatsoever)',
    'plant-based': 'plant-based (made primarily from plants, minimal or no animal products)'
  };
  return map[filterType] || map.vegetarian;
}

// Every item on the menu, including non-vegetarian ones
const ITEM_SCHEMA_ALL =
  '[{"name":"","description":"","price":"","isVegetarian":false,"isVegan":false}]';

// Which items count as "matching" the user's selected filter
function itemMatchesFilter(item, filterType) {
  if (filterType === 'vegan') return !!item.isVegan;
  return !!item.isVegetarian; // vegetarian and plant-based both use isVegetarian
}

function jsonRules() {
  return (
    `Respond ONLY with valid JSON — no markdown, no explanation:\n` +
    `{"isMenu":true,"confidence":92,"allItems":${ITEM_SCHEMA_ALL}}\n\n` +
    `Rules:\n` +
    `- "isMenu": true if this is a restaurant/food-service menu\n` +
    `- "confidence": 0–100, your certainty that it IS a menu\n` +
    `- "allItems": EVERY item on the menu, vegetarian AND non-vegetarian\n` +
    `- "isVegetarian": true if the item contains no meat, poultry, or seafood\n` +
    `- "isVegan": true if the item contains no animal products at all\n` +
    `- If not a menu: isMenu=false, confidence=certainty it is NOT, allItems=[]`
  );
}

// ── Response parser ───────────────────────────────────────────────────────────

function parseJSON(text) {
  const cleaned = (() => {
    const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    return fence ? fence[1].trim() : text.trim();
  })();
  try { return JSON.parse(cleaned); }
  catch (_) {
    const obj = cleaned.match(/\{[\s\S]*\}/);
    if (obj) return JSON.parse(obj[0]);
    throw new Error('Cannot parse Claude response as JSON');
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
  const { images = [], text = '', filterType = 'vegetarian' } = req.body;

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

  // ── Text analysis ───────────────────────────────────────────────────────────
  if (text.trim()) {
    const prompt =
      `Below is text extracted from a webpage. Does it contain a restaurant menu?\n` +
      `If yes, list ALL items on it — vegetarian AND non-vegetarian.\n\n` +
      jsonRules() + '\n\n' +
      `Additional rule: set isMenu=true only if the text clearly contains ` +
      `food items with descriptions or prices — not just mentions of a menu.\n\n` +
      `PAGE TEXT:\n${text}`;

    try {
      const msg = await anthropic.messages.create({
        model: MODEL, max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      });
      totalIn  += msg.usage.input_tokens;
      totalOut += msg.usage.output_tokens;
      const parsed  = parseJSON(msg.content[0].text);
      const allItems = parsed.allItems || [];
      textMenus.push({
        isMenu:          parsed.isMenu     ?? false,
        confidence:      parsed.confidence ?? 0,
        allItems,
        vegetarianItems: allItems.filter(i => itemMatchesFilter(i, filterType))
      });
    } catch (err) {
      console.error('[VegMenu] Text analysis failed:', err.message);
      // Non-fatal: image scanning can still proceed
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

    try {
      const msg = await anthropic.messages.create({
        model: MODEL, max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type:       'base64',
                media_type: imageData.mimeType,
                data:       imageData.data
              }
            },
            { type: 'text', text: prompt }
          ]
        }]
      });
      totalIn  += msg.usage.input_tokens;
      totalOut += msg.usage.output_tokens;
      const parsed   = parseJSON(msg.content[0].text);
      const allItems = parsed.allItems || [];
      imageMenus.push({
        isMenu:          parsed.isMenu     ?? false,
        confidence:      parsed.confidence ?? 0,
        allItems,
        vegetarianItems: allItems.filter(i => itemMatchesFilter(i, filterType))
      });
    } catch (err) {
      console.error('[VegMenu] Image analysis failed:', err.message);
      imageMenus.push({
        isMenu: false, confidence: 0, allItems: [], vegetarianItems: [],
        error: err.message
      });
    }
  }

  res.json({
    success: true,
    results: { textMenus, imageMenus },
    tokenUsage:    { inputTokens: totalIn, outputTokens: totalOut },
    estimatedCost: estimateCost(totalIn, totalOut)
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
