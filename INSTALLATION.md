# Installation and deployment

## What works locally in the current repo

There are two different setup paths in the current codebase:

1. **Local extension run**: load the extension from this repository in Chrome. This works today and uses the Railway backend URL already hardcoded in the extension.
2. **Local backend run**: start the Express server from `./backend` for backend development or direct API testing.

The checked-in extension does **not** call `localhost`. If you want the extension to use your own backend, you must change the hardcoded Railway URL in `extension/background.js` and the matching host permission in `extension/manifest.json` before reloading the extension.

## Prerequisites

- Chrome or another Chromium browser that supports unpacked extensions
- Node.js 18
- npm 8 or newer
- A Railway account for production deployment
- Access to the credentials used by the current backend

## Required backend environment variables

Create `./backend/.env` from `./backend/.env.example`, then add the values below.

### Variables already listed in `.env.example`

- `PORT`
- `NODE_ENV`
- `CANVAS_CLIENT_ID`
- `CANVAS_CLIENT_SECRET`
- `BLACKBAUD_CLIENT_ID`
- `BLACKBAUD_CLIENT_SECRET`
- `SERPER_API_KEY`
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_SERVICE_ID`
- `EMAILJS_TEMPLATE_ID`
- `GEMINI_API_KEY`
- `ALLOWED_ORIGINS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`
- `LOG_LEVEL`

### Variables used by `backend/server.js` but missing from `.env.example`

- `BLACKBAUD_SUBSCRIPTION_KEY`
- `ALLOWED_REDIRECT_URIS`
- `BB_ENCRYPTION_KEY`
- `LOG_REDACTION_SECRET` (optional; the server falls back to `BB_ENCRYPTION_KEY`)

### Notes about the current server code

- `BB_ENCRYPTION_KEY` must be a 32-byte hex string because the server uses it for AES-256-GCM token encryption.
- `ALLOWED_REDIRECT_URIS` is used to validate OAuth redirect URIs for the Canvas and Blackbaud token exchange routes.
- `ALLOWED_ORIGINS` is used for CORS and should include your unpacked extension origin, for example `chrome-extension://<extension-id>`.
- `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` are present in `.env.example`, but the current server code does not read them.

You can generate an encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Local extension setup

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `./extension`.
5. Open the extension.
6. Use the welcome page to start Canvas OAuth, or open the options page and paste a Canvas API token manually.
7. If you need schedule data, connect Blackbaud from the options page.
8. If you need email data, connect Gmail from the options page.

### Important local behavior

- The checked-in extension already targets `https://canvas-ai-assistant-production.up.railway.app`.
- Loading the extension locally does **not** require a local backend if you want to test the current hardcoded production path.
- The popup docs link still points to `https://github.com/your-repo/docs` in the current code.

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

5. Edit `.env` and add every required value listed above, including the variables that are missing from `.env.example`.
6. Start the server:

```bash
npm start
```

7. Verify the health endpoint:

```bash
curl http://localhost:3000/api/health
```

### Current validation scripts

From `./backend`:

- `npm start`
- `npm run dev`
- `npm test`
- `npm run lint`
- `npm run format`

Current repository state:

- `npm test` exits with "No tests found"
- `npm run lint` fails because no ESLint config is checked in

## Using your own backend with the extension

The repository does not include an environment switch for the backend URL. To point the extension at your own backend, update these checked-in values and then reload the unpacked extension:

- `extension/background.js`
  - `https://canvas-ai-assistant-production.up.railway.app/api`
  - the hardcoded OAuth, refresh, Blackbaud proxy, and search URLs that use the same Railway domain
- `extension/manifest.json`
  - the host permission for `https://canvas-ai-assistant-production.up.railway.app/*`

If you want the extension to talk to a local backend instead of Railway, you also need matching host permissions for that local origin.

## Railway deployment

### 1. Create the Railway project

1. Create a new Railway project.
2. Deploy the backend from `./backend`.
3. Use Node 18.
4. Use `npm install` as the install step.
5. Use `npm start` as the start command.

### 2. Add Railway environment variables

Set every backend variable listed earlier in the Railway project settings.

Minimum production set:

- `NODE_ENV=production`
- `CANVAS_CLIENT_ID`
- `CANVAS_CLIENT_SECRET`
- `BLACKBAUD_CLIENT_ID`
- `BLACKBAUD_CLIENT_SECRET`
- `BLACKBAUD_SUBSCRIPTION_KEY`
- `SERPER_API_KEY`
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_SERVICE_ID`
- `EMAILJS_TEMPLATE_ID`
- `GEMINI_API_KEY`
- `ALLOWED_ORIGINS`
- `ALLOWED_REDIRECT_URIS`
- `BB_ENCRYPTION_KEY`
- `LOG_LEVEL`

Railway provides `PORT`, so you do not need to hardcode it unless you want to override the default.

### 3. Configure the OAuth redirect list

The backend rejects unknown redirect URIs. Add the Chrome extension redirect URI used by your extension build to:

- `ALLOWED_REDIRECT_URIS` in Railway
- the allowed redirect URI list in your Canvas OAuth app
- the allowed redirect URI list in your Blackbaud OAuth app

The extension gets that URI from `chrome.identity.getRedirectURL()`.

### 4. Point the extension at your Railway backend

After Railway gives you a project URL:

1. Replace the current Railway domain in `extension/background.js` with your Railway project URL.
2. Replace the matching host permission in `extension/manifest.json`.
3. Reload the unpacked extension.
4. Update `ALLOWED_ORIGINS` so it includes the extension origin for the reloaded build.

### 5. Load and test the extension

1. Load `./extension` as an unpacked extension.
2. Complete Canvas sign-in.
3. Confirm the backend health endpoint is live on Railway.
4. Confirm chat, Blackbaud, and Gmail flows still work.

## Production notes

- The backend uses in-memory `Map` storage for synced data, user settings, Blackbaud tokens, and Canvas refresh tokens. Restarting the Railway service clears that state.
- The backend writes logs to `./backend/logs` when run locally.
- The repository includes `./backend/.railwayignore` with `node_modules`, `.env`, and `logs` ignored.
