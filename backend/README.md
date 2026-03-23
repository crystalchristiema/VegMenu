# VegMenu Backend

Proxy server that lets the VegMenu Chrome extension call the Anthropic API
safely from a server instead of directly from the browser.

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure your API key

```bash
cp .env.example .env
```

Open `.env` and replace `your_anthropic_api_key_here` with your key:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Get a key at https://console.anthropic.com/

### 3. Start the server

```bash
npm start
```

You should see:

```
🌿 VegMenu backend  →  http://localhost:3000
   API key : ✓ configured
   Model   : claude-sonnet-4-6
```

For development with auto-reload on file changes:

```bash
npm run dev
```

## API

### GET /api/health

Returns server status. The extension popup calls this to confirm the server is running.

```json
{
  "status": "ok",
  "model": "claude-sonnet-4-6",
  "apiKeyConfigured": true,
  "version": "1.0.0"
}
```

### POST /api/scan-menu

Analyze text and/or images for vegetarian menu items.

**Request body:**

```json
{
  "images": [
    { "data": "<base64>", "mimeType": "image/jpeg" }
  ],
  "text": "optional page text extracted from the page",
  "filterType": "vegetarian"
}
```

| Field        | Type     | Description |
|-------------|----------|-------------|
| `images`    | array    | Base64-encoded images (can be empty) |
| `text`      | string   | Page text to scan (can be empty) |
| `filterType`| string   | `"vegetarian"` \| `"vegan"` \| `"plant-based"` |

**Response:**

```json
{
  "success": true,
  "results": {
    "textMenus": [
      {
        "isMenu": true,
        "confidence": 91,
        "vegetarianItems": [
          { "name": "Margherita Pizza", "description": "...", "price": "$14", "isVegan": false }
        ]
      }
    ],
    "imageMenus": [
      {
        "isMenu": true,
        "confidence": 95,
        "vegetarianItems": [ ... ]
      }
    ]
  },
  "tokenUsage": {
    "inputTokens": 1842,
    "outputTokens": 310
  },
  "estimatedCost": "$0.0102"
}
```

## Notes

- The server must be running locally while you use the extension.
- Your API key stays on the server — it is never sent to the browser.
- Estimated costs use claude-sonnet-4-6 pricing ($3/M input, $15/M output tokens).
  Check the [Anthropic Console](https://console.anthropic.com/) for real-time usage.
- The server accepts requests from `chrome-extension://` origins only (plus localhost for testing).
