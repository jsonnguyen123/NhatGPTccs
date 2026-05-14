# Installation and Deployment

## What works locally in the current repo

There are two different setup paths in the current codebase:

1. **Local extension run**: load the extension from this repository in Chrome. This works today and uses the Railway backend URL already hardcoded in the extension.
2. **Local backend run**: start the Express server from `./backend` for backend development or direct API testing.

The checked-in extension does **not** call `localhost`. If you want the extension to use your own backend, you must change the hardcoded Railway URL in `extension/background.js` and the matching host permission in `extension/manifest.json` before reloading the extension.

---

## Prerequisites

- Chrome or another Chromium browser that supports unpacked extensions
- Node.js 18
- npm 8 or newer
- A Railway account for production deployment
- Access to the credentials used by the current backend

---

## Step 0 — Generate your secrets before touching any config

### `BB_ENCRYPTION_KEY`

Must be a 32-byte hex string (64 hex characters). The server uses it for AES-256-GCM token encryption.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep this value private and paste it into your backend `.env` and Railway variables.

---

## Required backend environment variables

Create `./backend/.env` from `./backend/.env.example`, then fill in every value listed below.

### Variables already listed in `.env.example`

Variable

| `PORT` 
| `NODE_ENV` 
| `CANVAS_CLIENT_ID` 
| `CANVAS_CLIENT_SECRET` 
| `BLACKBAUD_CLIENT_ID` 
| `BLACKBAUD_CLIENT_SECRET` 
| `SERPER_API_KEY` 
| `EMAILJS_PUBLIC_KEY` 
| `EMAILJS_SERVICE_ID`
| `EMAILJS_TEMPLATE_ID` 
| `GEMINI_API_KEY` 
| `ALLOWED_ORIGINS` (Include your extension origin: `chrome-extension://<your-extension-id>`)
| `RATE_LIMIT_WINDOW_MS` (Present in `.env.example` but not read by the current server code)
| `RATE_LIMIT_MAX_REQUESTS` (Present in `.env.example` but not read by the current server code)
| `LOG_LEVEL` 

### Variables used by `backend/server.js` but missing from `.env.example`

| Variable

| `BLACKBAUD_SUBSCRIPTION_KEY` 
| `ALLOWED_REDIRECT_URIS` (Validates OAuth redirect URIs for Canvas and Blackbaud token exchange routes)
| `BB_ENCRYPTION_KEY` (32-byte hex string — generated in Step 0)
| `LOG_REDACTION_SECRET` (Optional; falls back to `BB_ENCRYPTION_KEY` if not set)

---

## Local extension setup

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `./extension`.
5. Note your extension ID from the extensions page — you need it for `ALLOWED_ORIGINS` in the backend.
6. Open the extension.
7. Use the welcome page to start Canvas OAuth, or open the options page and paste a Canvas API token manually.
8. If you need schedule data, connect Blackbaud from the options page.
9. If you need email data, connect Gmail from the options page.

### Important local behavior

- The checked-in extension already targets `https://canvas-ai-assistant-production.up.railway.app`.
- Loading the extension locally does **not** require a local backend if you want to test against the current hardcoded production URL.
- The popup docs link still points to `https://github.com/your-repo/docs` in the current code.

---

## Local backend setup

1. Open a shell in `./backend`.
2. Switch to Node 18.
3. Install dependencies:

```bash
npm install
```

4. Create `.env`:

```bash
cp .env.example .env
```

5. Edit `.env` and fill in every variable in the tables above, including those missing from `.env.example`.
6. Start the server:

```bash
npm start
```

7. Verify the health endpoint:

```bash
curl http://localhost:3000/api/health
```

### Available scripts (from `./backend`)

| Script - Status 

| `npm start` (Works)
| `npm run dev` (Works)
| `npm test` (Exits with "No tests found")
| `npm run lint` (Fails — no ESLint config is checked in)
| `npm run format` (Works)

---

## Using your own backend with the extension

The repository does not include an environment switch for the backend URL. To point the extension at your own backend, update these values and reload the unpacked extension:

**`extension/background.js`**
- Replace `https://canvas-ai-assistant-production.up.railway.app/api` with your backend URL
- Replace all other hardcoded OAuth, refresh, Blackbaud proxy, and search URLs that use the same Railway domain

**`extension/manifest.json`**
- Replace the host permission for `https://canvas-ai-assistant-production.up.railway.app/*` with your backend URL

If you want the extension to talk to a local backend, add a matching host permission for that local origin as well.

---

## Railway deployment

### 1. Create the Railway project

1. Create a new Railway project at [railway.app](https://railway.app).
2. Connect your repository or deploy from `./backend`.
3. Set the runtime to **Node 18**.
4. Set the install command to `npm install`.
5. Set the start command to `npm start`.

### 2. Add environment variables in Railway

Open your Railway project → **Variables** and set every value from the tables above.

Minimum production set:

```
NODE_ENV=production
CANVAS_CLIENT_ID=
CANVAS_CLIENT_SECRET=
BLACKBAUD_CLIENT_ID=
BLACKBAUD_CLIENT_SECRET=
BLACKBAUD_SUBSCRIPTION_KEY=
SERPER_API_KEY=
EMAILJS_PUBLIC_KEY=
EMAILJS_SERVICE_ID=
EMAILJS_TEMPLATE_ID=
GEMINI_API_KEY=
ALLOWED_ORIGINS=
ALLOWED_REDIRECT_URIS=
BB_ENCRYPTION_KEY=          # 64-char hex — from Step 0
LOG_LEVEL=info
```

Railway injects `PORT` automatically. Do not hardcode it.

### 3. Configure the OAuth redirect list

The backend rejects unknown redirect URIs. Add the Chrome extension redirect URI to all three places:

- `ALLOWED_REDIRECT_URIS` in Railway
- The allowed redirect URI list in your **Canvas** OAuth app settings
- The allowed redirect URI list in your **Blackbaud** OAuth app settings

The extension's redirect URI comes from `chrome.identity.getRedirectURL()`. You can log it from the extension console to get the exact string.

### 4. Point the extension at your Railway backend

After Railway assigns your project URL:

1. Replace the current Railway domain in `extension/background.js` with your new Railway project URL.
2. Replace the matching host permission in `extension/manifest.json`.
3. Reload the unpacked extension in `chrome://extensions/`.
4. Update `ALLOWED_ORIGINS` in Railway to include the extension origin for the reloaded build (`chrome-extension://<your-extension-id>`).

### 5. Verify the deployment

1. Load `./extension` as an unpacked extension.
2. Complete Canvas sign-in.
3. Confirm the health endpoint is live: `https://<your-railway-url>/api/health`
4. Confirm chat, Blackbaud, and Gmail flows work end-to-end.

---

## Production notes

- The backend uses **in-memory `Map` storage** for synced data, user settings, Blackbaud tokens, and Canvas refresh tokens. Restarting the Railway service clears all of that state. Users will need to re-authenticate after a restart.
- The backend writes logs to `./backend/logs` when run locally. On Railway, logs stream to the Railway dashboard.
- `./backend/.railwayignore` already excludes `node_modules`, `.env`, and `logs`.