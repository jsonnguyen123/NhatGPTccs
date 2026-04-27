class CanvasAuthManager {
    constructor() {
        this.canvasToken = null;
        this.apiKey = null;
        this.isAuthenticated = false;
        this.init();
    }

    async init() {
        try {
            // 1. Just load the data. Do NOT validate or sync.
            await this.loadAuthData();
            
            // 2. Setup listeners
            this.setupAuthEventListeners();
            
            console.log('Canvas AI Assistant: Auth manager initialized (Passive Mode)');
        } catch (error) {
            console.error('Canvas AI Assistant: Auth initialization failed:', error);
        }
    }

    async loadAuthData() {
        try {
            const result = await chrome.storage.local.get(['canvasToken', 'apiKey', 'authStatus']);
            this.canvasToken = result.canvasToken || null;
            this.apiKey = result.apiKey || null;
            
            // Trust the stored status initially
            this.isAuthenticated = result.authStatus === 'authenticated';
            
            if (this.canvasToken && !this.isAuthenticated) {
                console.log("Auth: Tokens exist but status is false. Waiting for manual validation.");
            }
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to load auth data:', error);
        }
    }

    async saveAuthData() {
        try {
            await chrome.storage.local.set({
                authStatus: this.isAuthenticated ? 'authenticated' : 'unauthenticated',
                lastAuthUpdate: new Date().toISOString()
            });
            console.log('Auth data status updated:', this.isAuthenticated ? 'authenticated' : 'unauthenticated');
        } catch (error) {
            console.error('Failed to save auth data:', error);
        }
    }

    async validateCanvasTokenWithAPI(token) {
        try {
            if (!token) return false;
   
            console.log('Auth: Validating Canvas token via background script...');
            
            const response = await this.sendMessageToBackground({
                type: 'VALIDATE_CANVAS_TOKEN',
                token: token
            });
            
            if (!response) {
                console.warn("Auth: Background validation returned no response. Keeping current state.");
                return false; 
            }
            
            console.log('Auth: Token validation result:', response);
            return response.success;
            
        } catch (error) {
            console.error('Canvas AI Assistant: Token validation error:', error);
            return false;
        }
    }

    async sendMessageToBackground(message) {
        return new Promise((resolve) => {
            if (chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('Auth: Message to background failed:', chrome.runtime.lastError);
                        resolve(null);
                    } else {
                        resolve(response);
                    }
                });
            } else {
                console.warn('Auth: chrome.runtime not available');
                resolve(null);
            }
        });
    }

    async validateOpenAIKeyWithAPI(key) {
        try {
            if (!key) return false;

            const response = await fetch('https://api.openai.com/v1/models', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(10000)
            });

            return response.ok;
        } catch (error) {
            console.error('Canvas AI Assistant: OpenAI key validation error:', error);
            return false;
        }
    }

    // Called by UI when user clicks "Save" or "Test" - validates but does NOT sync
    async setCanvasToken(token) {
        try {
            const isValid = await this.validateCanvasTokenWithAPI(token);
            if (!isValid) {
                throw new Error('Invalid Canvas token - API validation failed');
            }
   
            this.canvasToken = token;
            this.isAuthenticated = true; 
            
            // Save token and status - NO sync triggered
            await chrome.storage.local.set({
                canvasToken: token,
                authStatus: 'authenticated'
            });
            
            console.log('Canvas token set and authenticated (sync will happen on Canvas tab reload)');
   
            return true;
        } catch (error) {
            console.error('Failed to set Canvas token:', error);
            return false;
        }
    }
   
    async setOpenAIKey(key) {
        try {
            const isValid = await this.validateOpenAIKeyWithAPI(key);
            if (!isValid) {
                throw new Error('Invalid OpenAI key - API validation failed');
            }

            this.apiKey = key;
            await chrome.storage.local.set({
                apiKey: key
            });

            console.log('Canvas AI Assistant: OpenAI key set successfully');
            return true;
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to set OpenAI key:', error);
            return false;
        }
    }

    // REMOVED: triggerDataSync() - sync now only happens on Canvas tab reload

    async clearAuthData() {
        try {
            this.canvasToken = null;
            this.apiKey = null;
            this.isAuthenticated = false;
            
            await chrome.storage.local.remove(['canvasToken', 'apiKey', 'authStatus']);
            console.log('Canvas AI Assistant: Auth data cleared');
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to clear auth data:', error);
        }
    }

    getAuthStatus() {
        return {
            isAuthenticated: this.isAuthenticated,
            hasCanvasToken: !!this.canvasToken,
            hasOpenAIKey: !!this.apiKey,
            dataSource: this.canvasToken ? 'api' : 'none'
        };
    }

    setupAuthEventListeners() {
        if (!chrome.runtime.onMessage) return;

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'GET_AUTH_STATUS') {
                chrome.storage.local.get(['authStatus', 'canvasToken'], (data) => {
                    const status = {
                        isAuthenticated: data.authStatus === 'authenticated',
                        hasCanvasToken: !!data.canvasToken,
                        dataSource: 'api'
                    };
                    sendResponse({ authStatus: status });
                });
                return true;
            }
        });
    }

    // UI Helpers (minimal implementation for content script context)
    showLoading(message) { console.log('Loading:', message); }
    hideLoading() { console.log('Loading hidden'); }
    showError(message) { console.error('Error:', message); }
    showSuccess(message) { console.log('Success:', message); }
}

