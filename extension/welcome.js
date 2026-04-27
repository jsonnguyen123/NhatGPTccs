// Welcome Page - Authentication Handler
class WelcomeAuth {
    constructor() {
        this.init();
    }

    async init() {
        console.log('Welcome: Initializing authentication page...');
        this.setupEventListeners();
        await this.checkExistingAuth();
    }

    setupEventListeners() {
        // Canvas OAuth Button
        const canvasOAuthBtn = document.getElementById('canvas-oauth-btn');
        if (canvasOAuthBtn) {
            canvasOAuthBtn.addEventListener('click', () => {
                this.initiateCanvasOAuth();
            });
        }

        const canvasOAuthSuppBtn = document.getElementById('nav-login-btn');
        if (canvasOAuthSuppBtn) {
            canvasOAuthSuppBtn.addEventListener('click', () => {
                this.initiateCanvasOAuth();
            });
        }

        const canvasOAuthMainBtn = document.getElementById('hero-start-btn');
        if (canvasOAuthMainBtn) {
            canvasOAuthMainBtn.addEventListener('click', () => {
                this.initiateCanvasOAuth();
            });
        }

        // Manual Setup Button
        const manualSetupBtn = document.getElementById('manual-setup-btn');
        if (manualSetupBtn) {
            manualSetupBtn.addEventListener('click', () => {
                this.openManualSetup();
            });
        }

        // OpenAI Setup Button
        const openaiSetupBtn = document.getElementById('openai-setup-btn');
        if (openaiSetupBtn) {
            openaiSetupBtn.addEventListener('click', () => {
                this.openOpenAISetup();
            });
        }

        // Privacy Link
        const privacyLink = document.getElementById('privacy-link');
        if (privacyLink) {
            privacyLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showPrivacyInfo();
            });
        }
    }

    async checkExistingAuth() {
        try {
            console.log('Welcome: Checking existing authentication...');
            const result = await chrome.storage.local.get(['canvasToken', 'authStatus']);
            
            if (result.canvasToken && result.authStatus === 'authenticated') {
                console.log('Welcome: User already authenticated, redirecting...');
                this.redirectToMainApp();
            }
        } catch (error) {
            console.warn('Welcome: Error checking existing auth:', error);
        }
    }
    showMainApp() {
        // Update badge to show success before redirecting
        chrome.runtime.sendMessage({ 
            type: 'SYNC_STATE_CHANGED', 
            syncState: { status: 'synced', progress: 100, message: 'Authenticated' }
        }).catch(() => {});
        
        console.log('Welcome: Redirecting to main app...');
        chrome.runtime.openOptionsPage();
        window.close();
    }

    async initiateCanvasOAuth() {
        console.log('Welcome: Initiating Canvas OAuth flow...');
        this.showLoading('Connecting to Canvas...');
    
        try {
            // Send message to background script
            const response = await chrome.runtime.sendMessage({ 
                type: 'START_OAUTH_FLOW' 
            });
            
            if (!response || !response.success) {
                throw new Error(response ? response.error : 'Unknown error');
            }
            
            // ✅ Hide loading overlay immediately
            this.hideLoading();
            
            console.log('Welcome: OAuth completed successfully!');
            
            // ✅ Update the progress checks
            this.updateProgressChecks(true);
            
            // ✅ Fetch user profile for personalized message
            let userName = null;
            if (response.token && response.token.access_token) {
                try {
                    const userData = await this.fetchUserProfile(response.token.access_token);
                    userName = userData?.name || null;
                } catch (e) {
                    console.warn('Welcome: Could not fetch user profile:', e);
                }
            }
            
            // ✅ Show success overlay with user name
            this.showSuccessOverlay(userName);
            
            // ✅ Redirect after the progress bar animation completes (~2.5s)
            setTimeout(() => {
                this.fadeOutSuccessOverlay(() => {
                    this.showMainApp();
                });
            }, 2800);
    
        } catch (error) {
            console.error('Welcome: OAuth initiation failed:', error);
            this.hideLoading();
            this.showError('Authentication failed: ' + error.message);
        }
    }
    
    // ✅ Show animated success overlay
    showSuccessOverlay(userName) {
        const overlay = document.getElementById('success-overlay');
        const desc = document.getElementById('success-user-name');
        
        if (desc) {
            desc.textContent = userName 
                ? `Welcome, ${userName}! Your Canvas account is now linked.`
                : 'Your Canvas account is now linked.';
        }
        
        if (overlay) {
            overlay.style.display = 'flex';
            // Trigger reflow for animation
            overlay.offsetHeight;
            overlay.classList.add('active');
        }
    }
    
    // ✅ Fade out success overlay before redirect
    fadeOutSuccessOverlay(callback) {
        const overlay = document.getElementById('success-overlay');
        if (overlay) {
            overlay.classList.add('fade-out');
            setTimeout(() => {
                overlay.classList.remove('active', 'fade-out');
                overlay.style.display = 'none';
                if (callback) callback();
            }, 400);
        } else {
            if (callback) callback();
        }
    }
    // ✅ NEW: Update progress check marks
    updateProgressChecks(canvasConnected) {
        const canvasCheck = document.getElementById('canvas-check');
        if (canvasCheck && canvasConnected) {
            canvasCheck.textContent = '✓';
            canvasCheck.classList.add('completed');
            canvasCheck.style.background = '#9333ea';
            canvasCheck.style.borderColor = '#9333ea';
            canvasCheck.style.color = '#ffffff';
        }
    }

    

    
    async fetchUserProfile(accessToken) {
        try {
            const response = await fetch('https://christchurchschool.instructure.com/api/v1/users/self', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            if (!response.ok) throw new Error('Failed to fetch user profile');
            
            const userData = await response.json();
            
            // Store user info
            await chrome.storage.local.set({
                canvasUser: userData,
                isAuthenticated: true
            });
            
            console.log('User profile fetched:', userData);
            return userData;
            
        } catch (error) {
            console.error('Failed to fetch user profile:', error);
            throw error;
        }
    }
    
    showSuccess(message) {
        // Update UI to show success state
        const statusElement = document.getElementById('auth-status');
        const loginButton = document.getElementById('login-btn');
        
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = 'status-success';
            statusElement.style.display = 'block';
        }
        
        if (loginButton) {
            loginButton.textContent = 'Connected ✓';
            loginButton.disabled = true;
            loginButton.className = 'btn-success';
        }
    }

    listenForOAuthCallback(tabId) {
        // Listen for URL changes in the OAuth tab
        chrome.tabs.onUpdated.addListener(function listener(tabIdUpdated, changeInfo, tab) {
            if (tabIdUpdated === tabId && changeInfo.url) {
                const url = new URL(changeInfo.url);
                
                // Check if this is our OAuth callback
                if (url.pathname.includes('canvas_oauth')) {
                    chrome.tabs.onUpdated.removeListener(listener);
                    this.processOAuthCallback(url);
                }
            }
        }.bind(this));
    }

    async processOAuthCallback(url) {
        try {
            const params = new URLSearchParams(url.search);
            const code = params.get('code');
            const error = params.get('error');

            if (error) {
                throw new Error(`OAuth error: ${error}`);
            }

            if (!code) {
                throw new Error('No authorization code received');
            }

            console.log('Welcome: OAuth code received, exchanging for token...');
            
            // Exchange code for access token
            const tokenData = await this.exchangeCodeForToken(code);
            
            // Store the token
            await this.storeAuthData(tokenData);
            
            // Close the OAuth tab
            chrome.tabs.remove(url.tabId);
            
            // Redirect to main app
            this.redirectToMainApp();

        } catch (error) {
            console.error('Welcome: OAuth callback processing failed:', error);
            this.hideLoading();
            this.showError(`Authentication failed: ${error.message}`);
        }
    }

    
    async storeAuthData(tokenData) {
        const authData = {
            canvasToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            tokenExpiry: Date.now() + (tokenData.expires_in * 1000),
            authStatus: 'authenticated',
            authMethod: 'oauth',
            authenticatedAt: new Date().toISOString()
        };
    
        await chrome.storage.local.set(authData);
        console.log('Welcome: Authentication data stored successfully');
        
        // Trigger initial data sync after authentication
        await this.triggerInitialDataSync();
    }
    
    async triggerInitialDataSync() {
        console.log('Welcome: Triggering initial data sync...');
        this.showLoading('Loading your Canvas data...');
        
        try {
            // Open a Canvas tab to trigger data extraction
            const canvasTab = await chrome.tabs.create({
                url: 'https://christchurchschool.instructure.com',
                active: false
            });
            
            // Wait for data to sync
            setTimeout(async () => {
                await chrome.tabs.remove(canvasTab.id);
                this.hideLoading();
                this.openManualSetup();
            }, 3000);
            
        } catch (error) {
            console.error('Welcome: Failed to trigger data sync:', error);
            this.hideLoading();
            this.redirectToMainApp(); // Redirect anyway
        }
    }

    openManualSetup() {
        console.log('Welcome: Opening manual setup...');
        // Redirect to options page for manual token entry
        chrome.runtime.openOptionsPage();
        window.close();
    }

    openOpenAISetup() {
        console.log('Welcome: Opening OpenAI setup...');
        // Redirect to options page focused on OpenAI setup
        chrome.runtime.openOptionsPage();
        window.close();
    }

    redirectToMainApp() {
        console.log('Welcome: Redirecting to main app...');
        // Close welcome page and open main popup or options
        chrome.runtime.openOptionsPage();
        window.close();
    }

    showPrivacyInfo() {
        alert('Privacy Policy: Your Canvas data is stored locally and never shared. We only access data necessary for the extension functionality.');
    }

    generateStateParameter() {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
    }

    showLoading(message) {
        const overlay = document.getElementById('loading-overlay');
        const spinner = overlay.querySelector('.loading-spinner');
        const text = overlay.querySelector('.loading-text');
        
        // ✅ Reset loading overlay to default state (in case it was in success state before)
        if (spinner) {
            spinner.style.display = '';
        }
        if (text) {
            text.textContent = message;
            text.style.color = '';
        }
        overlay.style.display = 'flex';
    }

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        const spinner = overlay.querySelector('.loading-spinner');
        const text = overlay.querySelector('.loading-text');
        
        // ✅ Reset everything
        overlay.style.display = 'none';
        if (spinner) spinner.style.display = '';
        if (text) {
            text.style.color = '';
            text.innerHTML = '';
        }
    }

    showError(message) {
        alert(`Error: ${message}`);
    }
}


// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new WelcomeAuth();
});