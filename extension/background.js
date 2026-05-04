importScripts('trimester_utils.js');

// Handles extension lifecycle, data management, and API communication
class OAuthService {
    constructor() {
        this.CANVAS_CLIENT_ID = '163020000000000210'; 
        this.CANVAS_DOMAIN = 'https://christchurchschool.instructure.com';
        this.DEBUG = false;
        this.pendingState = null; // For CSRF validation
    }

    _log(message, ...args) {
        if (this.DEBUG) {
            console.debug(`[OAuthService] ${message}`, ...args);
        }
    }

    // 🛡️ FIX #3a: Cryptographically secure random string
    generateSecureRandom(length = 64) {
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }

    // 🛡️ FIX #3b: PKCE code_verifier (43-128 chars, URL-safe)
    generateCodeVerifier() {
        const array = new Uint8Array(48); // 48 bytes → 64 base64url chars
        crypto.getRandomValues(array);
        return this.base64UrlEncode(array);
    }

    // 🛡️ FIX #3c: PKCE code_challenge = SHA-256(code_verifier), base64url-encoded
    async generateCodeChallenge(codeVerifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return this.base64UrlEncode(new Uint8Array(digest));
    }

    // Helper: base64url encoding (no padding, URL-safe)
    base64UrlEncode(buffer) {
        const base64 = btoa(String.fromCharCode(...buffer));
        return base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async startOAuthFlow() {
        try {
            const redirectUrl = chrome.identity.getRedirectURL();
            this._log('Starting OAuth flow with PKCE...');
    
            const codeVerifier = this.generateCodeVerifier();
            const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    
            const state = this.generateSecureRandom(32);
            this.pendingState = state;
    
            const authUrl = this.getAuthUrl(redirectUrl, codeChallenge, state);
    
            const responseUrl = await chrome.identity.launchWebAuthFlow({
                url: authUrl,
                interactive: true
            });
    
            const url = new URL(responseUrl);
            const code = url.searchParams.get('code');
            const returnedState = url.searchParams.get('state');
    
            if (!returnedState || returnedState !== this.pendingState) {
                this.pendingState = null;
                throw new Error('OAuth state mismatch — possible CSRF attack. Please try again.');
            }
            this.pendingState = null;
    
            if (!code) throw new Error('No authorization code in response');
    
            this._log('Authorization code received, exchanging with PKCE...');
    
            const tokenData = await this.exchangeCodeForToken(code, redirectUrl, codeVerifier);
    
            // 🛡️ Store access token in session only (ephemeral)
            await chrome.storage.session.set({
                canvasToken: tokenData.access_token,
                tokenExpiry: Date.now() + ((tokenData.expires_in || 3600) * 1000)
            });
    
            // 🛡️ FIX: No refresh token stored client-side — server holds it encrypted
            await chrome.storage.local.set({
                authStatus: 'authenticated',
                authTimestamp: Date.now()
            });
    
            this._log('Token exchange successful (with PKCE)');
    
            await this.updateBadgeAfterAuth();
            return tokenData;
    
        } catch (error) {
            this.pendingState = null;
            console.error('OAuth flow failed:', error.message);
            await this.updateBadgeOnError();
            throw error;
        }
    }

    async updateBadgeAfterAuth() {
        try {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.id) {
                    await chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
                    await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId: tab.id });
                }
            }
            await chrome.action.setBadgeText({ text: '✓' });
            await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        } catch (e) {
            console.warn('Failed to update badge:', e);
        }
    }

    async updateBadgeOnError() {
        try {
            await chrome.action.setBadgeText({ text: '!' });
            await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
        } catch (e) {
            console.warn('Failed to update badge:', e);
        }
    }

    // 🛡️ Updated: Accepts codeChallenge and state
    getAuthUrl(redirectUrl, codeChallenge, state) {
        const params = new URLSearchParams({
            client_id: this.CANVAS_CLIENT_ID,
            response_type: 'code',
            redirect_uri: redirectUrl,
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });

        return `${this.CANVAS_DOMAIN}/login/oauth2/auth?${params.toString()}`;
    }

    // 🛡️ Updated: Sends code_verifier to backend for PKCE verification
    async exchangeCodeForToken(code, redirectUrl, codeVerifier) {
        this._log('Exchanging authorization code via backend proxy (with PKCE)...');

        const response = await fetch('https://canvas-ai-assistant-production.up.railway.app/api/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                redirect_uri: redirectUrl,
                code_verifier: codeVerifier
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Token exchange failed: ${response.status}`);
        }

        const tokenData = await response.json();

        if (!tokenData.access_token) {
            throw new Error('No access_token in response');
        }

        this._log('Token exchange successful');
        return tokenData;
    } 

    async validateToken(token) {
        try {
            const response = await fetch(`${this.CANVAS_DOMAIN}/api/v1/users/self/profile`, {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: AbortSignal.timeout(10000)
            });
            return response.ok;
        } catch (error) {
            console.error('Token validation failed:', error.message);
            return false;
        }
    }
}
class BlackbaudAuthService {
    constructor() {
        this.BLACKBAUD_CLIENT_ID = 'e8cf4709-e545-4246-9944-08fa837a981c';
        this.BLACKBAUD_REDIRECT_URI = chrome.identity.getRedirectURL();
    }

    async startOAuthFlow() {
        try {
            // Generate CSRF state
            const state = this.generateSecureRandom(32);
            this.pendingState = state;
    
            // Generate PKCE pair
            const codeVerifier = this.generateCodeVerifier();
            const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    
            const params = new URLSearchParams({
                client_id: this.BLACKBAUD_CLIENT_ID,
                response_type: 'code',
                redirect_uri: this.BLACKBAUD_REDIRECT_URI,
                state: state,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256'
            });
    
            const authUrl = `https://oauth2.sky.blackbaud.com/authorization?${params.toString()}`;
    
            const redirectResult = await chrome.identity.launchWebAuthFlow({
                url: authUrl,
                interactive: true
            });
    
            const url = new URL(redirectResult);
            const code = url.searchParams.get('code');
            const returnedState = url.searchParams.get('state');
    
            // Validate state
            if (!returnedState || returnedState !== this.pendingState) {
                this.pendingState = null;
                throw new Error('OAuth state mismatch — possible CSRF attack');
            }
            this.pendingState = null;
    
            if (!code) throw new Error('No authorization code received');
    
            return await this.exchangeCodeForToken(code, codeVerifier);
        } catch (error) {
            this.pendingState = null;
            console.error('Blackbaud OAuth flow failed:', error);
            throw error;
        }
    }
    
    // Reuse the same CSPRNG helpers from OAuthService
    generateSecureRandom(length = 64) {
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }
    
    generateCodeVerifier() {
        const array = new Uint8Array(48);
        crypto.getRandomValues(array);
        return this.base64UrlEncode(array);
    }
    
    async generateCodeChallenge(codeVerifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return this.base64UrlEncode(new Uint8Array(digest));
    }
    
    base64UrlEncode(buffer) {
        const base64 = btoa(String.fromCharCode(...buffer));
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    async exchangeCodeForToken(code, codeVerifier) {
        // 🛡️ FIX #4: Get Canvas user ID to associate Blackbaud tokens server-side
        const session = await chrome.storage.session.get(['canvasToken']);
        let canvasUserId = null;

        if (session.canvasToken) {
            try {
                const profileRes = await fetch(
                    'https://christchurchschool.instructure.com/api/v1/users/self/profile',
                    { headers: { 'Authorization': `Bearer ${session.canvasToken}` } }
                );
                if (profileRes.ok) {
                    const profile = await profileRes.json();
                    canvasUserId = profile.id;
                }
            } catch (e) {
                console.warn('Could not fetch Canvas user ID for Blackbaud linking:', e.message);
            }
        }

        if (!canvasUserId) {
            // Try from cached data
            const local = await chrome.storage.local.get(['canvasData']);
            canvasUserId = local.canvasData?.user?.id;
        }

        if (!canvasUserId) {
            throw new Error('Please log in to Canvas first before connecting Blackbaud.');
        }

        console.log('PKCE length:', codeVerifier?.length);

        const response = await fetch('https://canvas-ai-assistant-production.up.railway.app/api/blackbaud/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                redirect_uri: this.BLACKBAUD_REDIRECT_URI,
                canvas_user_id: canvasUserId,
                code_verifier: codeVerifier
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Blackbaud token exchange failed: ${errText}`);
        }

        const data = await response.json();

        // 🛡️ FIX #4: No tokens stored client-side anymore — server holds them encrypted
        await chrome.storage.local.set({
            bb_auth_status: 'authenticated',
            bb_auth_timestamp: Date.now()
        });

        // 🛡️ FIX #4: REMOVED — no more tokens in session or local storage
        // Previously: bb_access_token, bb_token_expiry, bb_refresh_token

        console.log('✅ Blackbaud connected (tokens stored server-side)');
        return { success: true };
    }

    // 🛡️ FIX #4: Refresh is now handled server-side automatically
    // This method is kept for explicit refresh requests but delegates to server
    async refreshAccessToken() {
        const canvasToken = await getCanvasTokenHelper();
        if (!canvasToken) throw new Error('Not authenticated with Canvas');

        const response = await fetch('https://canvas-ai-assistant-production.up.railway.app/api/blackbaud/oauth/refresh', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${canvasToken}`
            },
            body: JSON.stringify({}) // No refresh_token needed — server has it
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (errData.needsReconnect) {
                await chrome.storage.local.set({ bb_auth_status: 'disconnected' });
            }
            throw new Error('Blackbaud token refresh failed');
        }

        console.log('✅ Blackbaud token refreshed (server-side)');
        return true; // No token returned to client
    }

    // 🛡️ FIX #4: Check if Blackbaud is connected (ask server)
    async isConnected() {
        try {
            const token = await getCanvasTokenHelper();
            if (!token) return false;
            const res = await fetch(`${BACKEND_URL}/api/blackbaud/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return false;
            const data = await res.json();
            return data.connected === true;
        } catch {
            return false;
        }
    }
}

// Helper to get Canvas token (used by BlackbaudAuthService)
async function getCanvasTokenHelper() {
    const session = await chrome.storage.session.get(['canvasToken']);
    if (session.canvasToken) return session.canvasToken;
    const local = await chrome.storage.local.get(['canvasToken']);
    return local.canvasToken || null;
}

class SageDiningMenuService {
    constructor() {
        this.siteBase = 'https://www.sagedining.com';
        this.menuId = 134980; // Christchurch menuId (discovered via DevTools)
        this.cachedByKey = new Map();
        this.CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
    }

    buildKey(mealType, date) {
        return `${date || 'today'}::${(mealType || 'all').toLowerCase()}`;
    }

    // Sage expects date as MM/DD/YYYY
    toSageDate(date) {
        if (!date) {
            const d = new Date();
            return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
        }

        // Accept YYYY-MM-DD or MM/DD/YYYY
        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const [y, m, d] = date.split('-').map(Number);
            return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
        }

        if (typeof date === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(date)) return date;

        // Fallback: try Date parse
        const parsed = new Date(date);
        if (!isNaN(parsed.getTime())) {
            return `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}/${parsed.getFullYear()}`;
        }

        // Last resort: today
        return this.toSageDate(null);
    }

    async fetchMenu(mealType = 'Breakfast', date = null) {
        const sageDate = this.toSageDate(date);

        // Sage values appear Title-Cased: Breakfast/Lunch/Dinner
        const meal = mealType ? (mealType.charAt(0).toUpperCase() + mealType.slice(1).toLowerCase()) : null;

        // Cache per meal+date
        const key = this.buildKey(meal || 'all', sageDate);
        const cached = this.cachedByKey.get(key);
        if (cached && Date.now() < cached.expiresAt) {
            console.log('🍽️ [SAGE] Cache hit:', key);
            return cached.value;
        }

        // If no meal specified, fetch all 3 and combine
        const mealsToFetch = meal ? [meal] : ['Breakfast', 'Lunch', 'Dinner'];

        console.log('🍽️ [SAGE] Fetching menu', { sageDate, mealsToFetch, menuId: this.menuId });

        const results = {};
        for (const m of mealsToFetch) {
            const url = new URL('/microsites/getMenuItems', this.siteBase);
            url.searchParams.set('menuId', String(this.menuId));
            url.searchParams.set('date', sageDate);
            url.searchParams.set('meal', m);
            url.searchParams.set('mode', '');

            console.log('🍽️ [SAGE] Request:', url.toString());

            const resp = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            console.log('🍽️ [SAGE] Status:', resp.status, m);

            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                throw new Error(`Sage menu fetch failed (${m}) HTTP ${resp.status}: ${text.slice(0, 200)}`);
            }

            const json = await resp.json();
            results[m.toLowerCase()] = this.normalizeSageResponse(json, m);
        }

        const payload = {
            success: true,
            date: sageDate,
            meals: results
        };

        this.cachedByKey.set(key, { value: payload, expiresAt: Date.now() + this.CACHE_DURATION });
        return payload;
    }

    normalizeSageResponse(json, mealName) {
        // json is like: { "Soups": [...], "Salads": [...], "Deli": [...], ... }
        // Each value appears to be an array of item objects/strings.
        const items = [];

        if (!json || typeof json !== 'object') return items;

        for (const [station, arr] of Object.entries(json)) {
            if (!Array.isArray(arr)) continue;

            for (const entry of arr) {
                const name =
                    (entry && typeof entry === 'object' && (entry.name || entry.item || entry.title)) ||
                    (typeof entry === 'string' ? entry : null);

                if (!name) continue;

                items.push({
                    name: String(name).trim(),
                    category: station,
                    meal: mealName
                });
            }
        }

        // de-dupe by name+category
        const seen = new Set();
        return items.filter(i => {
            const k = `${i.category}::${i.name}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    formatMenuResponse(menuData, mealType = null) {
        if (!menuData?.success) {
            return "I couldn't fetch the dining menu right now. Please check https://www.sagedining.com/sites/christchurch/menu";
        }

        const mealEmojis = { breakfast: '🌅', lunch: '☀️', dinner: '🌙' };
        const dateLabel = menuData.date;

        let out = `🍽️ **Dining Hall Menu** (${dateLabel})\n\n`;

        const meals = mealType
            ? { [mealType.toLowerCase()]: menuData.meals?.[mealType.toLowerCase()] }
            : menuData.meals;

        for (const [meal, items] of Object.entries(meals || {})) {
            if (!items || items.length === 0) continue;

            out += `${mealEmojis[meal] || '🍴'} **${meal.charAt(0).toUpperCase() + meal.slice(1)}**\n`;

            // Group by station/category
            const byStation = items.reduce((acc, it) => {
                const station = it.category || 'Menu';
                (acc[station] ||= []).push(it.name);
                return acc;
            }, {});

            for (const [station, names] of Object.entries(byStation)) {
                out += `\n**${station}:**\n`;
                names.slice(0, 30).forEach(n => (out += `• ${n}\n`));
            }

            out += `\n`;
        }

        if (out.trim() === `🍽️ **Dining Hall Menu** (${dateLabel})`) {
            out += `Menu details aren't available right now. Check:\nhttps://www.sagedining.com/sites/christchurch/menu`;
        }

        return out;
    }
}

class GmailService {
    constructor() {
        this.baseUrl = 'https://www.googleapis.com/gmail/v1/users/me';
        this.cachedEmails = null;
        this.cacheExpiry = 0;
        this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Get OAuth token using chrome.identity
     */
    async getAuthToken(interactive = true) {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!token) {
                    reject(new Error('No token received'));
                } else {
                    resolve(token);
                }
            });
        });
    }

    /**
     * Disconnect Gmail access
     */
    async disconnect() {
        return new Promise((resolve) => {
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
                if (chrome.runtime.lastError || !token) {
                    this.cachedEmails = null;
                    this.cacheExpiry = 0;
                    resolve({ success: true });
                    return;
                }
                fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
                    .finally(() => {
                        chrome.identity.removeCachedAuthToken({ token }, () => {
                            this.cachedEmails = null;
                            this.cacheExpiry = 0;
                            resolve({ success: true });
                        });
                    });
            });
        });
    }

    /**
     * Check if Gmail is connected (non-interactive)
     */
    async isConnected() {
        try {
            const token = await this.getAuthToken(false);
            // Quick validation — hit Gmail profile
            const res = await fetch(`${this.baseUrl}/profile`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get connected Gmail address
     */
    async getEmailAddress() {
        try {
            const token = await this.getAuthToken(false);
            const res = await fetch(`${this.baseUrl}/profile`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data.emailAddress || null;
        } catch {
            return null;
        }
    }

    /**
     * Fetch school announcement emails
     */
    async fetchSchoolEmails(options = {}, interactive = false) {
        const {
            maxResults = 15,
            daysBack = 7,
            senderDomains = ['christchurchschool.org'],
            subjectKeywords = []
        } = options;

        // Check cache first
        if (this.cachedEmails && Date.now() < this.cacheExpiry) {
            console.log('📧 GmailService: Returning cached emails');
            return { success: true, emails: this.cachedEmails, fromCache: true };
        }

        try {
            // ✅ FIX: Use non-interactive by default — token should already exist
            // from when user connected Gmail in settings
            let token;
            try {
                token = await this.getAuthToken(false);
            } catch (nonInteractiveErr) {
                if (interactive) {
                    console.log('📧 GmailService: Non-interactive failed, trying interactive...');
                    token = await this.getAuthToken(true);
                } else {
                    console.warn('📧 GmailService: Non-interactive auth failed. User may need to reconnect Gmail.');
                    return { 
                        success: false, 
                        error: 'Gmail session expired. Please reconnect Gmail in the extension settings.',
                        needsReconnect: true,
                        emails: [] 
                    };
                }
            }

            // Build Gmail search query
            const afterDate = new Date();
            afterDate.setDate(afterDate.getDate() - daysBack);
            const dateStr = `${afterDate.getFullYear()}/${afterDate.getMonth() + 1}/${afterDate.getDate()}`;

            // Search by sender domain(s)
            const domainQuery = senderDomains
                .map(d => `from:${d}`)
                .join(' OR ');

            let query = `(${domainQuery}) after:${dateStr}`;

            // Optionally filter by subject keywords
            if (subjectKeywords.length > 0) {
                const subjectQuery = subjectKeywords
                    .map(kw => `subject:${kw}`)
                    .join(' OR ');
                query += ` (${subjectQuery})`;
            }

            console.log(`📧 GmailService: Searching with query: ${query}`);

            // Step 1: List message IDs
            const listUrl = `${this.baseUrl}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
            const listRes = await fetch(listUrl, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!listRes.ok) {
                if (listRes.status === 401) {
                    // Token expired — clear and retry if interactive
                    await new Promise(resolve => {
                        chrome.identity.removeCachedAuthToken({ token }, resolve);
                    });
                    
                    if (interactive) {
                        // Retry with fresh interactive token
                        const freshToken = await this.getAuthToken(true);
                        const retryRes = await fetch(listUrl, {
                            headers: { Authorization: `Bearer ${freshToken}` }
                        });
                        if (!retryRes.ok) {
                            throw new Error(`Gmail API error after retry: ${retryRes.status}`);
                        }
                        // Continue with retryRes below... 
                        // (For simplicity, throw and let user reconnect)
                    }
                    
                    return {
                        success: false,
                        error: 'Gmail token expired. Please reconnect Gmail in settings.',
                        needsReconnect: true,
                        emails: []
                    };
                }
                throw new Error(`Gmail API error: ${listRes.status}`);
            }


            const listData = await listRes.json();
            const messageIds = listData.messages || [];

            if (messageIds.length === 0) {
                return { success: true, emails: [], message: 'No school emails found.' };
            }

            // Step 2: Fetch each message's metadata (parallel)
            const emails = await Promise.all(
                messageIds.slice(0, maxResults).map(async ({ id }) => {
                    try {
                        const msgUrl = `${this.baseUrl}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
                        const msgRes = await fetch(msgUrl, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        if (!msgRes.ok) return null;

                        const msg = await msgRes.json();
                        const headers = msg.payload?.headers || [];

                        const getHeader = (name) =>
                            headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

                        return {
                            id: msg.id,
                            subject: getHeader('Subject'),
                            from: getHeader('From'),
                            date: getHeader('Date'),
                            snippet: msg.snippet || '',
                            labelIds: msg.labelIds || [],
                            gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`
                        };
                    } catch {
                        return null;
                    }
                })
            );

            const validEmails = emails.filter(Boolean);

            // Cache results
            this.cachedEmails = validEmails;
            this.cacheExpiry = Date.now() + this.CACHE_DURATION;

            console.log(`📧 GmailService: Found ${validEmails.length} school emails`);
            return { success: true, emails: validEmails };

        } catch (error) {
            console.error('📧 GmailService Error:', error);
            return { success: false, error: error.message, emails: [] };
        }
    }

    /**
     * Fetch full email body for a specific message
     */
    async getEmailBody(messageId) {
        try {
            const token = await this.getAuthToken(false);
            const url = `${this.baseUrl}/messages/${messageId}?format=full`;
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) throw new Error(`Failed to fetch email: ${res.status}`);

            const msg = await res.json();
            const body = this.extractTextBody(msg.payload);
            return { success: true, body, snippet: msg.snippet };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Recursively extract text/plain body from MIME payload
     */
    extractTextBody(payload) {
        if (!payload) return '';

        // Direct text/plain body
        if (payload.mimeType === 'text/plain' && payload.body?.data) {
            return this.decodeBase64Url(payload.body.data);
        }

        // Multipart — recurse into parts, prefer text/plain
        if (payload.parts) {
            for (const part of payload.parts) {
                const text = this.extractTextBody(part);
                if (text) return text;
            }
        }

        // Fallback: decode body.data even if not text/plain
        if (payload.body?.data) {
            return this.decodeBase64Url(payload.body.data);
        }

        return '';
    }

    /**
     * Decode base64url-encoded string (Gmail uses URL-safe base64)
     */
    decodeBase64Url(data) {
        try {
            const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
            return atob(base64);
        } catch {
            return '';
        }
    }

    /**
     * Clear cache (useful after settings changes)
     */
    clearCache() {
        this.cachedEmails = null;
        this.cacheExpiry = 0;
    }
}

class CanvasAIBackground {
    constructor() {
        this.apiEndpoint = 'https://canvas-ai-assistant-production.up.railway.app/api';
        this.isInitialized = false;
        this.oauthService = new OAuthService();
        this.blackbaudAuth = new BlackbaudAuthService();
        this.setupEventListeners();
        this.agentManager = null;
        this.apiKey = null;      // Will hold the Canvas Token
        this.canvasBaseUrl = 'https://christchurchschool.instructure.com'; // Default fallback
        this.menuService = new SageDiningMenuService();
        this.gmailService = new GmailService();
        this.conversationHistory = []; 
        this.loadConversationHistory();
    }

    async initialize() {
        if (this.isInitialized) return;
        console.log('Canvas AI Assistant: Background initialized');
        this.isInitialized = true;
    
        // 🛡️ FIX: Remove any legacy refresh tokens from local storage
        try {
            const legacy = await chrome.storage.local.get(['refreshToken']);
            if (legacy.refreshToken) {
                await chrome.storage.local.remove(['refreshToken']);
                console.log('🛡️ Removed legacy refresh token from local storage');
            }
            // On startup, verify Blackbaud is still valid server-side
            this.verifyBlackbaudOnStartup();
        } catch (e) {
            console.warn('Failed to clean legacy tokens:', e);
        }
        this.keepAlive();
    }

    keepAlive() {
        setInterval(() => {
            chrome.storage.session.get('_keepAlive');   // cheap no-op read
        }, 20_000); // every 20s, before the 30s timeout
    }

    setupEventListeners() {
        // Extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstallation(details);
        });

        // Message handling
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async response
        });

        // Tab updates
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdate(tabId, changeInfo, tab);
        });

        // Action button click
        chrome.action.onClicked.addListener((tab) => {
            this.handleActionClick(tab);
        });

        // Storage changes
        chrome.storage.onChanged.addListener((changes, namespace) => {
            this.handleStorageChange(changes, namespace);
        });
    }

    async verifyBlackbaudOnStartup() {
        try {
            const connected = await this.blackbaudAuth.isConnected();
            if (!connected) {
                console.warn('[BB] Startup check: Blackbaud not connected or server lost tokens');
            } else {
                console.log('[BB] Startup check: Blackbaud ✅ verified');
            }
        } catch (err) {
            console.warn('[BB] Startup check failed:', err.message);
        }
    }

    async authenticatedFetch(url, options = {}) {
        const isOurBackend = url.includes('canvas-ai-assistant-production.up.railway.app');
        
        if (isOurBackend) {
            const canvasToken = await this.getCanvasToken();
            
            if (canvasToken) {
                // ✅ NEW: Use the user's own Canvas token as auth
                options.headers = {
                    ...options.headers,
                    'Authorization': `Bearer ${canvasToken}`
                };
            } else {
                // Fallback for pre-auth requests (oauth/token, oauth/refresh)
                const storage = await chrome.storage.local.get(['extensionApiSecret']);
                const apiSecret = storage.extensionApiSecret || '';
                options.headers = {
                    ...options.headers,
                    'x-extension-key': apiSecret
                };
            }
        }
        return fetch(url, options);
    }

    async getCanvasToken() {
        // 1. Check session storage (where tokens live after security fix)
        const session = await chrome.storage.session.get(['canvasToken']);
        if (session.canvasToken) return session.canvasToken;

        // 2. Check local storage (legacy / manual token entry)
        const local = await chrome.storage.local.get(['canvasToken']);
        if (local.canvasToken) {
            // Migrate to session storage and return
            await chrome.storage.session.set({ canvasToken: local.canvasToken });
            return local.canvasToken;
        }

        return null;
    }
    
    async handleInstallation(details) {
        const manifest = chrome.runtime.getManifest();
        
        console.log(`Canvas AI Assistant v${manifest.version} installed`);
        await this.initializeStorage();

        if (details.reason === 'install') {
            // First time installation
            await chrome.storage.local.set({
                firstInstall: true,
                version: manifest.version,
                installDate: new Date().toISOString(),
                authStatus: 'unauthenticated'
            });
            
            // Open options page
            chrome.tabs.create({
                url: chrome.runtime.getURL('welcome.html')
            });
            
        } else if (details.reason === 'update') {
            // Extension update
            await chrome.storage.local.set({
                version: manifest.version,
                lastUpdate: new Date().toISOString()
            });
        }
    }

    async loadConversationHistory() {
        try {
            const result = await chrome.storage.session.get(['conversationHistory']);
            this.conversationHistory = result.conversationHistory || [];
            console.log(`Background: Loaded ${this.conversationHistory.length} conversation turns from session`);
        } catch (e) {
            this.conversationHistory = [];
        }
    }
    
    async saveConversationHistory() {
        try {
            await chrome.storage.session.set({ 
                conversationHistory: this.conversationHistory.slice(-30) 
            });
        } catch (e) {
            console.warn('Failed to save conversation history:', e);
        }
    }

    async fetchSyllabus(courseId) {
        const endpoint = `/api/v1/courses/${courseId}/syllabus`;
        const response = await this.makeCanvasRequest(endpoint);
        return response;
    }

    async checkAuthStatus() {
        try {
            const token = await this.getCanvasToken();
            const result = await chrome.storage.local.get(['authStatus']);
            return {
                isAuthenticated: result.authStatus === 'authenticated' && !!token,
                hasCanvasToken: !!token,
                authStatus: result.authStatus || 'unauthenticated'
            };
        } catch (error) {
            console.error('Background: Error checking auth status:', error);
            return { isAuthenticated: false, authStatus: 'error' };
        }
    }


    async validateCanvasToken(token, canvasUrl = null) {
        try {
            if (!token || typeof token !== 'string' || token.trim().length < 10) {
                console.log('Canvas AI Assistant: Invalid token format');
                return false;
            }
    
            const cleanToken = token.trim();
            
            // 🛡️ FIX: Always use hardcoded domain — ignore canvasUrl parameter
            const CANVAS_DOMAIN = 'https://christchurchschool.instructure.com';
            const testUrl = `${CANVAS_DOMAIN}/api/v1/users/self`;
            console.log('Canvas AI Assistant: Testing token with URL:', testUrl);
    
            const response = await fetch(testUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${cleanToken}`,
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(10000)
            });
    
            return response.ok;
            
        } catch (error) {
            console.error('Canvas AI Assistant: Token validation error:', error);
            return false;
        }
    }

    async detectCanvasUrl() {
        return 'https://christchurchschool.instructure.com';
    }

    async getAuthStatus() {
        try {
            // 🛡️ FIX: Check BOTH session and local storage
            const token = await this.getCanvasToken();
            const result = await chrome.storage.local.get(['apiKey', 'authStatus']);
            
            const isAuthenticated = !!(token && result.authStatus === 'authenticated');
            
            const status = {
                isAuthenticated: isAuthenticated,
                hasCanvasToken: !!token,
                hasOpenAIKey: !!result.apiKey,
                authStatus: result.authStatus || 'unauthenticated',
                dataSource: token ? 'api' : 'none'
            };
            
            console.log('Background: Computed auth status:', status);
            return status;
            
        } catch (error) {
            console.error('Background: Error getting auth status:', error);
            return {
                isAuthenticated: false,
                hasCanvasToken: false,
                hasOpenAIKey: false,
                authStatus: 'error',
                dataSource: 'error'
            };
        }
    }

    async handleMessage(request, sender, sendResponse) { 
        // 🛡️ Block external pages from triggering sensitive actions
        const isInternalMessage = sender.id === chrome.runtime.id; // From own content script or popup
        const sensitiveTypes = [
            'START_OAUTH_FLOW',
            'START_BLACKBAUD_OAUTH', 
            'SET_CANVAS_TOKEN',
            'UPDATE_SETTINGS',
            'AI_CHAT_REQUEST',
            'TRIGGER_MANUAL_SYNC',
            'GMAIL_CONNECT'
        ];

        if (!isInternalMessage && sensitiveTypes.includes(request.type)) {
            console.warn(`🛡️ Blocked external message: ${request.type} from`, sender);
            sendResponse({ success: false, error: 'Unauthorized' });
            return;
        }
        try {
            switch (request.type) {
                case 'GET_CANVAS_DATA':
                    await this.getCanvasData(sendResponse);
                    break;
                    
                case 'REFRESH_CANVAS_DATA':
                    await this.refreshCanvasDataAPI(sender.tab, sendResponse);
                    break;
                    
                case 'CANVAS_DATA_READY':
                    await this.processCanvasData(request.data, sender.tab);
                    sendResponse({ success: true });
                    break;
                    
                case 'AI_CHAT_REQUEST':
                    console.log("AI_Chat_Request");
                    await this.handleAIChatRequest(request.data, sendResponse);
                    break;
        
                case 'CLEAR_CHAT_HISTORY':
                    this.conversationHistory = [];
                    await chrome.storage.session.remove(['conversationHistory']);
                    sendResponse({ success: true });
                    break;
                
                case 'GMAIL_CONNECT':
                    await this.handleGmailConnect(sendResponse);
                    break;

                case 'GMAIL_DISCONNECT':
                    await this.handleGmailDisconnect(sendResponse);
                    break;

                case 'GMAIL_CHECK_CONNECTION':
                    await this.handleGmailCheckConnection(sendResponse);
                    break;

                case 'GMAIL_FETCH_EMAILS':
                    await this.handleGmailFetchEmails(request, sendResponse);
                    break;

                case 'GMAIL_GET_EMAIL_BODY':
                    await this.handleGmailGetEmailBody(request, sendResponse);
                    break;

                case 'GMAIL_CLEAR_CACHE':
                    this.handleGmailClearCache(sendResponse);
                    break;
                
                case 'VALIDATE_CANVAS_TOKEN':
                    const isValid = await this.validateCanvasToken(request.token);
                    sendResponse({ success: isValid });
                    break;
                        
                case 'SET_CANVAS_TOKEN':
                    // 🛡️ FIX: Store in BOTH session (primary) and local (for manual tokens)
                    await chrome.storage.session.set({ canvasToken: request.token });
                    await chrome.storage.local.set({ 
                        authStatus: 'authenticated' 
                    });
                    sendResponse({ success: true });
                    break;
                        
                case 'GET_AUTH_STATUS':
                    const authStatus = await this.getAuthStatus();
                    console.log("Sending with status from background: " + authStatus);
                    sendResponse({ authStatus });
                    break;
                
                case 'GET_SETTINGS':  
                    await this.getSettings(sendResponse);
                    break;
                
                case 'WEB_SEARCH':
                    console.log('📨 Background: Routing to handleWebSearch'); 
                    await this.handleWebSearch(request.data, sendResponse);
                    break;

                case 'PING':
                    sendResponse({ success: true });
                    return false;

                case 'FETCH_ANNOUNCEMENTS':
                    this.handleFetchAnnouncements(request, sendResponse);
                    return true;
                
                case 'FETCH_ASSIGNMENT_DETAIL':
                    await this.handleFetchAssignmentDetail(request, sendResponse);
                    break;

                case 'FETCH_BLACKBAUD_CALENDAR':
                    try {
                        const calendarData = await this.fetchBlackbaudCalendarData(request.startDate, request.endDate);
                        sendResponse({ success: true, data: calendarData });
                    } catch (error) {
                        sendResponse({
                            success: false,
                            error: error.message,
                            needsReconnect: error.needsReconnect === true
                        });
                    }
                    break;
                
                case 'BLACKBAUD_PROXY':
                    await this.handleBlackbaudRequest(request, sendResponse);
                    return true;

                case 'FETCH_BLACKBAUD_STUDENT_SCHEDULE':
                    try {
                        const scheduleData = await this.fetchBlackbaudStudentScheduleData(
                            request.referenceDate ? new Date(request.referenceDate) : new Date(),
                            request.userId ?? null
                        );
                        sendResponse({ success: true, data: scheduleData });
                    } catch (error) {
                        sendResponse({
                            success: false,
                            error: error.message,
                            needsReconnect: error.needsReconnect === true
                        });
                    }
                    break;

                case 'FETCH_GRADES':
                    this.handleFetchGrades(sendResponse);
                    return true;

                case 'FETCH_SYLLABI':
                    this.handleFetchSyllabi(request, sendResponse);
                    return true;

                case 'FETCH_COURSES':
                    this.handleFetchCourses(sendResponse);
                    return true;
                
                case 'GET_DINING_MENU':
                    const menuData = await this.menuService. fetchMenu(request.mealType, request.date);
                    const formattedMenu = this.menuService.formatMenuResponse(menuData, request.mealType);
                    sendResponse({ success: true, menu: formattedMenu, rawData: menuData });
                    break;

                case 'GET_EXTENSION_STATUS':
                    await this.getExtensionStatus(sendResponse);
                    break;

                case 'START_BLACKBAUD_OAUTH':
                    console.log('Background: Starting Blackbaud OAuth...');
                    try {
                        await this.blackbaudAuth.startOAuthFlow();
                        sendResponse({ success: true });
                    } catch (error) {
                        console.error('Background: Blackbaud OAuth failed:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                    break;
                    
                case 'UPDATE_SETTINGS':
                    await this.updateSettings(request.settings);
                    sendResponse({ success: true });
                    break;
                case 'TRIGGER_API_SYNC':
                    await this.triggerAPISync(sender.tab, sendResponse);
                    break;
                case 'MAKE_CANVAS_API_REQUEST':
                    console.log(`[Background] 📡 Received API Request: ${request.endpoint}`);
                    this.handleCanvasRequest(request, sendResponse);
                    break;
                case 'GET_AGENT_STATUS':
                    const agentStatus = await this.getAgentStatus();
                    sendResponse(agentStatus);
                    break;

                case 'START_OAUTH_FLOW': 
                    console.log('Background: Starting OAuth flow...');
                    try {
                        const tokenData = await this.oauthService.startOAuthFlow();
                        
                        // ✅ Update badge to show success (green checkmark)
                        await chrome.action.setBadgeText({ text: '✓' });
                        await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
                        
                        sendResponse({ success: true, token: tokenData });
                    } catch (error) {
                        console.error('Background: OAuth flow failed:', error);
                        
                        // ✅ Update badge to show error
                        await chrome.action.setBadgeText({ text: '!' });
                        await chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
                        
                        sendResponse({ success: false, error: error.message });
                    }
                    break;

                
                case 'SYNC_STATE_CHANGED':
                    // Store sync state for popup/other UI to query
                    await chrome.storage.local.set({ 
                        syncState: request.syncState,
                        lastSyncUpdate: Date.now()
                    });
                    // Update badge based on sync state
                    if (sender.tab) {
                        if (request.syncState.status === 'syncing') {
                            await this.updateBadge(sender.tab.id, 'syncing');
                        } else if (request.syncState.status === 'synced') {
                            await this.updateBadge(sender.tab.id, 'data-ready');
                        } else if (request.syncState.status === 'error') {
                            await this.updateBadge(sender.tab.id, 'error');
                        }
                    }
                    sendResponse({ success: true });
                    break;
                    
                case 'GET_SYNC_STATE':
                    const storedState = await chrome.storage.local.get(['syncState']);
                    sendResponse({ 
                        success: true, 
                        syncState: storedState.syncState || { status: 'idle', progress: 0 }
                    });
                    break;

                case 'SUBMIT_ISSUE_REPORT':
                    // Just log it - EmailJS handles the actual sending now
                    console.log('📧 Background: Issue report submitted via EmailJS');
                    await this.storeIssueReportLocally(request.data);
                    sendResponse({ success: true, message: 'Report logged' });
                    break;

                case 'FETCH_DINING_MENU': {
                    console.log('🍽️ [SAGE] FETCH_DINING_MENU', request);
    
                    (async () => {
                        try {
                            const mealType = request.mealType || null; // 'breakfast' | 'lunch' | 'dinner' | null
                            const date = request.date || null;         // allow YYYY-MM-DD
                            const data = await this.menuService.fetchMenu(mealType || null, date);
                            sendResponse({ success: true, data });
                        } catch (error) {
                            console.error('🍽️ [SAGE] error:', error);
                            sendResponse({ success: false, error: error.message });
                        }
                    })();
    
                    return true;
                }

                case 'BACKGROUND_SYNC':
                    console.log('Background: Received background sync request');
                    await this.performBackgroundSync(sendResponse);
                    break;

                case 'TRIGGER_MANUAL_SYNC':
                    console.log('Background: Manual sync requested from popup');
                    // Pre-check token before attempting full sync
                    try {
                        await this.ensureValidToken();
                    } catch (tokenErr) {
                        if (tokenErr.message === 'TOKEN_EXPIRED' || tokenErr.message === 'NO_TOKEN') {
                            sendResponse({
                                success: false,
                                error: 'Your Canvas session has expired. Please re-authenticate.',
                                authError: true,
                                needsReauth: true
                            });
                            break;
                        }
                    }
                    await this.performBackgroundSync(sendResponse);
                    break;

                case 'GET_CACHED_DATA':
                    try {
                        const cached = await chrome.storage.local.get(['canvasData', 'lastUpdate']);
                        sendResponse({
                            success: true,
                            data: cached.canvasData || null,
                            lastUpdate: cached.lastUpdate || null
                        });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message });
                    }
                    break;

                case 'GET_ACADEMIC_BRIEFING':
                    await this.handleGetAcademicBriefing(sendResponse);
                    break;

                case 'GET_COURSE_SIMULATOR_DATA':
                    await this.handleGetCourseSimulatorData(request, sendResponse);
                    break;

                default:
                    console.warn('Canvas AI Assistant: Unknown message type:', request.type);
                    sendResponse({ success: false, error: 'Unknown message type' });
            }
        } catch (error) {
            console.error('Canvas AI Assistant: Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    }
    async loadSettings() {
        const token = await this.getCanvasToken();

        this.apiKey = token || null;
        this.canvasBaseUrl = 'https://christchurchschool.instructure.com';
        
        if (this.apiKey) {
            console.log('✅ Background: Settings loaded. Token found.');
        } else {
            console.warn('⚠️ Background: Canvas Token missing in storage.');
        }
        
        return {
            apiKey: this.apiKey,
            canvasBaseUrl: this.canvasBaseUrl
        };
    }

    // 🔄 Validate token and attempt refresh if expired
    async ensureValidToken() {
        const session = await chrome.storage.session.get(['canvasToken', 'tokenExpiry']);
    
        const token = session.canvasToken;
        const expiry = session.tokenExpiry;
    
        if (!token) {
            // Check legacy local storage and migrate
            const legacy = await chrome.storage.local.get(['canvasToken']);
            if (legacy.canvasToken) {
                await chrome.storage.session.set({ canvasToken: legacy.canvasToken });
                await chrome.storage.local.remove(['canvasToken']);
                return legacy.canvasToken;
            }
            throw new Error('NOT_AUTHENTICATED');
        }
    
        // Check if token is expired (with 60s buffer)
        const isExpired = expiry && (Date.now() > expiry - 60000);
    
        if (!isExpired) {
            return token;
        }
    
        // 🛡️ FIX: Attempt server-side refresh — no refresh token sent from client
        try {
            const response = await fetch('https://canvas-ai-assistant-production.up.railway.app/api/oauth/refresh', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` // Server identifies user by this
                },
                body: JSON.stringify({}) // No refresh_token — server has it
            });
    
            if (response.ok) {
                const data = await response.json();
                
                await chrome.storage.session.set({
                    canvasToken: data.access_token,
                    tokenExpiry: Date.now() + ((data.expires_in || 3600) * 1000)
                });
    
                return data.access_token;
            }
            
            // If server says needsReauth, surface that
            const errData = await response.json().catch(() => ({}));
            if (errData.needsReauth) {
                throw new Error('TOKEN_EXPIRED');
            }
        } catch (err) {
            if (err.message === 'TOKEN_EXPIRED') throw err;
            console.error('Token refresh failed:', err.message);
        }
    
        // Refresh failed — clean up
        await chrome.storage.local.set({ authStatus: 'token_expired' });
        await chrome.storage.session.remove(['canvasToken', 'tokenExpiry']);
        // 🛡️ Remove any legacy refresh token from local storage
        await chrome.storage.local.remove(['refreshToken']);
        await this.updateBadge(null, 'error');
        throw new Error('TOKEN_EXPIRED');
    }


    getTrimesterForDate(date) {
        return globalThis.TrimesterUtils?.getTrimesterForDate(date) || null;
    }

    getCurrentTrimester() {
        return this.getTrimesterForDate(new Date());
    }

    // ─── GMAIL HANDLERS ──────────────────────────────────────────────

    async handleGmailConnect(sendResponse) {
        try {
            // ✅ This is user-initiated from settings, so interactive is fine
            const token = await this.gmailService.getAuthToken(true);
            const email = await this.gmailService.getEmailAddress();
            await chrome.storage.local.set({
                gmailConnected: true,
                gmailEmail: email,
                gmailConnectedAt: Date.now()
            });
            console.log(`📧 Gmail connected: ${email}`);
            sendResponse({ success: true, email });
        } catch (error) {
            console.error('📧 Gmail connect failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleGmailDisconnect(sendResponse) {
        try {
            await this.gmailService.disconnect();
            await chrome.storage.local.set({
                gmailConnected: false,
                gmailEmail: null,
                gmailConnectedAt: null
            });
            console.log('📧 Gmail disconnected');
            sendResponse({ success: true });
        } catch (error) {
            console.error('📧 Gmail disconnect failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleGmailCheckConnection(sendResponse) {
        try {
            const connected = await this.gmailService.isConnected();
            const email = connected ? await this.gmailService.getEmailAddress() : null;
            await chrome.storage.local.set({
                gmailConnected: connected,
                gmailEmail: email
            });
            sendResponse({ success: true, connected, email });
        } catch (error) {
            sendResponse({ success: true, connected: false, email: null });
        }
    }

    async handleGmailFetchEmails(request, sendResponse) {
        try {
            const gmailSettings = await chrome.storage.local.get([
                'gmailSenderDomains', 'gmailDaysBack', 'gmailMaxResults'
            ]);
            const options = {
                ...(request.options || {}),
                senderDomains: gmailSettings.gmailSenderDomains || ['christchurchschool.org'],
                daysBack: gmailSettings.gmailDaysBack || 7,
                maxResults: gmailSettings.gmailMaxResults || 15
            };
            
            // ✅ FIX: Try non-interactive first (works if user already authenticated)
            // Only fall back to interactive if explicitly requested (e.g., from settings page)
            const isInteractive = request.interactive === true;
            const result = await this.gmailService.fetchSchoolEmails(options, isInteractive);
            sendResponse(result);
        } catch (error) {
            console.error('📧 Gmail fetch failed:', error);
            sendResponse({ success: false, error: error.message, emails: [] });
        }
    }

    async handleGmailGetEmailBody(request, sendResponse) {
        try {
            const result = await this.gmailService.getEmailBody(request.messageId);
            sendResponse(result);
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }

    handleGmailClearCache(sendResponse) {
        this.gmailService.clearCache();
        sendResponse({ success: true });
    }


    async requestBlackbaudData(request) {
        const canvasToken = await this.getCanvasToken();
        if (!canvasToken) {
            throw new Error('Not authenticated with Canvas');
        }

        const response = await fetch('https://canvas-ai-assistant-production.up.railway.app/api/blackbaud/proxy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${canvasToken}`
            },
            body: JSON.stringify({
                endpoint: request.endpoint,
                method: request.method || 'GET',
                body: request.body || null
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (errData.needsReconnect) {
                await chrome.storage.local.set({ bb_auth_status: 'disconnected' });
            }

            const error = new Error(`Blackbaud proxy error: ${response.status}`);
            error.needsReconnect = Boolean(errData.needsReconnect);
            throw error;
        }

        const data = await response.json();
        return data.data || data;
    }

    // 🛡️ FIX #4: Blackbaud requests now go through backend proxy
    // which adds the subscription key server-side
    async handleBlackbaudRequest(request, sendResponse) {
        try {
            const data = await this.requestBlackbaudData(request);
            sendResponse({ success: true, data });
        } catch (error) {
            console.error('Blackbaud request failed:', error.message);
            sendResponse({
                success: false,
                error: error.message,
                needsReconnect: error.needsReconnect === true
            });
        }
    }

    normalizeBlackbaudDate(dateString) {
        if (!dateString || typeof dateString !== 'string') return null;
        const trimmed = dateString.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
        const parsed = this.parseBlackbaudDate(trimmed);
        return Number.isNaN(parsed.getTime()) ? null : trimmed;
    }

    parseBlackbaudDate(dateString) {
        return new Date(`${dateString}T00:00:00`);
    }

    toBlackbaudIsoDate(date) {
        return date.toISOString().split('T')[0];
    }

    getBlackbaudCalendarDateRange(startDate, endDate) {
        const now = new Date();
        let resolvedStart = this.normalizeBlackbaudDate(startDate);
        let resolvedEnd = this.normalizeBlackbaudDate(endDate);

        if (!resolvedStart && !resolvedEnd) {
            resolvedStart = this.toBlackbaudIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
            resolvedEnd = this.toBlackbaudIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        } else if (!resolvedStart && resolvedEnd) {
            const end = this.parseBlackbaudDate(resolvedEnd);
            resolvedStart = this.toBlackbaudIsoDate(new Date(end.getFullYear(), end.getMonth(), 1));
        } else if (resolvedStart && !resolvedEnd) {
            const start = this.parseBlackbaudDate(resolvedStart);
            resolvedEnd = this.toBlackbaudIsoDate(new Date(start.getFullYear(), start.getMonth() + 1, 0));
        }

        // Accept reversed input ranges and normalize them into chronological order.
        const startTime = this.parseBlackbaudDate(resolvedStart).getTime();
        const endTime = this.parseBlackbaudDate(resolvedEnd).getTime();
        if (startTime > endTime) {
            [resolvedStart, resolvedEnd] = [resolvedEnd, resolvedStart];
        }

        return { startDate: resolvedStart, endDate: resolvedEnd };
    }

    buildBlackbaudCalendarEndpoint(startDate, endDate) {
        const range = this.getBlackbaudCalendarDateRange(startDate, endDate);
        const params = new URLSearchParams({
            start_date: range.startDate,
            end_date: range.endDate
        });
        return `/school/v1/calendars/events?${params.toString()}`;
    }

    async fetchBlackbaudCalendarData(startDate, endDate) {
        const range = this.getBlackbaudCalendarDateRange(startDate, endDate);
        const rawData = await this.requestBlackbaudData({
            endpoint: this.buildBlackbaudCalendarEndpoint(range.startDate, range.endDate)
        });

        return {
            events: Array.isArray(rawData?.value) ? rawData.value : (Array.isArray(rawData) ? rawData : []),
            startDate: range.startDate,
            endDate: range.endDate
        };
    }

    /**
     * @param {Date} referenceDate
     * @returns {{startDate:string,endDate:string}}
     */
    getBlackbaudStudentScheduleDateRange(referenceDate) {
        const baseDate = new Date(referenceDate);
        baseDate.setHours(0, 0, 0, 0);
        const weekday = baseDate.getDay();
        const offsetFromMonday = weekday === 0 ? 6 : weekday - 1;
        baseDate.setDate(baseDate.getDate() - offsetFromMonday);

        const endDate = new Date(baseDate);
        endDate.setDate(baseDate.getDate() + 4);

        return {
            startDate: this.toBlackbaudIsoDate(baseDate),
            endDate: this.toBlackbaudIsoDate(endDate)
        };
    }

    /**
     * @param {string} userId  - Resolved Blackbaud numeric user ID
     * @param {string} startDate
     * @param {string} endDate
     * @returns {string}
     */
    buildBlackbaudStudentScheduleEndpoint(userId, startDate, endDate) {
        const params = new URLSearchParams({
            start_date: startDate,
            end_date: endDate
        });
        // Correct SKY API endpoint: student_id is a PATH segment, not a query param.
        // Docs: GET /school/v1/schedules/{student_id}/meetings?start_date=...&end_date=...
        return `/school/v1/schedules/${userId}/meetings?${params.toString()}`;
    }

    /**
     * Resolves the current student's Blackbaud user ID from cached Canvas data.
     * Falls back to fetching from the Blackbaud /users/me endpoint.
     * @returns {Promise<string|null>}
     */
    async getBlackbaudUserId() {
        // Try cached Canvas data first — Blackbaud often shares the same numeric ID
        const local = await chrome.storage.local.get(['blackbaudUserId', 'canvasData']);
        if (local.blackbaudUserId) return String(local.blackbaudUserId);

        try {
            const data = await this.requestBlackbaudData({ endpoint: '/school/v1/users/me' });
            console.log('[BB Debug] /users/me response:', JSON.stringify(data)); // 👈 add this
            const userId = data?.id || data?.user_id || data?.UserId;
            if (userId) {
                await chrome.storage.local.set({ blackbaudUserId: String(userId) });
                return String(userId);
            }
        } catch (err) {
            console.warn('getBlackbaudUserId failed:', err.message);
        }
        return null;
    }

    /**
     * @param {Date} referenceDate
     * @returns {Promise<{entries:Array<{date:string,startTime:string,endTime:string,courseName:string,teacherName:string,room:string}>,startDate:string,endDate:string}>}
     */
    async fetchBlackbaudStudentScheduleData(referenceDate, resolvedUserId = null) {
        const range = this.getBlackbaudStudentScheduleDateRange(referenceDate);

        // Use the ID passed from dashboard if available, otherwise resolve it
        const userId = resolvedUserId ?? await this.getBlackbaudUserId();
        if (!userId) {
            throw new Error('Blackbaud user ID could not be resolved. Ensure Blackbaud is connected.');
        }

        const rawData = await this.requestBlackbaudData({
            endpoint: this.buildBlackbaudStudentScheduleEndpoint(userId, range.startDate, range.endDate)
        });

        return {
            entries: this.normalizeBlackbaudStudentScheduleEntries(rawData, range),
            startDate: range.startDate,
            endDate: range.endDate
        };
    }

    /**
     * @param {unknown} rawData
     * @param {{startDate:string,endDate:string}} range
     * @returns {Array<{date:string,startTime:string,endTime:string,courseName:string,teacherName:string,room:string}>}
     */
    normalizeBlackbaudStudentScheduleEntries(rawData, range) {
        const rawEntries = Array.isArray(rawData?.value)
            ? rawData.value
            : Array.isArray(rawData?.schedule)
                ? rawData.schedule
                : Array.isArray(rawData)
                    ? rawData
                    : [];

        const dayLookup = new Map();
        for (let offset = 0; offset < 5; offset += 1) {
            const dayDate = this.parseBlackbaudDate(range.startDate);
            dayDate.setDate(dayDate.getDate() + offset);
            const isoDate = this.toBlackbaudIsoDate(dayDate);
            const fullDay = dayDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            const shortDay = dayDate.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
            dayLookup.set(fullDay, isoDate);
            dayLookup.set(shortDay, isoDate);
        }

        const normalizedEntries = [];
        const rangeStartTime = this.parseBlackbaudDate(range.startDate).getTime();
        const rangeEndTime = this.parseBlackbaudDate(range.endDate).getTime();
        rawEntries.forEach(entry => {
            const startSource = entry?.start_time || entry?.startTime || entry?.start || entry?.start_date;
            const endSource = entry?.end_time || entry?.endTime || entry?.end || entry?.end_date;
            const normalizedEntry = {
                startTime: this.normalizeBlackbaudScheduleTime(startSource),
                endTime: this.normalizeBlackbaudScheduleTime(endSource),
                courseName: entry?.course_name || entry?.course || entry?.section_name || entry?.class_name || entry?.name || 'Class',
                teacherName: this.extractBlackbaudScheduleTeacherName(entry),
                room: this.extractBlackbaudScheduleRoom(entry)
            };

            const explicitDate = this.extractBlackbaudScheduleDate(
                entry?.meeting_date || entry?.date || entry?.class_date || entry?.start_date || entry?.start_time || entry?.start
            );            
            const explicitDateTime = explicitDate ? this.parseBlackbaudDate(explicitDate).getTime() : null;
            if (explicitDateTime != null && explicitDateTime >= rangeStartTime && explicitDateTime <= rangeEndTime) {
                normalizedEntries.push({ date: explicitDate, ...normalizedEntry });
                return;
            }

            this.extractBlackbaudStudentScheduleDays(entry, dayLookup).forEach(date => {
                normalizedEntries.push({ date, ...normalizedEntry });
            });
        });

        const uniqueEntries = [];
        const seenEntries = new Set();
        normalizedEntries.forEach(entry => {
            const entryKey = [entry.date, entry.startTime, entry.endTime, entry.courseName, entry.teacherName, entry.room].join('\0');
            if (seenEntries.has(entryKey)) return;
            seenEntries.add(entryKey);
            uniqueEntries.push(entry);
        });

        return uniqueEntries.sort((a, b) => {
            if (a.date !== b.date) {
                return a.date.localeCompare(b.date);
            }
            return String(a.startTime || '').localeCompare(String(b.startTime || ''));
        });
    }

    /**
     * @param {Record<string, any>} entry
     * @param {Map<string,string>} dayLookup
     * @returns {Array<string>}
     */
    extractBlackbaudStudentScheduleDays(entry, dayLookup) {
        const rawDays = [];

        if (Array.isArray(entry?.days)) rawDays.push(...entry.days);
        if (Array.isArray(entry?.day_names)) rawDays.push(...entry.day_names);
        if (Array.isArray(entry?.meeting_days)) rawDays.push(...entry.meeting_days);
        if (entry?.day_name) rawDays.push(entry.day_name);
        if (entry?.day) rawDays.push(entry.day);

        return rawDays
            .map(day => {
                if (typeof day === 'number') {
                    const normalizedDayIndex = this.normalizeBlackbaudScheduleDayIndex(day);
                    return normalizedDayIndex == null ? null : dayLookup.get(['mon', 'tue', 'wed', 'thu', 'fri'][normalizedDayIndex]);
                }

                const normalizedDay = String(day || '').trim().toLowerCase();
                return dayLookup.get(normalizedDay) || dayLookup.get(normalizedDay.slice(0, 3)) || null;
            })
            .filter(Boolean);
    }

    /**
     * @param {number} dayValue
     * @returns {number|null}
     */
    normalizeBlackbaudScheduleDayIndex(dayValue) {
        if (dayValue >= 1 && dayValue <= 5) return dayValue - 1;
        if (dayValue >= 0 && dayValue <= 4) return dayValue;
        return null;
    }

    /**
     * @param {unknown} value
     * @returns {string|null}
     */
    extractBlackbaudScheduleDate(value) {
        if (!value) return null;
        const parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) return null;
        return this.toBlackbaudIsoDate(parsedDate);
    }

    /**
     * @param {unknown} timeValue
     * @returns {string}
     */
    normalizeBlackbaudScheduleTime(timeValue) {
        if (!timeValue) return '';
        const matchedTime = String(timeValue).match(/(\d{1,2}):(\d{2})/);
        if (!matchedTime) return '';
        return `${matchedTime[1].padStart(2, '0')}:${matchedTime[2]}`;
    }

    /**
     * @param {Record<string, any>} entry
     * @returns {string}
     */
    extractBlackbaudScheduleTeacherName(entry) {
        const teacherSources = [
            entry?.teacher,
            entry?.primary_teacher,
            entry?.lead_teacher,
            Array.isArray(entry?.teachers) ? entry.teachers[0] : null
        ];

        for (const teacher of teacherSources) {
            if (!teacher) continue;
            if (typeof teacher === 'string') return teacher;
            const name = teacher.display_name || teacher.name || teacher.full_name;
            if (name) return name;
        }

        return '';
    }

    /**
     * @param {Record<string, any>} entry
     * @returns {string}
     */
    extractBlackbaudScheduleRoom(entry) {
        const roomValue = entry?.room
            || entry?.room_name
            || entry?.location
            || entry?.location_name
            || entry?.building_room;

        if (!roomValue) return '';
        return typeof roomValue === 'string' ? roomValue : (roomValue.name || roomValue.description || '');
    }

    // Simplified helper - just stores locally for backup/debugging
    async storeIssueReportLocally(issueData) {
        try {
            const result = await chrome.storage.local.get(['issueReports']);
            const reports = result.issueReports || [];
            reports.push({
                ...issueData,
                id: Date.now(),
                submittedAt: new Date().toISOString()
            });
            // Keep only last 50 reports to avoid storage bloat
            if (reports.length > 50) {
                reports.shift();
            }
            await chrome.storage.local.set({ issueReports: reports });
            console.log('📧 Background: Report stored locally as backup');
        } catch (error) {
            console.warn('📧 Background: Failed to store report locally:', error);
        }
    }
    
    parseMenuHTML(html) {
        // This is a simplified parser - you may need to adjust based on actual HTML structure
        const menuData = [];
        
        try {
            // Create a DOM parser in the background script context
            // Note: In service workers, you might need to use regex instead
            
            // Look for common menu patterns in the HTML
            const mealSections = html.match(/<div[^>]*class="[^"]*meal[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
            const menuItems = html.match(/<div[^>]*class="[^"]*menu-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi) || [];
            
            // Extract text content from menu items
            menuItems.forEach(item => {
                const textMatch = item.match(/>([^<]+)</);
                if (textMatch && textMatch[1]. trim()) {
                    menuData. push({
                        name: textMatch[1].trim(),
                        category: 'Menu Item'
                    });
                }
            });
            
            // If no structured data found, try to extract any text that looks like food items
            if (menuData.length === 0) {
                // Fallback:  extract from common patterns
                const foodPatterns = html.match(/( : Entree|Main|Side|Dessert|Vegetable|Salad|Soup)[^<]*: ?\s*([^<]+)/gi);
                if (foodPatterns) {
                    foodPatterns.forEach(match => {
                        menuData.push({ name: match.trim(), category: 'Menu' });
                    });
                }
            }
            
            return menuData. length > 0 ? menuData :  [{ 
                name: 'Menu available on website', 
                category: 'Info',
                note: 'Please visit the Sage Dining website for the full menu.'
            }];
            
        } catch (error) {
            console.error('parseMenuHTML error:', error);
            return [];
        }
    }

    async handleCanvasRequest(request, sendResponse) {
        try {
            const token = await this.getCanvasToken();
            
            // 🛡️ FIX: Hardcode the Canvas domain — never read from user-controllable storage
            const domain = 'christchurchschool.instructure.com';
    
            if (!token) {
                console.error("[Background] ❌ No Auth Token found!");
                sendResponse({ success: false, error: "No Auth Token found" });
                return;
            }
    
            // 🛡️ Sanitize endpoint — block path traversal and injection
            let endpoint = request.endpoint;
            if (typeof endpoint !== 'string') {
                sendResponse({ success: false, error: "Invalid endpoint type" });
                return;
            }
            endpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
            endpoint = endpoint.replace(/\.\./g, ''); // Strip path traversal
    
            // Split off query string for validation
            const endpointPath = endpoint.split('?')[0];
            
            // Only allow alphanumeric, underscores, hyphens, slashes, and digits
            if (!/^\/[a-zA-Z0-9_\-\/]+$/.test(endpointPath)) {
                console.warn(`[Background] 🛡️ Blocked invalid endpoint: ${endpoint}`);
                sendResponse({ success: false, error: "Invalid endpoint" });
                return;
            }
            const apiUrl = `https://${domain}/api/v1${endpoint}`;
        const urlObj = new URL(apiUrl);

        if (endpoint.includes('/assignments')) {
            urlObj.searchParams.append('include[]', 'planner_overrides');
        }

        if (request.params) {
            Object.keys(request.params).forEach(key => {
                // 🛡️ Sanitize parameter keys
                if (typeof key !== 'string' || !/^[a-zA-Z0-9_\[\]]+$/.test(key)) return;
                
                const value = request.params[key];
                if (Array.isArray(value)) {
                    value.forEach(item => {
                        if (typeof item !== 'string' && typeof item !== 'number') return;
                        if (key === 'context_codes' && !String(item).startsWith('course_')) return;
                        urlObj.searchParams.append(`${key}[]`, String(item));
                    });
                } else {
                    if (typeof value === 'string' || typeof value === 'number') {
                        urlObj.searchParams.append(key, String(value));
                    }
                }
            });
        }

        const response = await fetch(urlObj.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Canvas API responded with ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        sendResponse({ success: true, data: data });

    } catch (error) {
        console.error("[Background] 💥 Catch Block Error:", error);
        sendResponse({ success: false, error: error.message });
    }
    }

    // 🛡️ Client-side content filter (mirrors server-side for fast rejection)
    isSearchQueryAppropriate(query) {
        if (!query || typeof query !== 'string') return false;

        const cleaned = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

        const blockedTerms = [
            'porn', 'pornography', 'hentai', 'xxx', 'xnxx', 'xvideos', 'pornhub',
            'onlyfans', 'nsfw', 'nude', 'nudes', 'naked', 'sex tape',
            'suicide method', 'how to kill myself', 'how to kill someone',
            'how to make a bomb', 'how to make drugs', 'how to make meth',
            'child abuse', 'child porn', 'pedophile',
            'school shooting', 'mass shooting', 'hire hitman',
            'buy drugs online', 'buy guns illegally',
            'gore', 'snuff', 'torture video'
        ];

        for (const term of blockedTerms) {
            if (cleaned.includes(term)) return false;
        }

        const dangerousPatterns = [
            /how\s+to\s+(kill|murder|poison|harm|hurt)\s+(myself|someone|people)/i,
            /how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|explosive|weapon|meth|cocaine)/i,
            /where\s+to\s+(buy|get|find)\s+(drugs|guns|weapons|illegal)/i,
            /ways\s+to\s+(die|commit\s+suicide|end\s+(my|it|life))/i,
            /\b(sex|fuck|dick|pussy|cock|tits|boob)\b/i
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(query)) return false;
        }

        if (cleaned.length < 2 || cleaned.length > 300) return false;

        return true;
    }

    async handleWebSearch(data, sendResponse) {
        try {
            const query = data.query;
            const location = data.location || null;
            console.log('🌐 Background handleWebSearch: query =', query, 'location =', location);

            // 🛡️ Pre-filter before sending to server
            if (!this.isSearchQueryAppropriate(query)) {
                console.warn('🛡️ Background: Blocked inappropriate search query:', query.substring(0, 50));
                sendResponse({
                    success: false,
                    blocked: true,
                    error: 'This search is not allowed. Please keep your searches appropriate and academic.'
                });
                return;
            }

            const results = await this.serperSearch(query, location);
            console.log('🌐 Background handleWebSearch: got', results.length, 'results');
            sendResponse({ success: true, results, source: 'serper' });

        } catch (error) {
            console.error('🌐 Background handleWebSearch: FAILED:', error);

            // Check if it was blocked by the server
            if (error.message && error.message.includes('not allowed')) {
                sendResponse({
                    success: false,
                    blocked: true,
                    error: 'This search is not allowed. Please keep your searches appropriate and academic.'
                });
            } else {
                sendResponse({ success: false, error: error.message });
            }
        }
    }
    
    async serperSearch(query, location = null) {
        console.log('🌐 serperSearch: Proxying through backend for:', query);

        // ✅ NEW: Use Canvas token
        const canvasToken = await this.getCanvasToken();
        if (!canvasToken) {
            throw new Error('Not authenticated');
        }

        const response = await fetch('https://canvas-ai-assistant-production.up.railway.app/api/search', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${canvasToken}`  // ✅ Per-user auth
            },
            body: JSON.stringify({ query, location })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            // If blocked by server moderation, propagate the blocked flag
            if (errData.blocked) {
                throw new Error(errData.error || 'Search query not allowed');
            }
            const errText = JSON.stringify(errData);
            throw new Error(`Search proxy error (${response.status}): ${errText}`);
        }

        const data = await response.json();

        if (!data.success) {
            if (data.blocked) {
                throw new Error(data.error || 'Search query not allowed');
            }
            throw new Error(data.error || 'Search failed');
        }

        console.log(`Background: Search returned ${data.results?.length || 0} results for "${query}"`);
        return data.results || [];
    }

    // 🛡️ FIX #5: Update makeCanvasRequest to use session storage
    async makeCanvasRequest(endpoint, params = {}) {
        // Try session first, fall back to local for backwards compatibility
        const session = await chrome.storage.session.get(['canvasToken']);
        let token = session.canvasToken;
        
        if (!token) {
            const local = await chrome.storage.local.get(['canvasToken']);
            token = local.canvasToken;
        }
        
        if (!token) {
            throw new Error('No Canvas token available');
        }

        const canvasDomain = 'https://christchurchschool.instructure.com';
        const url = new URL(`${canvasDomain}/api/v1${endpoint}`);
        
        Object.entries(params).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                value.forEach(v => url.searchParams.append(`${key}[]`, v));
            } else {
                url.searchParams.set(key, value);
            }
        });

        const response = await fetch(url.toString(), {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('TOKEN_EXPIRED');
            }
            throw new Error(`Canvas API error: ${response.status}`);
        }
        
        return await response.json();
    }
    async triggerAPISync(tab, sendResponse) {
        try {
            console.log('Background: Triggering API sync...');
            
            if (tab && tab.url && tab.url.includes('instructure.com')) {
                // Inject content script to trigger API data extraction
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                
                // Wait a bit for data extraction
                setTimeout(() => {
                    sendResponse({ 
                        success: true, 
                        message: 'Data sync triggered' 
                    });
                }, 2000);
            } else {
                sendResponse({ 
                    success: false, 
                    error: 'Not on a Canvas page' 
                });
            }
        } catch (error) {
            console.error('Background: API sync failed:', error);
            sendResponse({ 
                success: false, 
                error: error.message 
            });
        }
    }

    // ─── FETCH HANDLERS ──────────────────────────────────────────────

    async handleFetchAnnouncements(request, sendResponse) {
        try {
            const courseIds = request.courseIds || [];
            if (courseIds.length === 0) {
                const stored = await chrome.storage.local.get('canvasData');
                const courses = stored.canvasData?.courses || [];
                courseIds.push(...courses.slice(0, 10).map(c => c.id));
            }

            if (courseIds.length === 0) {
                sendResponse({ success: false, error: 'No courses available' });
                return;
            }

            const contextCodes = courseIds.map(id => `course_${id}`);
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 14);

            const announcements = await this.makeCanvasRequest('/announcements', {
                context_codes: contextCodes,
                start_date: startDate.toISOString(),
                end_date: new Date().toISOString(),
                active_only: true,
                per_page: 50
            });

            const stored = await chrome.storage.local.get('canvasData');
            const courses = stored.canvasData?.courses || [];

            const formatted = announcements.map(a => {
                const courseIdStr = a.context_code?.split('_')[1];
                const course = courses.find(c => String(c.id) === String(courseIdStr));
                return {
                    id: String(a.id),
                    title: a.title,
                    message: this.stripHtmlBackground(a.message || ''),
                    course: course ? course.name : 'Unknown Course',
                    courseId: courseIdStr,
                    date: a.posted_at,
                    url: a.url || a.html_url,
                    author: a.user_name
                };
            });

            console.log(`Background: FETCH_ANNOUNCEMENTS returned ${formatted.length} items`);

            if (stored.canvasData) {
                stored.canvasData.announcements = formatted;
                await chrome.storage.local.set({ canvasData: stored.canvasData });
            }

            sendResponse({ success: true, data: formatted });
        } catch (error) {
            console.error('Background: FETCH_ANNOUNCEMENTS failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleFetchGrades(sendResponse) {
        try {
            const stored = await chrome.storage.local.get('canvasData');
            const courses = stored.canvasData?.courses || [];
    
            if (courses.length === 0) {
                sendResponse({ success: false, error: 'No courses found' });
                return;
            }
    
            const allGrades = [];
            const gradingPeriodsMap = {}; // courseId → gradingPeriods[]
    
            for (const course of courses.slice(0, 10)) {
                try {
                    // 1. Fetch grading periods for this course
                    const gradingPeriods = await this.fetchGradingPeriods(course.id);
                    gradingPeriodsMap[course.id] = gradingPeriods;
    
                    // 2. Map grading periods to trimesters
                    const periodsWithTrimester = gradingPeriods.map(gp => {
                        const startDate = new Date(gp.start_date);
                        const triInfo = this.getTrimesterForDate(startDate);
                        return { ...gp, trimesterInfo: triInfo };
                    });
    
                    // 3. Fetch ALL submissions via the gradebook endpoint
                    //    (this is what /courses/:id/grades actually shows)
                    const submissions = await this.fetchGradebookGrades(course.id);
    
                    for (const sub of submissions) {
                        if (!sub || !sub.assignment) continue;
    
                        const assignment = sub.assignment;
                        const gradingPeriodId = sub.grading_period_id || null;
    
                        // Find which grading period / trimester this belongs to
                        const matchedPeriod = periodsWithTrimester.find(
                            gp => String(gp.id) === String(gradingPeriodId)
                        );
    
                        // Determine trimester from grading period first, 
                        // then fall back to date-based detection
                        let trimesterNum = null;
                        let trimesterLabel = '';
                        if (matchedPeriod?.trimesterInfo) {
                            trimesterNum = matchedPeriod.trimesterInfo.trimester;
                            trimesterLabel = matchedPeriod.trimesterInfo.label;
                        } else {
                            // Trimester assignment must be based on the assignment due date only.
                            // Missing due dates stay unresolved here and are mapped in dashboard.js
                            // and canvas_tools.js via TrimesterUtils.filterByTrimester at render time.
                            const dateStr = assignment.due_at;
                            if (dateStr) {
                                const triInfo = this.getTrimesterForDate(dateStr);
                                if (triInfo) {
                                    trimesterNum = triInfo.trimester;
                                    trimesterLabel = triInfo.label;
                                }
                            }
                        }
    
                        allGrades.push({
                            assignmentId: String(assignment.id),
                            assignmentName: assignment.name || 'Unknown Assignment',
                            courseId: String(course.id),
                            courseName: course.name,
                            score: sub.score,
                            grade: sub.grade,
                            pointsPossible: assignment.points_possible,
                            percentage: (sub.score != null && assignment.points_possible > 0)
                                ? Math.round((sub.score / assignment.points_possible) * 100)
                                : null,
                            gradedAt: sub.graded_at,
                            submittedAt: sub.submitted_at,
                            dueAt: assignment.due_at,
                            workflowState: sub.workflow_state,
                            late: sub.late || false,
                            missing: sub.missing || false,
                            excused: sub.excused || false,
                            comments: [],
                            // NEW: grading period / trimester info
                            gradingPeriodId: gradingPeriodId,
                            gradingPeriodTitle: matchedPeriod?.title || null,
                            trimester: trimesterNum,
                            trimesterLabel: trimesterLabel
                        });
                    }
                } catch (courseErr) {
                    console.warn(`Background: Failed grades for ${course.name}:`, courseErr.message);
                }
            }
    
            console.log(`Background: FETCH_GRADES returned ${allGrades.length} items`);
    
            // Store in canvasData
            if (stored.canvasData) {
                stored.canvasData.assignmentGrades = allGrades;
                stored.canvasData.gradingPeriods = gradingPeriodsMap;
                await chrome.storage.local.set({
                    canvasData: stored.canvasData,
                    assignmentGrades: allGrades,
                    assignmentGradesLastFetch: Date.now()
                });
            }
    
            sendResponse({ success: true, data: allGrades });
        } catch (error) {
            console.error('Background: FETCH_GRADES failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleFetchSyllabi(request, sendResponse) {
        try {
            const courseIds = request.courseIds || [];
            const stored = await chrome.storage.local.get('canvasData');
            const courses = stored.canvasData?.courses || [];

            const targetCourses = courseIds.length > 0
                ? courses.filter(c => courseIds.includes(c.id))
                : courses.slice(0, 10);

            const syllabi = {};
            for (const course of targetCourses) {
                try {
                    const courseData = await this.makeCanvasRequest(
                        `/courses/${course.id}`, {
                            include: ['syllabus_body']
                        }
                    );

                    if (courseData.syllabus_body) {
                        syllabi[course.id] = {
                            courseName: course.name,
                            courseId: course.id,
                            content: this.stripHtmlBackground(courseData.syllabus_body),
                            rawHtml: courseData.syllabus_body
                        };
                    }
                } catch (e) {
                    console.warn(`Background: Syllabus fetch failed for ${course.name}:`, e.message);
                }
            }

            console.log(`Background: FETCH_SYLLABI returned ${Object.keys(syllabi).length} syllabi`);

            if (stored.canvasData) {
                stored.canvasData.courseSyllabi = syllabi;
                await chrome.storage.local.set({ canvasData: stored.canvasData });
            }

            sendResponse({ success: true, data: syllabi });
        } catch (error) {
            console.error('Background: FETCH_SYLLABI failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleFetchCourses(sendResponse) {
        try {
            const courses = await this.makeCanvasRequest('/courses', {
                enrollment_state: 'active',
                include: ['total_scores', 'term', 'favorites'],
                per_page: 50
            });

            const subjectMap = {
                'math': ['calculus', 'algebra', 'geometry', 'statistics', 'trigonometry', 'precalc', 'math'],
                'physics': ['physics'],
                'chemistry': ['chemistry', 'chem'],
                'biology': ['biology', 'bio', 'anatomy'],
                'science': ['environmental', 'science', 'forensics'],
                'english': ['literature', 'composition', 'lang', 'lit', 'reading', 'english', 'writing'],
                'history': ['government', 'world', 'us history', 'european', 'civics', 'econ', 'history', 'humanities'],
                'comp sci': ['computer', 'programming', 'java', 'python', 'web', 'tech'],
                'art': ['design', 'drawing', 'painting', 'sculpture', 'music', 'band', 'art', 'theater'],
                'language': ['spanish', 'french', 'latin', 'chinese', 'german', 'japanese'],
                'religion': ['bible', 'religion', 'theology', 'chapel'],
                'pe': ['physical education', 'pe', 'health', 'fitness', 'athletics']
            };

            const detectSubject = (name) => {
                const lowerName = (name || '').toLowerCase();
                for (const [subject, keywords] of Object.entries(subjectMap)) {
                    if (keywords.some(k => lowerName.includes(k))) return subject;
                }
                return 'general';
            };

            const validStates = ['available', 'unpublished', 'claimed'];
            const formatted = courses
                .filter(c => {
                    if (c.workflow_state && !validStates.includes(c.workflow_state)) {
                        const hasActiveEnrollment = c.enrollments && c.enrollments.length > 0;
                        if (!hasActiveEnrollment) return false;
                    }
                    return true;
                })
                .map(course => ({
                    id: String(course.id),
                    name: course.name,
                    code: course.course_code,
                    subject: detectSubject(course.name),
                    url: `https://christchurchschool.instructure.com/courses/${course.id}`,                    isFavorite: course.is_favorite,
                    grade: course.enrollments?.[0]?.grades?.current_score ?? null,
                    letterGrade: course.enrollments?.[0]?.grades?.current_grade ?? null,
                    term: course.term?.name,
                    workflowState: course.workflow_state
                }));

            console.log(`Background: FETCH_COURSES returned ${formatted.length} courses`);

            const stored = await chrome.storage.local.get('canvasData');
            if (stored.canvasData) {
                stored.canvasData.courses = formatted;
                await chrome.storage.local.set({ canvasData: stored.canvasData });
            }

            sendResponse({ success: true, data: formatted });
        } catch (error) {
            console.error('Background: FETCH_COURSES failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleFetchAssignmentDetail(request, sendResponse) {
    try {
        const { courseId, assignmentId } = request;

        if (!courseId || !assignmentId) {
            sendResponse({ success: false, error: 'Missing courseId or assignmentId' });
            return;
        }

        // 🛡️ Validate IDs are numeric
        if (!/^\d+$/.test(String(courseId)) || !/^\d+$/.test(String(assignmentId))) {
            sendResponse({ success: false, error: 'Invalid courseId or assignmentId format' });
            return;
        }

        console.log(`📝 Fetching assignment detail: course=${courseId}, assignment=${assignmentId}`);

        const token = await this.getCanvasToken();
        if (!token) {
            sendResponse({ success: false, error: 'No Canvas token available' });
            return;
        }

        // 🛡️ FIX: Hardcoded domain
        const CANVAS_DOMAIN = 'https://christchurchschool.instructure.com';
        const url = `${CANVAS_DOMAIN}/api/v1/courses/${courseId}/assignments/${assignmentId}?include[]=rubric_definition&include[]=submission`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Canvas API Error (${response.status}): ${errText}`);
        }

        const data = await response.json();

        const detail = {
            id: String(data.id),
            name: data.name || 'Untitled Assignment',
            courseId: String(courseId),
            description: this.stripHtmlBackground(data.description || ''),
            descriptionHtml: data.description || '',
            dueAt: data.due_at,
            lockAt: data.lock_at,
            unlockAt: data.unlock_at,
            pointsPossible: data.points_possible,
            gradingType: data.grading_type,
            submissionTypes: data.submission_types || [],
            allowedExtensions: data.allowed_extensions || [],
            htmlUrl: data.html_url,
            published: data.published,
            submission: data.submission ? {
                id: data.submission.id,
                score: data.submission.score,
                grade: data.submission.grade,
                submittedAt: data.submission.submitted_at,
                gradedAt: data.submission.graded_at,
                late: data.submission.late || false,
                missing: data.submission.missing || false,
                excused: data.submission.excused || false,
                workflowState: data.submission.workflow_state,
                attempt: data.submission.attempt,
                submissionComments: (data.submission.submission_comments || []).map(c => ({
                    author: c.author_name || 'Unknown',
                    comment: c.comment || '',
                    createdAt: c.created_at
                })),
                attachments: (data.submission.attachments || []).map(a => ({
                    name: a.display_name || a.filename,
                    url: a.url,
                    size: a.size,
                    contentType: a.content_type || a['content-type']
                }))
            } : null,
            rubric: data.rubric ? data.rubric.map(criterion => ({
                id: criterion.id,
                description: criterion.description || '',
                longDescription: criterion.long_description || '',
                points: criterion.points,
                ratings: (criterion.ratings || []).map(r => ({
                    description: r.description,
                    longDescription: r.long_description || '',
                    points: r.points
                }))
            })) : null,
            rubricSettings: data.rubric_settings || null,
            assignmentGroupId: data.assignment_group_id,
            peerReviews: data.peer_reviews || false,
            isQuiz: data.is_quiz_assignment || false,
            discussionTopic: data.discussion_topic ? {
                id: data.discussion_topic.id,
                title: data.discussion_topic.title,
                message: this.stripHtmlBackground(data.discussion_topic.message || '')
            } : null,
            externalToolUrl: data.external_tool_tag_attributes?.url || null
        };

        console.log(`📝 Assignment detail fetched: "${detail.name}" (${detail.pointsPossible} pts)`);
        sendResponse({ success: true, data: detail });

    } catch (error) {
        console.error('Background: FETCH_ASSIGNMENT_DETAIL failed:', error);
        sendResponse({ success: false, error: error.message });
    }
}

    async fetchGradingPeriods(courseId) {
        try {
            const data = await this.makeCanvasRequest(`/courses/${courseId}/grading_periods`);
            return data.grading_periods || [];
        } catch (error) {
            console.warn(`Background: No grading periods for course ${courseId}:`, error.message);
            return [];
        }
    }
    
    async fetchGradebookGrades(courseId, gradingPeriodId = null) {
        const params = {
            student_ids: ['self'],
            include: ['assignment'],
            per_page: 100,
            grouped: false
        };
        if (gradingPeriodId) {
            params.grading_period_id = gradingPeriodId;
        }
        
        try {
            const submissions = await this.makeCanvasRequest(
                `/courses/${courseId}/students/submissions`, params
            );
            return submissions || [];
        } catch (error) {
            console.warn(`Background: Failed to fetch gradebook for course ${courseId}:`, error.message);
            return [];
        }
    }

    // Add this method to the CanvasAIBackground class
    stripHtmlBackground(html) {
        if (!html) return '';
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<li[^>]*>/gi, '• ')
            .replace(/<\/h[1-6]>/gi, '\n')
            .replace(/<h[1-6][^>]*>/gi, '\n**')
            .replace(/<\/?strong>/gi, '**')
            .replace(/<\/?em>/gi, '_')
            .replace(/<\/?b>/gi, '**')
            .replace(/<\/?i>/gi, '_')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    async performBackgroundSync(sendResponse) {
        try {
            console.log('Background: Starting background sync...');

            // 🔄 Validate token BEFORE making any API calls
            let validToken;
            try {
                validToken = await this.ensureValidToken();
            } catch (tokenErr) {
                if (tokenErr.message === 'NO_TOKEN') {
                    sendResponse({
                        success: false,
                        error: 'Not authenticated. Please set up your Canvas token in settings.',
                        authError: true
                    });
                    return;
                }
                if (tokenErr.message === 'TOKEN_EXPIRED') {
                    sendResponse({
                        success: false,
                        error: 'Your Canvas session has expired. Please re-authenticate.',
                        authError: true,
                        needsReauth: true
                    });
                    return;
                }
                throw tokenErr;
            }

            await this.updateSyncProgress(0, 'Starting sync...');

            const canvasData = {
                user: {},
                courses: [],
                assignments: [],
                assignmentGrades: [],
                announcements: [],
                calendarEvents: [],
                plannerOverrides: [],
                courseSyllabi: {}
            };
    
            // ── PHASE 1: Profile + Courses (parallel) ──
            await this.updateSyncProgress(5, 'Loading profile & courses...');
    
            const [profileResult, coursesResult] = await Promise.allSettled([
                this.makeCanvasRequest('/users/self/profile').then(profile => {
                    canvasData.user = {
                        id: profile.id,
                        name: profile.name,
                        email: profile.primary_email,
                        avatar: profile.avatar_url,
                        extractedAt: new Date().toISOString()
                    };
                }),
                this.makeCanvasRequest('/courses', {
                    enrollment_state: 'active',
                    include: ['total_scores', 'term', 'favorites'],
                    per_page: 50
                }).then(courses => {
                    const subjectMap = {
                        'math': ['calculus', 'algebra', 'geometry', 'statistics', 'trigonometry', 'precalc', 'math'],
                        'physics': ['physics'],
                        'chemistry': ['chemistry', 'chem'],
                        'biology': ['biology', 'bio', 'anatomy'],
                        'science': ['environmental', 'science', 'forensics'],
                        'english': ['literature', 'composition', 'lang', 'lit', 'reading', 'english', 'writing'],
                        'history': ['government', 'world', 'us history', 'european', 'civics', 'econ', 'history', 'humanities'],
                        'comp sci': ['computer', 'programming', 'java', 'python', 'web', 'tech'],
                        'art': ['design', 'drawing', 'painting', 'sculpture', 'music', 'band', 'art', 'theater'],
                        'language': ['spanish', 'french', 'latin', 'chinese', 'german', 'japanese'],
                        'religion': ['bible', 'religion', 'theology', 'chapel'],
                        'pe': ['physical education', 'pe', 'health', 'fitness', 'athletics']
                    };
    
                    const detectSubject = (name) => {
                        const lowerName = (name || '').toLowerCase();
                        for (const [subject, keywords] of Object.entries(subjectMap)) {
                            if (keywords.some(k => lowerName.includes(k))) return subject;
                        }
                        return 'general';
                    };
    
                    // ✅ FIX: Accept courses with active enrollment, not just workflow_state === 'available'
                    const validStates = ['available', 'unpublished', 'claimed'];
    
                    canvasData.courses = courses
                        .filter(c => {
                            if (c.workflow_state && !validStates.includes(c.workflow_state)) {
                                const hasActiveEnrollment = c.enrollments && c.enrollments.length > 0;
                                if (!hasActiveEnrollment) {
                                    console.log(`Background: Skipping course "${c.name}" (state: ${c.workflow_state})`);
                                    return false;
                                }
                            }
                            return true;
                        })
                        .map(course => ({
                            id: String(course.id),
                            name: course.name,
                            code: course.course_code,
                            subject: detectSubject(course.name),
                            url: `https://christchurchschool.instructure.com/courses/${course.id}`,                            isFavorite: course.is_favorite,
                            grade: course.enrollments?.[0]?.grades?.current_score ?? null,
                            letterGrade: course.enrollments?.[0]?.grades?.current_grade ?? null,
                            term: course.term?.name,
                            workflowState: course.workflow_state
                        }));
    
                    console.log(`Background: Fetched ${canvasData.courses.length} courses:`);
                    canvasData.courses.forEach(c => {
                        console.log(`  • ${c.name} (ID: ${c.id}, Grade: ${c.grade ?? 'N/A'}, State: ${c.workflowState})`);
                    });
                })
            ]);
    
            if (coursesResult.status === 'rejected') {
                throw new Error('Failed to load courses: ' + coursesResult.reason?.message);
            }
    
            // ── PHASE 2: Grades + Planner + Syllabi (parallel) ──
            await this.updateSyncProgress(20, 'Loading grades & planner...');
    
            const cachedSyllabi = await chrome.storage.local.get(['courseSyllabi', 'syllabiLastFetch']);
            const ONE_DAY = 24 * 60 * 60 * 1000;
            const useSyllabiCache = cachedSyllabi.syllabiLastFetch && 
                                    (Date.now() - cachedSyllabi.syllabiLastFetch) < ONE_DAY && 
                                    cachedSyllabi.courseSyllabi;
    
            await Promise.allSettled([
                // Grades
                this.makeCanvasRequest('/users/self/enrollments', {
                    state: ['active'],
                    type: ['StudentEnrollment']
                }).then(enrollments => {
                    if (!Array.isArray(enrollments)) return;
                    enrollments.forEach(enrollment => {
                        const courseIndex = canvasData.courses.findIndex(
                            c => String(c.id) === String(enrollment.course_id)
                        );
                        if (courseIndex !== -1 && enrollment.grades?.current_score !== undefined) {
                            canvasData.courses[courseIndex].grade = enrollment.grades.current_score;
                        }
                    });
                }).catch(e => console.warn('Background: Failed to fetch grades:', e.message)),
    
                // Planner overrides
                this.makeCanvasRequest('/planner/overrides', { per_page: 100 })
                    .then(overrides => { canvasData.plannerOverrides = overrides; })
                    .catch(e => { 
                        console.warn('Background: Failed to fetch planner overrides:', e.message);
                        canvasData.plannerOverrides = [];
                    }),
    
                // Syllabi (with cache)
                (async () => {
                    if (useSyllabiCache) {
                        canvasData.courseSyllabi = cachedSyllabi.courseSyllabi;
                        return;
                    }
                    const syllabi = {};
                    const BATCH_SIZE = 5;
                    for (let i = 0; i < canvasData.courses.length; i += BATCH_SIZE) {
                        const batch = canvasData.courses.slice(i, i + BATCH_SIZE);
                        const results = await Promise.allSettled(
                            batch.map(course =>
                                this.makeCanvasRequest(`/courses/${course.id}`, {
                                    include: ['syllabus_body', 'description']
                                }).then(data => ({ course, data }))
                            )
                        );
                        results.forEach((result, idx) => {
                            const course = batch[idx];
                            if (result.status === 'fulfilled' && result.value?.data) {
                                const { data } = result.value;
                                const html = data.syllabus_body || '';
                                syllabi[course.id] = {
                                    courseId: String(course.id),
                                    courseName: course.name,
                                    syllabusHtml: html,
                                    syllabusText: this.stripHtmlBackground(html),
                                    description: this.stripHtmlBackground(data.description || ''),
                                    hasSyllabus: html.length > 0,
                                    fetchedAt: new Date().toISOString()
                                };
                            } else {
                                syllabi[course.id] = {
                                    courseId: String(course.id),
                                    courseName: course.name,
                                    syllabusHtml: '', syllabusText: '', description: '',
                                    hasSyllabus: false
                                };
                            }
                        });
                        if (i + BATCH_SIZE < canvasData.courses.length) {
                            await new Promise(r => setTimeout(r, 100));
                        }
                    }
                    canvasData.courseSyllabi = syllabi;
                    await chrome.storage.local.set({ courseSyllabi: syllabi, syllabiLastFetch: Date.now() });
                })().catch(e => console.warn('Background: Failed to fetch syllabi:', e.message))
            ]);
    
            // ── PHASE 3: Assignments + Grades (batched parallel) ──
            await this.updateSyncProgress(40, 'Loading assignments...');
    
            const cachedGrades = await chrome.storage.local.get(['assignmentGrades', 'assignmentGradesLastFetch']);
            const ONE_HOUR = 60 * 60 * 1000;
            const useGradeCache = cachedGrades.assignmentGradesLastFetch && 
                                  (Date.now() - cachedGrades.assignmentGradesLastFetch) < ONE_HOUR &&
                                  cachedGrades.assignmentGrades?.length > 0;
    
            if (useGradeCache) {
                canvasData.assignmentGrades = cachedGrades.assignmentGrades;
            }
    
            const processedIds = new Set();
            const gradeEntries = [];
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const BATCH_SIZE = 4;
            const totalCourses = canvasData.courses.length;
    
            for (let batchStart = 0; batchStart < totalCourses; batchStart += BATCH_SIZE) {
                const batch = canvasData.courses.slice(batchStart, batchStart + BATCH_SIZE);
                const progress = 40 + Math.floor((batchStart / totalCourses) * 45);
                await this.updateSyncProgress(progress, `Loading: ${batch.map(c => c.name).join(', ')}...`);
    
                const batchResults = await Promise.allSettled(
                    batch.map(course =>
                        this.makeCanvasRequest(`/courses/${course.id}/assignments`, {
                            include: ['submission'],
                            order_by: 'due_at',
                            per_page: 100
                        }).then(assignments => ({ course, assignments: assignments || [] }))
                          .catch(() => ({ course, assignments: [] }))
                    )
                );
    
                batchResults.forEach(result => {
                    if (result.status !== 'fulfilled' || !result.value) return;
                    const { course, assignments } = result.value;
    
                    assignments.forEach(item => {
                        if (!item.id || processedIds.has(item.id)) return;
                        processedIds.add(item.id);
    
                        const dueDate = item.due_at ? new Date(item.due_at) : null;
                        const isOverdue = dueDate && startOfToday > dueDate;
                        const sub = item.submission;
    
                        // Pending assignments
                        if (item.points_possible && item.points_possible > 0) {
                            const isSubmitted = sub && 
                                (sub.workflow_state === 'submitted' || sub.workflow_state === 'graded');
                            const isOldOverdue = isOverdue && sub && sub.workflow_state !== 'missing';
                            
                            // ✅ Skip assignments with no due date
                            if (!item.due_at) {
                                return;
                            }

                            if (!isSubmitted && !isOldOverdue) {
                                canvasData.assignments.push({
                                    id: String(item.id),
                                    title: item.name,
                                    courseId: String(course.id),
                                    courseName: course.name,
                                    dueDate: item.due_at,
                                    points: item.points_possible,
                                    url: item.html_url,
                                    status: this.determineAssignmentStatus(item),
                                    description: item.description,
                                    submissionTypes: item.submission_types || []
                                });
                            }
                        }
    
                        // Grade entries
                        if (!useGradeCache && sub) {
                            gradeEntries.push({
                                assignmentId: String(item.id),
                                assignmentName: item.name || 'Unknown Assignment',
                                courseId: String(course.id),
                                courseName: course.name,
                                score: sub.score,
                                grade: sub.grade,
                                pointsPossible: item.points_possible,
                                percentage: (sub.score != null && item.points_possible > 0)
                                    ? Math.round((sub.score / item.points_possible) * 100) : null,
                                gradedAt: sub.graded_at,
                                submittedAt: sub.submitted_at,
                                dueAt: item.due_at,
                                workflowState: sub.workflow_state,
                                late: sub.late || false,
                                missing: sub.missing || false,
                                excused: sub.excused || false,
                                comments: []
                            });
                        }
                    });
                });
    
                if (batchStart + BATCH_SIZE < totalCourses) {
                    await new Promise(r => setTimeout(r, 150));
                }
            }
    
            // De-duplicate and cache grades
            if (!useGradeCache) {
                const seen = new Set();
                const uniqueGrades = gradeEntries.filter(g => {
                    const key = `${g.courseId}-${g.assignmentId}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                canvasData.assignmentGrades = uniqueGrades;
                await chrome.storage.local.set({
                    assignmentGrades: uniqueGrades,
                    assignmentGradesLastFetch: Date.now()
                });
            }
    
            // ── PHASE 4: Announcements + Calendar (parallel) ──
            await this.updateSyncProgress(85, 'Loading announcements & calendar...');
    
            await Promise.allSettled([
                // Announcements
                (async () => {
                    if (canvasData.courses.length === 0) return;
                    const contextCodes = canvasData.courses.slice(0, 10).map(c => `course_${c.id}`);
                    const startDate = new Date();
                    startDate.setDate(startDate.getDate() - 14);
    
                    const announcements = await this.makeCanvasRequest('/announcements', {
                        context_codes: contextCodes,
                        start_date: startDate.toISOString(),
                        end_date: new Date().toISOString(),
                        active_only: true,
                        per_page: 10
                    });
    
                    canvasData.announcements = announcements.map(a => {
                        const courseIdStr = a.context_code?.split('_')[1];
                        const course = canvasData.courses.find(c => String(c.id) === String(courseIdStr));
                        return {
                            id: String(a.id),
                            title: a.title,
                            message: this.stripHtmlBackground(a.message || ''),
                            course: course ? course.name : 'Unknown Course',
                            date: a.posted_at,
                            url: a.url,
                            author: a.user_name
                        };
                    });
                })().catch(e => {
                    console.warn('Background: Failed to fetch announcements:', e.message);
                    canvasData.announcements = [];
                }),
    
                // Calendar events
                (async () => {
                    const allEvents = [];
    
                    // Upcoming events
                    try {
                        const upcoming = await this.makeCanvasRequest('/users/self/upcoming_events', { per_page: 50 });
                        allEvents.push(...upcoming.map(e => ({ ...e, source: 'upcoming' })));
                    } catch (e) { /* non-critical */ }
    
                    // Calendar events
                    try {
                        if (canvasData.courses.length > 0) {
                            const contextCodes = canvasData.courses.slice(0, 10).map(c => `course_${c.id}`);
                            const calEvents = await this.makeCanvasRequest('/calendar_events', {
                                type: 'event',
                                context_codes: contextCodes,
                                start_date: new Date().toISOString(),
                                end_date: new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)).toISOString(),
                                per_page: 50
                            });
                            allEvents.push(...calEvents.map(e => ({ ...e, source: 'calendar' })));
                        }
                    } catch (e) { /* non-critical */ }
    
                    // Todo items
                    try {
                        const todoItems = await this.makeCanvasRequest('/users/self/todo', { per_page: 50 });
                        allEvents.push(...todoItems.map(todo => ({
                            id: `todo-${todo.assignment?.id || todo.id}`,
                            title: `Todo: ${todo.assignment?.name || todo.title}`,
                            start_at: todo.assignment?.due_at || todo.due_at,
                            end_at: todo.assignment?.due_at || todo.due_at,
                            html_url: todo.assignment?.html_url || todo.html_url,
                            context_name: todo.context_name,
                            type: 'assignment',
                            source: 'todo'
                        })));
                    } catch (e) { /* non-critical */ }
    
                    // Generated from assignments
                    if (canvasData.assignments?.length > 0) {
                        allEvents.push(...canvasData.assignments
                            .filter(a => a.dueDate)
                            .map(a => ({
                                id: `assignment-${a.id}`,
                                title: `Due: ${a.title}`,
                                start_at: a.dueDate,
                                end_at: a.dueDate,
                                html_url: a.url,
                                context_name: a.courseName,
                                type: 'assignment',
                                source: 'generated'
                            })));
                    }
    
                    // De-duplicate
                    const seen = new Set();
                    const unique = allEvents.filter(e => {
                        const key = `${e.id}-${e.title}-${e.start_at}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
    
                    canvasData.calendarEvents = unique.map(e => ({
                        id: String(e.id),
                        title: e.title || e.name || 'Untitled Event',
                        start: e.start_at || e.start,
                        end: e.end_at || e.end,
                        url: e.html_url || e.url,
                        course: e.context_name || 'Unknown Course',
                        type: e.type || 'event',
                        source: e.source || 'unknown'
                    }));
                })().catch(e => {
                    console.warn('Background: Failed to fetch calendar:', e.message);
                    canvasData.calendarEvents = [];
                })
            ]);
    
            // ── FINALIZE ──
            await this.updateSyncProgress(98, 'Finalizing...');
            await this.recordCourseGradeHistory(canvasData.courses);

            await chrome.storage.local.set({
                canvasData: canvasData,
                lastUpdate: new Date().toISOString(),
                syncState: { status: 'synced', progress: 100, message: 'Sync complete' }
            });
    
            console.log(`Background: Sync complete - ${canvasData.courses.length} courses, ${canvasData.assignments.length} assignments, ${canvasData.assignmentGrades.length} grades`);
            
            sendResponse({ 
                success: true, 
                data: canvasData,
                message: `Synced ${canvasData.courses.length} courses and ${canvasData.assignments.length} assignments`
            });
    
        } catch (error) {
            console.error('Background: Background sync failed:', error);
            await chrome.storage.local.set({ 
                syncState: { status: 'error', progress: 0, message: error.message }
            });
            sendResponse({ success: false, error: error.message });
        }
    }
    
    // Helper method to update sync progress
    async updateSyncProgress(progress, message) {
        await chrome.storage.local.set({
            syncState: { status: 'syncing', progress, message }
        });
    }
    
    // Helper method to determine assignment status
    determineAssignmentStatus(assignment) {
        const submission = assignment.submission;
        const now = new Date();
        const due = assignment.due_at ? new Date(assignment.due_at) : null;
    
        if (submission && submission.workflow_state === 'submitted') return 'submitted';
        if (submission && submission.workflow_state === 'graded') return 'graded';
        if (due && now > due) return 'missing';
        return 'upcoming';
    }
    
    async getSettings(sendResponse) {
        try {
            const token = await this.getCanvasToken();
            const result = await chrome.storage.local.get(['apiKey', 'autoSync', 'notifications']);
            sendResponse({
                success: true,
                settings: {
                    apiKey: result.apiKey || null,
                    canvasToken: token || null,
                    autoSync: result.autoSync || false,
                    notifications: result.notifications || true
                }
            });
        } catch (error) {
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }
    async handleTabUpdate(tabId, changeInfo, tab) {
        // ✅ CHANGED: Only update badge on Canvas pages, don't inject content script
        // Content script injection is handled by manifest.json content_scripts
        if (changeInfo.status === 'complete' && tab.url) {
            if (tab.url.includes('instructure.com')) {
                await this.updateBadge(tabId, 'active');
            }
        }
    }

    async handleActionClick(tab) {
        try {
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
                 chrome.action.setPopup({ popup: 'popup.html' });
                 return;
            }

            await this.openChatbot(tab);
        } catch (e) {
            console.log('Cannot inject into this page, showing popup instead');
            chrome.action.setPopup({ popup: 'popup.html' });
        }
    }

    async handleStorageChange(changes, namespace) {
        // Handle storage changes
        if (changes.canvasData) {
            console.log('Canvas AI Assistant: Canvas data updated');
            
            // Optionally sync with backend
            const settings = await chrome.storage.local.get(['autoSync']);
            if (settings.autoSync) {
                await this.syncWithBackend(changes.canvasData.newValue);
            }
        }
    }

    async initializeStorage() {
        const defaultSettings = {
            apiKey: '',
            autoSync: false,
            notifications: true,
            theme: 'canvas',
            language: 'en',
            firstInstall: false,
            lastUpdate: null
        };

        const currentSettings = await chrome.storage.local.get();
        const settingsToSave = { ...defaultSettings, ...currentSettings };
        
        await chrome.storage.local.set(settingsToSave);
    }

    async getCanvasData(sendResponse) {
        try {
            const result = await chrome.storage.local.get(['canvasData']);
            sendResponse({
                success: true,
                data: result.canvasData || null,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }

    async handleGetAcademicBriefing(sendResponse) {
        try {
            const stored = await chrome.storage.local.get([
                'canvasData',
                'lastUpdate',
                'courseGradeHistory'
            ]);
            const canvasData = stored.canvasData || {
                user: null,
                courses: [],
                assignments: [],
                assignmentGrades: [],
                announcements: [],
                calendarEvents: []
            };

            const [blackbaudCalendar, emailResult] = await Promise.all([
                this.fetchBlackbaudCalendarData().catch(error => ({
                    events: [],
                    startDate: null,
                    endDate: null,
                    error: error.message,
                    needsReconnect: error.needsReconnect === true
                })),
                this.gmailService.isConnected()
                    .then(connected => connected
                        ? this.gmailService.fetchSchoolEmails({
                            maxResults: 12,
                            daysBack: 7,
                            senderDomains: ['christchurchschool.org']
                        }, false)
                        : { success: true, emails: [], connected: false }
                    )
                    .catch(error => ({
                        success: false,
                        emails: [],
                        connected: false,
                        error: error.message
                    }))
            ]);

            const briefingContext = this.buildAcademicBriefingContext(
                canvasData,
                blackbaudCalendar,
                emailResult,
                stored.courseGradeHistory || [],
                stored.lastUpdate || null
            );

            const summary = await this.generateAcademicBriefingNarrative(briefingContext, canvasData)
                .catch(() => this.buildAcademicBriefingFallback(briefingContext));

            sendResponse({
                success: true,
                data: {
                    summary: this.normalizeAcademicBriefingText(summary),
                    context: briefingContext
                }
            });
        } catch (error) {
            console.error('Background: GET_ACADEMIC_BRIEFING failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleGetCourseSimulatorData(request, sendResponse) {
        try {
            const courseId = String(request.courseId || '').trim();
            if (!/^\d+$/.test(courseId)) {
                sendResponse({ success: false, error: 'A valid courseId is required.' });
                return;
            }

            const stored = await chrome.storage.local.get(['canvasData']);
            const canvasData = stored.canvasData || {};
            const course = (canvasData.courses || []).find(item => String(item.id) === courseId);
            if (!course) {
                sendResponse({ success: false, error: 'Course not found in cached data.' });
                return;
            }

            const assignmentGroups = await this.makeCanvasRequest(`/courses/${courseId}/assignment_groups`, {
                include: ['assignments'],
                per_page: 100
            });

            const gradeMap = new Map(
                (canvasData.assignmentGrades || [])
                    .filter(grade => String(grade.courseId) === courseId)
                    .map(grade => [String(grade.assignmentId), grade])
            );

            const rows = [];
            assignmentGroups.forEach(group => {
                const assignments = Array.isArray(group.assignments) ? group.assignments : [];
                assignments.forEach(assignment => {
                    const grade = gradeMap.get(String(assignment.id));
                    const pointsPossible = Number(assignment.points_possible);
                    const earned = grade?.score != null ? Number(grade.score) : null;
                    const dueDate = assignment.due_at || grade?.dueAt || null;
                    rows.push({
                        assignmentId: String(assignment.id),
                        title: assignment.name || 'Untitled Assignment',
                        category: group.name || 'Uncategorized',
                        categoryId: String(group.id),
                        categoryWeight: Number(group.group_weight || 0),
                        earned,
                        actualEarned: earned,
                        possible: Number.isFinite(pointsPossible) ? pointsPossible : 0,
                        gradePercent: earned != null && Number.isFinite(pointsPossible) && pointsPossible > 0
                            ? (earned / pointsPossible) * 100
                            : null,
                        dueDate,
                        htmlUrl: assignment.html_url || null,
                        status: grade?.workflowState || assignment.workflow_state || 'pending',
                        isPending: earned == null,
                        isFuture: dueDate ? new Date(dueDate) > new Date() : false
                    });
                });
            });

            const ungroupedAssignments = (canvasData.assignmentGrades || [])
                .filter(grade => String(grade.courseId) === courseId)
                .filter(grade => !rows.some(row => row.assignmentId === String(grade.assignmentId)));

            ungroupedAssignments.forEach(grade => {
                const pointsPossible = Number(grade.pointsPossible || 0);
                const earned = grade.score != null ? Number(grade.score) : null;
                rows.push({
                    assignmentId: String(grade.assignmentId),
                    title: grade.assignmentName || 'Untitled Assignment',
                    category: 'Other',
                    categoryId: 'other',
                    categoryWeight: 0,
                    earned,
                    actualEarned: earned,
                    possible: Number.isFinite(pointsPossible) ? pointsPossible : 0,
                    gradePercent: earned != null && pointsPossible > 0 ? (earned / pointsPossible) * 100 : null,
                    dueDate: grade.dueAt || null,
                    htmlUrl: null,
                    status: grade.workflowState || 'graded',
                    isPending: earned == null,
                    isFuture: grade.dueAt ? new Date(grade.dueAt) > new Date() : false
                });
            });

            const sortedRows = rows.sort((firstRow, secondRow) => {
                const firstTime = firstRow.dueDate ? new Date(firstRow.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
                const secondTime = secondRow.dueDate ? new Date(secondRow.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
                return firstTime - secondTime;
            });

            sendResponse({
                success: true,
                data: {
                    course: {
                        id: course.id,
                        name: course.name,
                        grade: course.grade,
                        letterGrade: course.letterGrade
                    },
                    rows: sortedRows,
                    weightingMode: assignmentGroups.some(group => Number(group.group_weight || 0) > 0) ? 'weighted' : 'points'
                }
            });
        } catch (error) {
            console.error('Background: GET_COURSE_SIMULATOR_DATA failed:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    buildAcademicBriefingContext(canvasData, blackbaudCalendar, emailResult, courseGradeHistory, lastUpdate) {
        const prioritizedAssignments = [...(canvasData.assignments || [])]
            .map(assignment => ({
                ...assignment,
                priorityScore: this.computeAssignmentPriorityScore(assignment, canvasData.courses || [])
            }))
            .sort((firstAssignment, secondAssignment) => secondAssignment.priorityScore - firstAssignment.priorityScore)
            .slice(0, 8);

        const gradeChanges = this.computeCourseGradeChanges(canvasData.courses || [], courseGradeHistory || []);
        const upcomingCalendarEvents = [...(blackbaudCalendar?.events || [])]
            .map(event => ({
                title: event.title || event.name || 'Untitled Event',
                start: event.start_date || event.start || null,
                location: event.location || event.location_name || '',
                description: event.description || ''
            }))
            .filter(event => event.start && new Date(event.start) >= new Date())
            .sort((firstEvent, secondEvent) => new Date(firstEvent.start) - new Date(secondEvent.start))
            .slice(0, 6);

        const unreadEmails = (emailResult?.emails || [])
            .filter(email => Array.isArray(email.labelIds) && email.labelIds.includes('UNREAD'))
            .slice(0, 6)
            .map(email => ({
                id: email.id,
                subject: email.subject || '(No subject)',
                from: email.from || 'Unknown sender',
                date: email.date || '',
                snippet: email.snippet || ''
            }));

        return {
            generatedAt: new Date().toISOString(),
            lastUpdate,
            student: canvasData.user || null,
            courses: (canvasData.courses || []).map(course => ({
                id: course.id,
                name: course.name,
                grade: course.grade,
                letterGrade: course.letterGrade
            })),
            prioritizedAssignments: prioritizedAssignments.map(assignment => ({
                id: assignment.id,
                title: assignment.title,
                courseName: assignment.courseName,
                dueDate: assignment.dueDate,
                points: assignment.points,
                priorityScore: assignment.priorityScore
            })),
            gradeChanges,
            calendarEvents: upcomingCalendarEvents,
            unreadEmails,
            emailConnected: emailResult?.connected !== false && !emailResult?.needsReconnect
        };
    }

    computeAssignmentPriorityScore(assignment, courses = []) {
        const dueTime = assignment?.dueDate ? new Date(assignment.dueDate).getTime() : null;
        const now = Date.now();
        const daysUntilDue = dueTime == null ? 999 : Math.ceil((dueTime - now) / (1000 * 60 * 60 * 24));
        const points = Number(assignment?.points || 0);
        const matchingCourse = courses.find(course => String(course.id) === String(assignment.courseId));
        const currentGrade = Number(matchingCourse?.grade);

        let score = 10;
        if (daysUntilDue < 0) score += 60;
        else if (daysUntilDue === 0) score += 50;
        else if (daysUntilDue === 1) score += 40;
        else if (daysUntilDue <= 3) score += 28;
        else if (daysUntilDue <= 7) score += 15;

        if (points >= 100) score += 20;
        else if (points >= 50) score += 12;
        else if (points >= 20) score += 6;

        if (Number.isFinite(currentGrade) && currentGrade < 80) score += 10;
        else if (Number.isFinite(currentGrade) && currentGrade < 90) score += 5;

        return score;
    }

    computeCourseGradeChanges(courses, courseGradeHistory) {
        if (!Array.isArray(courses) || courses.length === 0) return [];

        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const historicalEntry = [...(courseGradeHistory || [])]
            .filter(entry => entry?.timestamp && new Date(entry.timestamp).getTime() <= sevenDaysAgo)
            .sort((firstEntry, secondEntry) => new Date(secondEntry.timestamp) - new Date(firstEntry.timestamp))[0];

        const historicalMap = new Map(
            (historicalEntry?.courses || []).map(course => [String(course.courseId), Number(course.grade)])
        );

        return courses
            .map(course => {
                const currentGrade = Number(course.grade);
                if (!Number.isFinite(currentGrade)) return null;

                const previousGrade = historicalMap.get(String(course.id));
                const delta = Number.isFinite(previousGrade)
                    ? Number((currentGrade - previousGrade).toFixed(1))
                    : null;

                return {
                    courseId: String(course.id),
                    courseName: course.name,
                    currentGrade,
                    previousGrade: Number.isFinite(previousGrade) ? previousGrade : null,
                    delta
                };
            })
            .filter(Boolean);
    }

    async generateAcademicBriefingNarrative(briefingContext, canvasData) {
        const canvasToken = await this.getCanvasToken();
        if (!canvasToken) {
            return this.buildAcademicBriefingFallback(briefingContext);
        }

        const response = await fetch(`${this.apiEndpoint}/ai/briefing`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${canvasToken}`
            },
            body: JSON.stringify({
                briefingContext,
                canvasData
            })
        });

        if (!response.ok) {
            throw new Error(`Academic briefing request failed: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success || !result.summary) {
            throw new Error(result.error || 'Academic briefing unavailable');
        }

        return result.summary;
    }

    normalizeAcademicBriefingText(text) {
        return String(text || '')
            .replace(/\p{Extended_Pictographic}/gu, '')
            .replace(/!/g, '.')
            .replace(/\b(Great job|Don['’]t forget|I'd be happy to help|I would be happy to help)\b/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    buildAcademicBriefingFallback(briefingContext) {
        const lines = [];
        const topAssignment = briefingContext.prioritizedAssignments[0];
        if (topAssignment) {
            const dueLabel = topAssignment.dueDate
                ? new Date(topAssignment.dueDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                : 'soon';
            lines.push(`${topAssignment.title} for ${topAssignment.courseName || 'class'} is the most urgent task and is due ${dueLabel}.`);
        }

        const changedCourse = briefingContext.gradeChanges
            .filter(change => change.delta != null && Math.abs(change.delta) >= 0.5)
            .sort((firstChange, secondChange) => Math.abs(secondChange.delta) - Math.abs(firstChange.delta))[0];
        if (changedCourse) {
            const direction = changedCourse.delta > 0 ? 'up' : 'down';
            lines.push(`${changedCourse.courseName} is ${direction} ${Math.abs(changedCourse.delta)} points over the last 7 days and is currently ${Math.round(changedCourse.currentGrade)}%.`);
        }

        if (briefingContext.calendarEvents.length > 0) {
            const event = briefingContext.calendarEvents[0];
            const when = new Date(event.start).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            lines.push(`${event.title} is on ${when}${event.location ? ` at ${event.location}` : ''} and may affect study time.`);
        }

        if (briefingContext.unreadEmails.length > 0) {
            lines.push(`You have ${briefingContext.unreadEmails.length} unread school email${briefingContext.unreadEmails.length === 1 ? '' : 's'} to review.`);
        }

        if (lines.length === 0) {
            return 'No urgent academic changes were found in the latest synced data. Use today to make progress on upcoming coursework.';
        }

        return lines.join(' ');
    }

    async recordCourseGradeHistory(courses = []) {
        const snapshotCourses = (courses || [])
            .map(course => ({
                courseId: String(course.id),
                name: course.name,
                grade: Number(course.grade)
            }))
            .filter(course => Number.isFinite(course.grade));

        if (snapshotCourses.length === 0) {
            return;
        }

        const stored = await chrome.storage.local.get(['courseGradeHistory']);
        const history = Array.isArray(stored.courseGradeHistory) ? stored.courseGradeHistory : [];
        const now = Date.now();
        const twelveHours = 12 * 60 * 60 * 1000;
        const recentHistory = history.filter(entry => {
            const timestamp = new Date(entry.timestamp || 0).getTime();
            return now - timestamp < 30 * 24 * 60 * 60 * 1000;
        });

        const lastEntry = recentHistory[recentHistory.length - 1];
        if (lastEntry && now - new Date(lastEntry.timestamp).getTime() < twelveHours) {
            const updatedHistory = [
                ...recentHistory.slice(0, -1),
                {
                    ...lastEntry,
                    timestamp: new Date(now).toISOString(),
                    courses: snapshotCourses
                }
            ];
            await chrome.storage.local.set({ courseGradeHistory: updatedHistory });
            return;
        }

        recentHistory.push({
            timestamp: new Date(now).toISOString(),
            courses: snapshotCourses
        });

        await chrome.storage.local.set({ courseGradeHistory: recentHistory });
    }

    async refreshCanvasDataAPI(tab, sendResponse) {
        try {
            if (tab && tab.url.includes('instructure.com')) {
                // Inject content script to trigger API data extraction
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                
                // Wait for data to be processed
                setTimeout(() => {
                    this.getCanvasData(sendResponse);
                }, 2000);
            } else {
                sendResponse({
                    success: false,
                    error: 'Not on a Canvas page'
                });
            }
        } catch (error) {
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }

    async processCanvasData(data, tab) {
        // Store the data
        await chrome.storage.local.set({
            canvasData: data,
            lastUpdate: new Date().toISOString()
        });

        // Update badge
        await this.updateBadge(tab.id, 'data-ready');

        // Send notification if enabled
        const settings = await chrome.storage.local.get(['notifications']);
        if (settings.notifications) {
            await this.showNotification('Canvas data updated', 'Your academic information has been synchronized.');
        }
    }

    async handleAIChatRequest(data, sendResponse) {
        console.log('Background: Handling AI chat request (Gemini function calling)...');
        
        console.log('Background: canvasData being sent to server:', {
            hasCourses: !!data.canvasData?.courses?.length,
            courseCount: data.canvasData?.courses?.length || 0,
            hasAssignments: !!data.canvasData?.assignments?.length,
            assignmentCount: data.canvasData?.assignments?.length || 0,
            hasGrades: !!data.canvasData?.assignmentGrades?.length,
            gradeCount: data.canvasData?.assignmentGrades?.length || 0
        });
    
        // ── Purge generic "I don't have access" from history ──
        let historyToSend = (data.conversationHistory || []).filter(turn => {
            if (turn.role === 'assistant' && turn.content) {
                const dominated = [
                    /I don't have access to your personal/i,
                    /as an AI,? I (?:don't|cannot|can't) (?:have )?access/i,
                    /log in to platforms like/i,
                    /I'm unable to access your/i,
                    /check your school's (?:LMS|learning management)/i
                ];
                return !dominated.some(p => p.test(turn.content));
            }
            return true;
        });
    
        // ── Enrich canvasData from storage if thin ──
        let enrichedCanvasData = data.canvasData || null;
        if (!enrichedCanvasData || !enrichedCanvasData.courses || enrichedCanvasData.courses.length === 0) {
            try {
                const stored = await chrome.storage.local.get(['canvasData']);
                if (stored.canvasData) {
                    enrichedCanvasData = {
                        courses: stored.canvasData.courses || [],
                        assignments: stored.canvasData.assignments || [],
                        assignmentGrades: (stored.canvasData.assignmentGrades || []).slice(0, 50),
                        announcements: (stored.canvasData.announcements || []).slice(0, 20),
                        calendarEvents: stored.canvasData.calendarEvents || [],
                        user: stored.canvasData.user || null
                    };
                    console.log('Background: Enriched canvasData from storage:', {
                        courses: enrichedCanvasData.courses.length,
                        assignments: enrichedCanvasData.assignments.length,
                        grades: enrichedCanvasData.assignmentGrades.length
                    });
                }
            } catch (e) {
                console.warn('Background: Failed to enrich canvas data:', e);
            }
        }
    
        const MAX_CHAINS = 3;
        let chainCount = 0;
    
        try {
            const canvasToken = await this.getCanvasToken();
            if (!canvasToken) {
                sendResponse({ success: false, error: 'Not authenticated. Please log in first.' });
                return;
            }
    
            // ════════════════════════════════════════════
            // STEP 1: Initial request to server
            // ════════════════════════════════════════════
            console.log('Background: Sending to server /api/ai/chat...');
            const serverResponse = await fetch(`${this.apiEndpoint}/ai/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${canvasToken}`
                },
                body: JSON.stringify({
                    message: data.message,
                    canvasData: enrichedCanvasData,
                    conversationHistory: historyToSend
                })
            });
    
            if (!serverResponse.ok) {
                const errText = await serverResponse.text();
                console.error('Background: Server error:', serverResponse.status, errText);
                sendResponse({ success: false, error: `Server error: ${serverResponse.status}` });
                return;
            }
    
            let result = await serverResponse.json();

            console.log('Background: Server response:', {
                type: result.type,
                success: result.success,
                hasResponse: !!result.response,
                hasFunctionCall: !!result.functionCall
            });
    
            if (!result.success) {
                sendResponse({ success: false, error: result.error || 'Server returned failure' });
                return;
            }
    
            // ════════════════════════════════════════════
            // STEP 2: If text response, return immediately
            // ════════════════════════════════════════════
            if (result.type === 'text') {
                console.log('Background: Got text response, returning to chatbot');
                this.conversationHistory.push(
                    { role: 'user', content: data.message },
                    { role: 'assistant', content: result.response }
                );
                if (this.conversationHistory.length > 40) {
                    this.conversationHistory = this.conversationHistory.slice(-30);
                }
                this.saveConversationHistory();
                sendResponse({ success: true, response: result.response, blocked: result.blocked || false });
                return;
            }
    
            // ════════════════════════════════════════════
            // STEP 3: Function call loop
            // ════════════════════════════════════════════
            while (result.type === 'function_call' && chainCount < MAX_CHAINS) {
                chainCount++;
                const { name, args } = result.functionCall;
                console.log(`Background: Executing tool #${chainCount}: ${name}`, args);
    
                let toolResult;
                try {
                    toolResult = await this.executeToolCall(name, args, enrichedCanvasData);
                    console.log(`Background: Tool ${name} returned:`, {
                        type: typeof toolResult,
                        isArray: Array.isArray(toolResult),
                        length: Array.isArray(toolResult) ? toolResult.length : undefined,
                        preview: JSON.stringify(toolResult).substring(0, 300)
                    });
                } catch (toolError) {
                    console.error(`Background: Tool ${name} failed:`, toolError);
                    toolResult = { error: toolError.message, tool: name };
                }
    
                // ── Send tool result back to server ──
                console.log('Background: Sending tool result to /api/ai/chat/tool-result...');
                const synthResponse = await fetch(`${this.apiEndpoint}/ai/chat/tool-result`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${canvasToken}`
                    },
                    body: JSON.stringify({
                        functionName: name,
                        functionArgs: args,
                        toolResult: toolResult,
                        conversationHistory: historyToSend,
                        canvasData: enrichedCanvasData,
                        geminiResponseContent: result._geminiResponseContent || null
                    })
                });
    
                if (!synthResponse.ok) {
                    const errText = await synthResponse.text();
                    console.error('Background: Tool-result error:', synthResponse.status, errText);
                    const fallback = this.formatToolResultFallback(name, toolResult);
                    this.conversationHistory.push(
                        { role: 'user', content: data.message },
                        { role: 'assistant', content: fallback }
                    );
                    this.saveConversationHistory();
                    sendResponse({ success: true, response: fallback });
                    return;
                }
    
                result = await synthResponse.json();
                console.log(`Background: Tool-result response #${chainCount}:`, {
                    type: result.type,
                    success: result.success,
                    hasResponse: !!result.response,
                    hasFunctionCall: !!result.functionCall
                });
    
                if (!result.success) {
                    const fallback = this.formatToolResultFallback(name, toolResult);
                    this.conversationHistory.push(
                        { role: 'user', content: data.message },
                        { role: 'assistant', content: fallback }
                    );
                    this.saveConversationHistory();
                    sendResponse({ success: true, response: fallback });
                    return;
                }
    
                if (result.type === 'text') {
                    break;
                }
            }
    
            if (chainCount >= MAX_CHAINS && result.type === 'function_call') {
                console.warn('Background: Max chain depth reached');
                sendResponse({ success: true, response: "I gathered some data but hit a processing limit. Could you try a more specific question?" });
                return;
            }
    
            // ════════════════════════════════════════════
            // STEP 4: Return final response
            // ════════════════════════════════════════════
            const finalResponse = result.response || "I processed your request but couldn't generate a clear response. Please try again.";
            this.conversationHistory.push(
                { role: 'user', content: data.message },
                { role: 'assistant', content: finalResponse }
            );
            if (this.conversationHistory.length > 40) {
                this.conversationHistory = this.conversationHistory.slice(-30);
            }
            this.saveConversationHistory();
            sendResponse({ success: true, response: finalResponse });
    
        } catch (error) {
            console.error('Background: AI chat error:', error);
            sendResponse({ success: false, error: error.message || 'AI processing failed' });
        }
    }
    
    // ── Fallback formatter when server synthesis fails ──
    formatToolResultFallback(toolName, toolResult) {
        try {
            if (!toolResult) return "I retrieved some data but couldn't format it properly.";
    
            if (toolName === 'get_assignments' && Array.isArray(toolResult)) {
                if (toolResult.length === 0) return "You don't have any upcoming assignments! 🎉";
                let text = `📅 **Upcoming Assignments** (${toolResult.length}):\n\n`;
                toolResult.slice(0, 10).forEach(a => {
                    const due = a.dueDate ? new Date(a.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No due date';
                    text += `• **${a.title || a.name}** — ${a.courseName || 'Unknown'}\n  Due: ${due} | ${a.points || a.pointsPossible || '?'} pts\n\n`;
                });
                return text;
            }

            if (toolName === 'get_blackbaud_calendar') {
                const events = Array.isArray(toolResult?.events) ? toolResult.events : [];

                if (events.length === 0) return "No Blackbaud calendar events found for that date range.";

                let text = `📅 **Blackbaud Calendar Events** (${toolResult.startDate} → ${toolResult.endDate})\n\n`;
                events.slice(0, 10).forEach(event => {
                    const title = event.title || event.name || 'Untitled Event';
                    const start = event.start_date || event.start;
                    const when = start
                        ? new Date(start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                        : 'Date unavailable';
                    const location = event.location || event.location_name;
                    text += `• **${title}** — ${when}${location ? ` @ ${location}` : ''}\n`;
                });
                return text;
            }
    
            if (toolName === 'get_grades') {
                if (Array.isArray(toolResult)) {
                    let text = `📊 **Your Grades**:\n\n`;
                    toolResult.forEach(g => {
                        text += `• **${g.courseName || g.name}**: ${g.grade || g.score || 'N/A'}${g.letterGrade ? ` (${g.letterGrade})` : ''}\n`;
                    });
                    return text;
                }
                if (toolResult.courses) {
                    let text = `📊 **Your Grades**:\n\n`;
                    toolResult.courses.forEach(c => {
                        text += `• **${c.name}**: ${c.grade || 'N/A'}%${c.letterGrade ? ` (${c.letterGrade})` : ''}\n`;
                    });
                    return text;
                }
            }
    
            if (toolName === 'get_course_list' && Array.isArray(toolResult)) {
                let text = `📚 **Your Courses** (${toolResult.length}):\n\n`;
                toolResult.forEach(c => {
                    text += `• **${c.name}**${c.grade ? ` — ${c.grade}%` : ''}${c.letterGrade ? ` (${c.letterGrade})` : ''}\n`;
                });
                return text;
            }
    
            if (toolName === 'get_announcements' && Array.isArray(toolResult)) {
                if (toolResult.length === 0) return "No recent announcements found.";
                let text = `📢 **Recent Announcements**:\n\n`;
                toolResult.slice(0, 10).forEach(a => {
                    text += `• **${a.title}** in ${a.course || 'Unknown'}${a.date ? ` (${new Date(a.date).toLocaleDateString()})` : ''}\n`;
                });
                return text;
            }
    
            if (toolName === 'get_dining_menu') {
                if (typeof toolResult === 'string') return toolResult;
                if (toolResult && toolResult.success) return this.menuService.formatMenuResponse(toolResult);
            }
    
            if (toolName === 'get_emails' && toolResult.emails) {
                if (toolResult.emails.length === 0) return "No recent school emails found.";
                let text = `📧 **Recent Emails** (${toolResult.emails.length}):\n\n`;
                toolResult.emails.slice(0, 10).forEach(e => {
                    text += `• **${e.subject}**\n  From: ${e.from} | ${e.date || ''}\n\n`;
                });
                return text;
            }
    
            const jsonStr = JSON.stringify(toolResult, null, 2);
            return `Here's what I found:\n\n\`\`\`\n${jsonStr.substring(0, 800)}\n\`\`\``;
        } catch (e) {
            return "I found some data but had trouble formatting it.";
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 🆕 TOOL EXECUTOR — Routes Gemini function calls to local tools
    // This replaces agent_manager.js keyword matching for server-driven flow
    // ═══════════════════════════════════════════════════════════════
    _promisifyHandler(handlerFn, args = [], timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Handler timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            const wrappedCallback = (result) => {
                clearTimeout(timer);
                if (result.success) {
                    resolve(result.data);
                } else {
                    reject(new Error(result.error || 'Handler returned failure'));
                }
            };

            try {
                handlerFn.call(this, ...args, wrappedCallback);
            } catch (e) {
                clearTimeout(timer);
                reject(e);
            }
        });
    }
    async executeToolCall(functionName, args, canvasData) {
        console.log(`🔧 executeToolCall: ${functionName}`, args);
    
        // Ensure we have fresh canvas data from storage if not provided
        if (!canvasData || !canvasData.courses) {
            try {
                const stored = await chrome.storage.local.get(['canvasData']);
                if (stored.canvasData) {
                    canvasData = stored.canvasData;
                }
            } catch (e) {
                console.warn('executeToolCall: Failed to load canvas data from storage');
            }
        }
    
        switch (functionName) {
            case 'get_assignments': {
                const stored = await chrome.storage.local.get('canvasData');
                const allAssignments = stored.canvasData?.assignments || [];
                
                // Filter out assignments with no due date
                let assignments = allAssignments.filter(a => a.dueDate);
                
                if (args.course_name) {
                    const courseLower = args.course_name.toLowerCase();
                    assignments = assignments.filter(a => 
                        (a.courseName || '').toLowerCase().includes(courseLower)
                    );
                }
                
                const now = new Date();
                if (args.time_range === 'overdue') {
                    assignments = assignments.filter(a => 
                        a.dueDate && new Date(a.dueDate) < now && 
                        a.status !== 'submitted' && a.status !== 'graded'
                    );
                } else if (args.time_range === 'today') {
                    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59);
                    assignments = assignments.filter(a => 
                        a.dueDate && new Date(a.dueDate) >= now && new Date(a.dueDate) <= endOfDay
                    );
                } else if (args.time_range === 'tomorrow') {
                    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
                    const endTomorrow = new Date(tomorrow); endTomorrow.setHours(23, 59, 59);
                    tomorrow.setHours(0, 0, 0, 0);
                    assignments = assignments.filter(a => 
                        a.dueDate && new Date(a.dueDate) >= tomorrow && new Date(a.dueDate) <= endTomorrow
                    );
                } else if (args.time_range === 'this_week') {
                    const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
                    assignments = assignments.filter(a => 
                        a.dueDate && new Date(a.dueDate) >= now && new Date(a.dueDate) <= weekEnd
                    );
                } else if (args.time_range === 'next_week') {
                    const nextWeekStart = new Date(now); nextWeekStart.setDate(nextWeekStart.getDate() + (7 - nextWeekStart.getDay()) + 1);
                    const nextWeekEnd = new Date(nextWeekStart); nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
                    assignments = assignments.filter(a => 
                        a.dueDate && new Date(a.dueDate) >= nextWeekStart && new Date(a.dueDate) <= nextWeekEnd
                    );
                } else {
                    // Default: upcoming only
                    assignments = assignments.filter(a => !a.dueDate || new Date(a.dueDate) >= now);
                }
                
                assignments.sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0));
                console.log(`🔧 get_assignments: Returning ${assignments.length} assignments`);
                return assignments;
            }

            case 'get_blackbaud_calendar':
                return await this.fetchBlackbaudCalendarData(args.start_date, args.end_date);
    
            case 'get_grades': {
                const stored = await chrome.storage.local.get('canvasData');
                const cd = stored.canvasData || {};
                let grades = cd.assignmentGrades || [];
                const courses = cd.courses || [];
                
                // Apply course filter
                if (args.course_name) {
                    const cn = args.course_name.toLowerCase();
                    const matchedCourse = courses.find(c => 
                        (c.name || '').toLowerCase().includes(cn) ||
                        (c.subject || '').toLowerCase().includes(cn)
                    );
                    if (matchedCourse) {
                        grades = grades.filter(g => 
                            String(g.courseId) === String(matchedCourse.id)
                        );
                    }
                }
                
                // Apply filter type
                switch (args.filter) {
                    case 'recent':
                        grades = grades
                            .filter(g => g.gradedAt)
                            .sort((a, b) => new Date(b.gradedAt) - new Date(a.gradedAt))
                            .slice(0, 15);
                        break;
                    case 'missing':
                        grades = grades.filter(g => g.missing && !g.excused);
                        break;
                    case 'low':
                        grades = grades
                            .filter(g => g.percentage != null && g.percentage < 70)
                            .sort((a, b) => a.percentage - b.percentage)
                            .slice(0, 15);
                        break;
                    case 'high':
                        grades = grades
                            .filter(g => g.percentage != null && g.percentage >= 90)
                            .sort((a, b) => b.percentage - a.percentage)
                            .slice(0, 15);
                        break;
                    default:
                        // Return recent by default, sorted newest first
                        grades = grades
                            .filter(g => g.score != null)
                            .sort((a, b) => new Date(b.gradedAt || b.dueAt || 0) - new Date(a.gradedAt || a.dueAt || 0))
                            .slice(0, 25);
                }
                
                return {
                    success: true,
                    grades: grades,
                    totalGraded: (cd.assignmentGrades || []).filter(g => g.score != null).length,
                    courses: courses.map(c => ({ 
                        name: c.name, 
                        grade: c.grade, 
                        letterGrade: c.letterGrade 
                    }))
                };
            }
    
            case 'get_course_list': {
                return canvasData?.courses || [];
            }
    
            case 'get_announcements': {
                return await this._promisifyHandler(
                    (req, sr) => this.handleFetchAnnouncements(req, sr),
                    [{ courseIds: (canvasData?.courses || []).map(c => c.id), ...args }]
                );
            }
    
            case 'get_syllabus': {
                if (!args.course_name) return { error: 'Course name is required for syllabus lookup.' };
                const courses = canvasData?.courses || [];
                const courseLower = args.course_name.toLowerCase();
                const course = courses.find(c => (c.name || '').toLowerCase().includes(courseLower));
                if (!course) return { error: `Could not find a course matching "${args.course_name}".` };
                
                return await this._promisifyHandler(
                    (req, sr) => this.handleFetchSyllabi(req, sr),
                    [{ courseIds: [course.id] }]
                );
            }
    
            case 'get_assignment_detail': {
                if (args.course_id && args.assignment_id) {
                    return await this._promisifyHandler(
                        (req, sr) => this.handleFetchAssignmentDetail(req, sr),
                        [{ courseId: args.course_id, assignmentId: args.assignment_id }]
                    );
                }
                // Try to find by name
                if (args.assignment_name) {
                    const assignments = canvasData?.assignments || [];
                    const nameLower = args.assignment_name.toLowerCase();
                    const match = assignments.find(a => (a.title || '').toLowerCase().includes(nameLower));
                    if (match && match.courseId && match.id) {
                        return await this._promisifyHandler(
                            (req, sr) => this.handleFetchAssignmentDetail(req, sr),
                            [{ courseId: match.courseId, assignmentId: match.id }]
                        );
                    }
                    return match || { error: `Could not find assignment "${args.assignment_name}".` };
                }
                return { error: 'Please provide an assignment name or ID.' };
            }
    
            case 'get_dining_menu': {
                try {
                    const menuData = await this.menuService.fetchMenu(args.meal_type || null, args.date || null);
                    if (menuData?.meals) {
                        for (const [meal, items] of Object.entries(menuData.meals)) {
                            if (Array.isArray(items)) {
                                items.forEach(item => {
                                    const cat = (item.category || item.station || '').toLowerCase();
                                    if (cat.includes('entree') || cat.includes('entrée') || cat.includes('grill') || cat.includes('main')) {
                                        item._isEntree = true;
                                    }
                                });
                            }
                        }
                    }
                    return menuData;
                } catch (e) {
                    console.error('Dining menu fetch failed:', e);
                    return { error: e.message };
                }
            }
    
            case 'get_emails': {
                try {
                    const emailResult = await this.gmailService.fetchSchoolEmails({
                        maxResults: 10,
                        daysBack: 7,
                        ...(args.sender_filter ? { senderDomains: [args.sender_filter] } : {}),
                        ...(args.subject_filter ? { subjectKeywords: [args.subject_filter] } : {})
                    }, false);
                    return emailResult;
                } catch (e) {
                    console.error('Email fetch failed:', e);
                    return { error: e.message };
                }
            }
    
            default:
                console.warn(`🔧 Unknown tool: ${functionName}`);
                return { error: `Unknown tool: ${functionName}` };
        }
    }

    async getAgentStatus() {
        try {
            const tabs = await chrome.tabs.query({ 
                url: '*://*.instructure.com/*',
                active: true 
            });
            
            if (tabs.length > 0) {
                const response = await chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'AGENT_GET_STATUS'
                });
                return response || { status: 'unknown' };
            }
            return { status: 'no_canvas_tab' };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    async openChatbot(tab = null) {
        let targetTab = tab;
        
        if (!targetTab) {
            try {
                const tabs = await chrome.tabs.query({ 
                    url: '*://*.instructure.com/*' 
                });
                if (tabs.length > 0) targetTab = tabs[0];
                else return;
            } catch (error) {
                console.error('Error finding Canvas tab:', error);
                return;
            }
        }
    
        try {
            // Simply trigger the chatbot injection
            await chrome.scripting.executeScript({
                target: { tabId: targetTab.id },
                func: () => {
                    if (typeof injectChatbotContainer !== 'undefined') {
                        injectChatbotContainer();
                    } else {
                        // Fallback: create container directly
                        if (!document.getElementById('canvas-ai-assistant')) {
                            const container = document.createElement('div');
                            container.id = 'canvas-ai-assistant';
                            container.className = 'canvas-ai-assistant-container';
                            document.body.appendChild(container);
                        }
                    }
                }
            });
            
            console.log('Canvas AI Assistant: Chatbot triggered successfully');
            
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to open chatbot:', error);
        }
    }
    

    async getExtensionStatus(sendResponse) {
        try {
            const settings = await chrome.storage.local.get();
            const canvasData = await chrome.storage.local.get(['canvasData']);
            
            sendResponse({
                success: true,
                status: {
                    initialized: this.isInitialized,
                    canvasDetected: true, // Would need to check current tab
                    hasApiKey: !!settings.apiKey,
                    hasCanvasData: !!canvasData.canvasData,
                    lastUpdate: settings.lastUpdate,
                    version: chrome.runtime.getManifest().version
                }
            });
        } catch (error) {
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }

    async updateSettings(newSettings) {
        const currentSettings = await chrome.storage.local.get();
        const updatedSettings = { ...currentSettings, ...newSettings };
        await chrome.storage.local.set(updatedSettings);
    }

    prepareAIContext(canvasData, userMessage) {
        const now = new Date();
        const dateString = now.toLocaleDateString('en-US', { 
            weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        // --- PART 1: SYSTEM INSTRUCTIONS ---
        let systemParts = [
            `Current Date & Time: ${dateString}`,
            "You are 'Canvas AI', an academic assistant.",
            "RULES:",
            "1. Prioritize OVERDUE assignments if they exist.",
            "2. If an assignment is marked 'submitted', congratulate the student.",
            "3. Be concise. Do not list every single assignment unless asked.",
            "4. Distinguish between 'Quizzes' and 'Assignments'."
        ];

        // --- PART 2: INJECT DATA ---
        if (canvasData) {
            
            // 1. Process Assignments (The Fix)
            if (canvasData.assignments && canvasData.assignments.length > 0) {
                const pending = canvasData.assignments.filter(a => a.status !== 'submitted');
                
                // Sort by date (handle nulls by putting them at the end)
                pending.sort((a, b) => {
                    const dateA = a.dueDate ? new Date(a.dueDate) : new Date(8640000000000000);
                    const dateB = b.dueDate ? new Date(b.dueDate) : new Date(8640000000000000);
                    return dateA - dateB;
                });

                const overdue = pending.filter(a => a.dueDate && new Date(a.dueDate) < now);
                const upcoming = pending.filter(a => !a.dueDate || new Date(a.dueDate) >= now).slice(0, 15);

                systemParts.push("\n📋 STUDENT ASSIGNMENT DATA:");
                
                if (overdue.length > 0) {
                    systemParts.push("⚠️ MISSED / OVERDUE:");
                    overdue.forEach(a => {
                        systemParts.push(`- [OVERDUE] ${a.title} (${a.courseName}) was due ${new Date(a.dueDate).toLocaleDateString()}`);
                    });
                }

                if (upcoming.length > 0) {
                    systemParts.push("📅 UPCOMING / TO-DO:");
                    upcoming.forEach(a => {
                        const dueStr = a.dueDate ? new Date(a.dueDate).toLocaleString() : 'No Due Date';
                        systemParts.push(`- ${a.title} (${a.courseName}) due ${dueStr} [Points: ${a.points || 'N/A'}]`);
                    });
                }
            } else {
                systemParts.push("\nNo active assignments found in Canvas planner.");
            }

            // 2. Process Courses
            if (canvasData.courses && canvasData.courses.length > 0) {
                systemParts.push(`\n📚 ENROLLED COURSES (${canvasData.courses.length} total):`);
                canvasData.courses.forEach(c => {
                    const gradeStr = c.grade != null ? `${c.grade}%` : 'N/A';
                    const letterStr = c.letterGrade ? ` (${c.letterGrade})` : '';
                    systemParts.push(`- ${c.name}: Grade ${gradeStr}${letterStr}`);
                });
            }
        }

        return {
            systemInstruction: systemParts.join("\n"),
            userMessage: userMessage
        };
    }

    async syncWithBackend(data) {
        try {
            const response = await fetch(`${this.apiEndpoint}/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    canvasData: data,
                    timestamp: new Date().toISOString()
                })
            });

            if (!response.ok) {
                throw new Error(`Backend sync failed: ${response.status}`);
            }

            console.log('Canvas AI Assistant: Successfully synced with backend');
            
        } catch (error) {
            console.warn('Canvas AI Assistant: Backend sync failed:', error);
        }
    }

    async updateBadge(tabId, status) {
        let text = '';
        let color = '#6c757d';
    
        switch (status) {
            case 'active':
                text = '●';
                color = '#28a745'; // Green
                break;
            case 'syncing':
                text = '⟳';
                color = '#ffc107'; // Yellow
                break;
            case 'data-ready':
            case 'authenticated':  // ✅ Add this case
                text = '✓';
                color = '#007bff'; // Blue
                break;
            case 'success':  // ✅ Add this case
                text = '✓';
                color = '#4CAF50'; // Green
                break;
            case 'error':
                text = '!';
                color = '#dc3545'; // Red
                break;
            default:
                text = '';
        }
    
        try {
            if (tabId) {
                await chrome.action.setBadgeText({ text: text, tabId: tabId });
                await chrome.action.setBadgeBackgroundColor({ color: color, tabId: tabId });
            } else {
                // Set default badge for all tabs
                await chrome.action.setBadgeText({ text: text });
                await chrome.action.setBadgeBackgroundColor({ color: color });
            }
        } catch (e) {
            console.warn('Badge update failed:', e);
        }
    }
    

    async showNotification(title, message) {
        try {
            // Check if notifications are available
            if (!chrome.notifications) {
                console.log('Canvas AI Assistant: Notifications API not available');
                return;
            }
    
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: chrome.runtime.getURL('/final-school-logo.png'), // ✅ Use getURL for proper path
                title: title,
                message: message
            });
        } catch (error) {
            console.warn('Canvas AI Assistant: Failed to show notification:', error);
        }
    }
}


const backgroundService = new CanvasAIBackground();
backgroundService.initialize();
