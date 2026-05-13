# NhatGPT

NhatGPT is a Chrome extension plus a Node.js backend for Christ Church School. In the extension UI it is branded as **Canvas AI Assistant**. The current codebase is built around Christchurch School services and currently talks to a Railway-hosted backend.

## What the project does today

- Connects to **Canvas** with OAuth or a manual Canvas API token
- Opens an in-page **AI chat** overlay on Canvas pages
- Builds an **academic dashboard** with a daily briefing, course health, workload, grade trends, a grade what-if simulator, Blackbaud schedule data, and Sage Dining menu data
- Connects to **Blackbaud** for schedule and calendar data
- Connects to **Gmail** with read-only access for school email summaries
- Uses **Google Gemini** on the backend for chat and briefing generation
- Uses **Serper** for web search tool calls and **EmailJS** for issue reporting

## Current scope and limits

- The checked-in extension is hardcoded for `https://christchurchschool.instructure.com` and Christchurch-specific services.
- The checked-in extension backend URL is `https://canvas-ai-assistant-production.up.railway.app`.
- The backend stores synced data, settings, and OAuth refresh tokens in memory. Restarting the server clears that state.
- `backend/package.json` includes `test` and `lint` scripts, but the repository currently has no Jest tests and no ESLint config.

## Tech stack

### Extension
- Chrome Extension Manifest V3
- Plain HTML, CSS, and JavaScript
- Chrome Identity, Storage, Tabs, Notifications, and Messaging APIs

### Backend
- Node.js 18
- Express
- helmet, cors, compression, node-cron, winston
- Google Gemini 2.5 Flash via the Generative Language API

### External services
- Canvas LMS API
- Blackbaud SKY API
- Gmail API
- Sage Dining
- Serper
- EmailJS
- Railway

## Repository layout

- `./extension` - Chrome extension source
- `./backend` - Express backend
- `./INSTALLATION.md` - local setup and Railway deployment guide

## Quickstart

### Fastest way to run the current checked-in build

1. Load `./extension` as an unpacked extension in Chrome.
2. Open the extension and complete the Canvas sign-in flow from the welcome page, or add a Canvas API token in the options page.
3. Optionally connect Blackbaud and Gmail from the options page.
4. Open a Canvas page and use the popup, chatbot, or dashboard.

### If you need to work on the backend

1. Use Node 18.
2. From `./backend`, run `npm install`.
3. Copy `.env.example` to `.env` and add the required values described in `INSTALLATION.md`.
4. Start the server with `npm start`.

> The extension source in this repository does **not** point to `localhost`. To use your own backend, update the hardcoded Railway URL in `extension/background.js` and the matching host permission in `extension/manifest.json`, then reload the unpacked extension.

## Deployment

Production deployment for this project is Railway-only. Use `INSTALLATION.md` for the full Railway setup, required environment variables, and the extension changes needed to point at a new Railway project.