// Canvas Token Setup Guide
class CanvasTokenGuide {
    constructor() {
        this.steps = [
            {
                title: "Step 1: Access Canvas API Settings",
                description: "Log into your Canvas account and navigate to your profile settings.",
                action: "Go to Canvas → Account → Settings",
                icon: "🔐"
            },
            {
                title: "Step 2: Generate API Access Token",
                description: "Create a new API access token for the Canvas AI Assistant.",
                action: "Scroll to 'Approved Integrations' → Click '+ New Access Token'",
                icon: "🔑"
            },
            {
                title: "Step 3: Configure Token Settings",
                description: "Set up your token with appropriate permissions for API access.",
                action: "Name: 'Canvas AI Assistant', Expires: 1 year, Permissions: Read access",
                icon: "⚙️"
            },
            {
                title: "Step 4: Copy Your Token",
                description: "Copy the generated token and authenticate in the extension.",
                action: "Copy the token string and save it securely",
                icon: "📋"
            }
        ];
    }

    generateGuideHTML() {
        return `
            <div class="canvas-token-guide">
                <div class="guide-header">
                    <h2>🔐 Canvas API Authentication</h2>
                    <p>Follow these steps to authenticate with Canvas API:</p>
                </div>
                
                <div class="guide-steps">
                    ${this.steps.map((step, index) => `
                        <div class="guide-step" data-step="${index + 1}">
                            <div class="step-icon">${step.icon}</div>
                            <div class="step-content">
                                <h3>${step.title}</h3>
                                <p>${step.description}</p>
                                <div class="step-action">
                                    <strong>Action:</strong> ${step.action}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="guide-tips">
                    <h3>💡 API Benefits:</h3>
                    <ul>
                        <li>Access to all your courses and assignments</li>
                        <li>Real-time data synchronization</li>
                        <li>Comprehensive grade and assignment information</li>
                        <li>Works across all Canvas pages</li>
                    </ul>
                </div>
            </div>
        `;
    }
}

// OpenAI Key Management
class OpenAIKeyManager {
    constructor() {
        this.init();
    }

    init() {
        this.setupKeyGenerationFallback();
    }

    setupKeyGenerationFallback() {
        if (chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (request.type === 'GET_OPENAI_SETUP_OPTIONS') {
                    const options = this.getSetupOptions();
                    sendResponse({ options });
                }
            });
        }
    }

    getSetupOptions() {
        return [
            {
                id: 'manual',
                title: 'OpenAI API Setup',
                description: 'Get your API key from OpenAI Platform to enable AI features',
                difficulty: 'Easy',
                time: '2-3 minutes',
                steps: [
                    'Visit https://platform.openai.com/api-keys',
                    'Sign in or create an account',
                    'Click "Create new secret key"',
                    'Copy the key and paste it in settings'
                ],
                benefits: ['AI-powered responses', 'Personalized assistance', 'Intelligent task prioritization']
            }
        ];
    }
}

// Initialize auth manager
const authManager = new CanvasAuthManager();
const tokenGuide = new CanvasTokenGuide();
const openAIKeyManager = new OpenAIKeyManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CanvasAuthManager, CanvasTokenGuide, OpenAIKeyManager };
}