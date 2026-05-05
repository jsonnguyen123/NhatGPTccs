// Canvas AI Assistant - Enhanced Options Script
class CanvasAIOptions {
    constructor() {
        this.settings = {};
        this.isLoading = false;
        this.init();
    }

    async init() {
        try {
            console.log('Options: Starting initialization...');
            
            // Initialize theme manager and apply current theme
            await ThemeManager.init();
            ThemeManager.applyToDocument();
            
            // Listen for theme changes from other parts of extension
            ThemeManager.onThemeChange((theme) => {
                ThemeManager.applyToDocument(theme);
                this.updateThemeUI(theme);
            });

            // Load current settings
            await this.loadSettings();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Update UI with current settings
            this.updateUI();

            await this.checkBlackbaudStatus();
            await this.checkGmailStatus();

            if (this.settings.canvasToken && this.settings.authStatus !== 'authenticated') {
                console.log('Options: Token found but not authenticated. Auto-validating...');
                const isValid = await this.validateCanvasToken(this.settings.canvasToken);
                if (isValid) {
                    // Update local setting so the UI updates correctly below
                    this.settings.authStatus = 'authenticated';
                    await chrome.storage.local.set({ authStatus: 'authenticated' });
                }
            }
            
            // Load authentication status (NO sync triggered here anymore)
            await this.loadAuthStatus();
            
            console.log('Canvas AI Assistant: Options page initialized successfully');
            
        } catch (error) {
            console.error('Canvas AI Assistant: Options initialization failed:', error);
            this.showError('Failed to initialize options page: ' + error.message);
        }
    }

    async checkBlackbaudStatus() {
        try {
            console.log('Options: Checking Blackbaud connection status...');
            // 🛡️ FIX #4: Check auth status, NOT subscription key presence
            const local = await chrome.storage.local.get(['bb_auth_status', 'bb_refresh_token']);
            const session = await chrome.storage.session.get(['bb_access_token']);
            
            const isConnected = !!(
                local.bb_auth_status === 'authenticated' && 
                (session.bb_access_token || local.bb_refresh_token)
            );
            this.updateBlackbaudUI(isConnected);
            
            return isConnected;
        } catch (error) {
            console.error('Options: Failed to check Blackbaud status:', error);
            this.updateBlackbaudUI(false);
            return false;
        }
    }

    async loadSettings() {
        try {
            console.log('Options: Loading settings...');
            const result = await chrome.storage.local.get([
                'canvasToken',
                'apiKey',
                'autoSync',
                'notifications',
                'theme',
                'compactMode',
                'authStatus',
                'bb_auth_status',
                'gmailConnected',
                'gmailEmail',
                'gmailSenderDomains',
                'gmailDaysBack',
                'gmailMaxResults'
            ]);
            const isBlackbaudConnected = result.bb_auth_status === 'authenticated';
            this.updateBlackbaudUI(isBlackbaudConnected);

            console.log('Options: Settings loaded:', {
                hasCanvasToken: !!result.canvasToken,
                hasApiKey: !!result.apiKey,
                authStatus: result.authStatus,
                theme: result.theme,
                compactMode: result.compactMode,
                gmailConnected: result.gmailConnected || false
            });
            
        } catch (error) {
            console.error('Options: Failed to load settings:', error);
            this.settings = {};
        }
    }

    setupEventListeners() {
        console.log('Options: Setting up event listeners...');
        
        try {
            // Save Settings button
            const saveBtn = document.getElementById('save-settings');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => this.saveSettings());
                console.log('Options: Save button listener attached');
            } else {
                console.error('Options: Save button not found!');
            }

            // Reset Settings button
            const resetBtn = document.getElementById('reset-settings');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => this.resetSettings());
                console.log('Options: Reset button listener attached');
            }

            // Test Canvas Token button
            const testCanvasBtn = document.getElementById('test-canvas-token');
            if (testCanvasBtn) {
                testCanvasBtn.addEventListener('click', () => this.testCanvasToken());
                console.log('Options: Test Canvas button listener attached');
            }

            // Guide buttons
            const showCanvasGuide = document.getElementById('show-canvas-guide');
            if (showCanvasGuide) {
                showCanvasGuide.addEventListener('click', () => this.showCanvasGuide());
            }

            const showOpenAIGuide = document.getElementById('show-openai-guide');
            if (showOpenAIGuide) {
                showOpenAIGuide.addEventListener('click', () => this.showOpenAIGuide());
            }

            // ─── GMAIL EVENT LISTENERS ───────────────────────────────
            const connectGmail = document.getElementById('connect-gmail');
            if (connectGmail) {
                connectGmail.addEventListener('click', () => this.handleGmailConnect());
                console.log('Options: Gmail connect button listener attached');
            }

            const disconnectGmail = document.getElementById('disconnect-gmail');
            if (disconnectGmail) {
                disconnectGmail.addEventListener('click', () => this.handleGmailDisconnect());
                console.log('Options: Gmail disconnect button listener attached');
            }

            const gmailClearCache = document.getElementById('gmail-clear-cache');
            if (gmailClearCache) {
                gmailClearCache.addEventListener('click', () => this.handleGmailClearCache());
            }

            const gmailTestFetch = document.getElementById('gmail-test-fetch');
            if (gmailTestFetch) {
                gmailTestFetch.addEventListener('click', () => this.handleGmailTestFetch());
            }

            // Setup Guide buttons - Open in new tabs
            const showCanvasGuideBtn = document.getElementById('show-canvas-guide-btn');
            if (showCanvasGuideBtn) {
                showCanvasGuideBtn.addEventListener('click', () => {
                    chrome.tabs.create({ url: chrome.runtime.getURL('guide-canvas-token.html') });
                });
                console.log('Options: Canvas guide button listener attached');
            }

            const showOpenAIGuideBtn = document.getElementById('show-openai-guide-btn');
            if (showOpenAIGuideBtn) {
                showOpenAIGuideBtn.addEventListener('click', () => {
                    chrome.tabs.create({ url: chrome.runtime.getURL('guide-blackbaud-token.html') });
                });
                console.log('Options: Blackbaud guide button listener attached');
            }

            const showTroubleshooting = document.getElementById('show-troubleshooting');
            if (showTroubleshooting) {
                showTroubleshooting.addEventListener('click', () => {
                    chrome.tabs.create({ url: chrome.runtime.getURL('guide-troubleshooting.html') });
                });
                console.log('Options: Troubleshooting guide button listener attached');
            }

            // Support & Documentation links
            const fullDocsLink = document.getElementById('full-docs-link');
            if (fullDocsLink) {
                fullDocsLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    chrome.tabs.create({ url: chrome.runtime.getURL('docs-hub.html') });
                });
                console.log('Options: Full docs link listener attached');
            }

            const reportIssueLink = document.getElementById('report-issue-link');
            if (reportIssueLink) {
                reportIssueLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    chrome.tabs.create({ url: chrome.runtime.getURL('report-issue.html') });
                });
                console.log('Options: Report issue link listener attached');
            }

            const communityForumLink = document.getElementById('community-forum-link');
            if (communityForumLink) {
                communityForumLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showComingSoonPopup();
                });
                console.log('Options: Community forum link listener attached');
            }

            // Toggle switches
            const autoSync = document.getElementById('auto-sync');
            if (autoSync) {
                autoSync.addEventListener('change', (e) => {
                    this.settings.autoSync = e.target.checked;
                });
            }

            const notifications = document.getElementById('notifications');
            if (notifications) {
                notifications.addEventListener('change', (e) => {
                    this.settings.notifications = e.target.checked;
                });
            }

            // Compact mode toggle
            const compactMode = document.getElementById('compact-mode');
            if (compactMode) {
                compactMode.addEventListener('change', (e) => {
                    this.settings.compactMode = e.target.checked;
                    console.log('Options: Compact mode changed to:', e.target.checked);
                });
            }

            // Theme selector - Radio buttons
            const themeRadios = document.querySelectorAll('input[name="theme"]');
            if (themeRadios.length > 0) {
                themeRadios.forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            this.handleThemeChange(e.target.value);
                        }
                    });
                });
                console.log('Options: Theme radio listeners attached');
            }
            
            const providerSelect = document.getElementById('ai-provider');
            if (providerSelect) {
                providerSelect.addEventListener('change', (e) => this.handleProviderChange(e.target.value));
            }

            const connectBB = document.getElementById('connect-blackbaud');
            if (connectBB) {
                connectBB.addEventListener('click', () => this.handleBlackbaudConnect());
            }

            const disconnectBB = document.getElementById('disconnect-blackbaud');
            if (disconnectBB) {
                disconnectBB.addEventListener('click', () => this.handleBlackbaudDisconnect());
            }

            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    const section = item.dataset.section;
                    this.switchSection(section);
                });
            });
            console.log('Options: All event listeners attached successfully');
            
        } catch (error) {
            console.error('Options: Error setting up event listeners:', error);
        }
    }

    showComingSoonPopup() {
        this.showPopup(
            'The Community Forum feature is not available yet. Stay tuned for updates!', 
            'info', 
            'Coming Soon'
        );
    }

    updateThemeUI(theme) {
        // Update the radio button selection
        const themeRadio = document.querySelector(`input[name="theme"][value="${theme}"]`);
        if (themeRadio) {
            themeRadio.checked = true;
        }
    }

    handleThemeChange(theme) {
        console.log('Options: Theme changed to:', theme);
        this.settings.theme = theme;
        
        // Apply theme preview immediately
        ThemeManager.applyToDocument(theme);
        
        // Show feedback to user
        this.showToast(`Theme set to "${ThemeManager.getThemeName(theme)}". Save settings to apply permanently.`, 'info');
    }

    getThemeDisplayName(theme) {
        const names = {
            'canvas': 'Canvas (Default)',
            'dark': 'Dark Mode',
            'light': 'Light Mode'
        };
        return names[theme] || theme;
    }

    applyThemePreview(theme) {
        // Optional: Apply a subtle preview effect to show the theme is selected
        // This doesn't change the actual theme yet - that happens on save
        console.log('Options: Previewing theme:', theme);
        
        // You could add a class to body for live preview if desired
        document.body.setAttribute('data-theme-preview', theme);
    }

    switchSection(sectionName) {
        // Hide all sections
        document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        
        // Show selected section
        const section = document.getElementById(sectionName);
        if (section) {
            section.classList.add('active');
            event.target.closest('.nav-item').classList.add('active');
            
            // Update header
            const titleMap = {
                authentication: 'Authentication Setup',
                features: 'Features & Sync',
                appearance: 'Appearance',
                help: 'Help & Guides'
            };
            document.getElementById('section-title').textContent = titleMap[sectionName] || 'Settings';
        }
    }

    updateUI() {
        console.log('Options: Updating UI with current settings...');
        
        try {
            // Update input fields
            const canvasTokenInput = document.getElementById('canvas-token-input');
            if (canvasTokenInput && this.settings.canvasToken) {
                canvasTokenInput.value = this.settings.canvasToken;
            }

            // Update toggle switches
            const autoSync = document.getElementById('auto-sync');
            if (autoSync) {
                autoSync.checked = this.settings.autoSync || false;
            }

            const notifications = document.getElementById('notifications');
            if (notifications) {
                notifications.checked = this.settings.notifications !== false;
            }

            // ─── GMAIL SETTINGS UI ───────────────────────────────────
            const gmailDomains = document.getElementById('gmail-sender-domains');
            if (gmailDomains && this.settings.gmailSenderDomains) {
                gmailDomains.value = Array.isArray(this.settings.gmailSenderDomains) 
                    ? this.settings.gmailSenderDomains.join(', ') 
                    : this.settings.gmailSenderDomains;
            }

            const gmailDaysBack = document.getElementById('gmail-days-back');
            if (gmailDaysBack && this.settings.gmailDaysBack) {
                gmailDaysBack.value = this.settings.gmailDaysBack.toString();
            }

            const gmailMaxResults = document.getElementById('gmail-max-results');
            if (gmailMaxResults && this.settings.gmailMaxResults) {
                gmailMaxResults.value = this.settings.gmailMaxResults.toString();
            }
            // __________________________________________________________

            // Update compact mode toggle
            const compactMode = document.getElementById('compact-mode');
            if (compactMode) {
                compactMode.checked = this.settings.compactMode || false;
            }

            // Update theme selector (radio buttons)
            const currentTheme = this.settings.theme || 'canvas';
            const themeRadio = document.querySelector(`input[name="theme"][value="${currentTheme}"]`);
            if (themeRadio) {
                themeRadio.checked = true;
                console.log('Options: Theme radio set to:', currentTheme);
            }

            console.log('Options: UI updated successfully');
            
        } catch (error) {
            console.error('Options: Error updating UI:', error);
        }
    }

    async loadAuthStatus() {
        try {
            console.log('Options: Loading auth status...');
            
            const response = await chrome.runtime.sendMessage({
                type: 'GET_AUTH_STATUS'
            });
    
            if (response && response.authStatus) {
                this.updateAuthStatus(response.authStatus);
                // REMOVED: No longer triggers sync here
                // Sync only happens when Canvas tab is reloaded
            }
            
        } catch (error) {
            console.error('Options: Failed to load auth status:', error);
        }
    }

    // REMOVED: triggerInitialSync() method - no longer needed from options page

    updateAuthStatus(authStatus) {
        console.log('Options: Updating auth status:', authStatus);
        
        try {
            const canvasStatus = document.getElementById('canvas-token-status');
            const canvasBadge = document.getElementById('canvas-status-badge');

            if (canvasStatus) {
                if (authStatus.hasCanvasToken) {
                    canvasStatus.textContent = '✅ Configured';
                    canvasStatus.className = 'status-value success';
                } else {
                    canvasStatus.textContent = '❌ Not configured';
                    canvasStatus.className = 'status-value error';
                }
            }

            if (canvasBadge) {
                if (authStatus.hasCanvasToken && authStatus.isAuthenticated) {
                    canvasBadge.textContent = '✅ Connected';
                    canvasBadge.className = 'status-badge success';
                } else if (authStatus.hasCanvasToken) {
                    canvasBadge.textContent = '⚠️ Token saved';
                    canvasBadge.className = 'status-badge warning';
                } else {
                    canvasBadge.textContent = 'Not configured';
                    canvasBadge.className = 'status-badge';
                }
            }
            
        } catch (error) {
            console.error('Options: Error updating auth status:', error);
        }
    }

    async saveSettings() {
        console.log('Options: Saving settings...');
        this.showLoading('Saving settings...');
    
        try {
            // ─── GMAIL SETTINGS ──────────────────────────────────────
            const gmailDomainsInput = document.getElementById('gmail-sender-domains');
            const gmailDaysBackSelect = document.getElementById('gmail-days-back');
            const gmailMaxResultsSelect = document.getElementById('gmail-max-results');

            const gmailSenderDomains = gmailDomainsInput 
                ? gmailDomainsInput.value.split(',').map(d => d.trim()).filter(d => d.length > 0)
                : ['christchurchschool.org'];
            const gmailDaysBack = gmailDaysBackSelect ? parseInt(gmailDaysBackSelect.value) : 7;
            const gmailMaxResults = gmailMaxResultsSelect ? parseInt(gmailMaxResultsSelect.value) : 15;

            // Get current values from inputs
            const canvasTokenInput = document.getElementById('canvas-token-input');
            let canvasToken = null;
            let newAuthStatus = this.settings.authStatus || 'unauthenticated';
    
            // 1. Handle Canvas Token Logic
            if (canvasTokenInput) {
                canvasToken = canvasTokenInput.value.trim();
                
                if (canvasToken && (canvasToken !== this.settings.canvasToken || newAuthStatus !== 'authenticated')) {
                    console.log('Options: Validating new/existing Canvas token...');
                    await chrome.storage.local.set({ canvasToken: canvasToken });
                    
                    if (await this.validateCanvasToken(canvasToken)) {
                        newAuthStatus = 'authenticated';
                    } else {
                        newAuthStatus = 'unauthenticated';
                    }
                } else if (!canvasToken) {
                    canvasToken = '';
                    newAuthStatus = 'unauthenticated';
                }
            }

            // 2. Get theme from radio buttons
            const selectedTheme = document.querySelector('input[name="theme"]:checked');
            const theme = selectedTheme ? selectedTheme.value : (this.settings.theme || 'canvas');
            await ThemeManager.setTheme(theme);
            
            // 3. Get compact mode
            const compactModeCheckbox = document.getElementById('compact-mode');
            const compactMode = compactModeCheckbox ? compactModeCheckbox.checked : false;
            
            // 4. Save ALL Settings
            const settingsToSave = {
                canvasToken: canvasToken,
                authStatus: newAuthStatus,
                autoSync: this.settings.autoSync || false,
                notifications: this.settings.notifications !== false,
                theme: theme,
                compactMode: compactMode,
                aiConfig: this.settings.aiConfig,
                gmailSenderDomains: gmailSenderDomains,
                gmailDaysBack: gmailDaysBack,
                gmailMaxResults: gmailMaxResults
            };
            
            await chrome.storage.local.set(settingsToSave);
            this.settings = { ...this.settings, ...settingsToSave };

            console.log('Options: Settings saved:', {
                theme, compactMode,
                gmailSenderDomains, gmailDaysBack, gmailMaxResults
            });
    
            await this.loadAuthStatus();
            
            if (newAuthStatus === 'authenticated') {
                this.showSuccess('Settings saved! Reload any Canvas tab to sync data.');
            } else {
                this.showSuccess('Settings saved successfully!');
            }
            
            chrome.runtime.sendMessage({
                type: 'SETTINGS_UPDATED',
                settings: settingsToSave
            }).catch(() => {});
            
        } catch (error) {
            console.error('Options: Failed to save settings:', error);
            this.showError('Failed to save settings: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    updateBlackbaudUI(isConnected) {
        const connectBtn = document.getElementById('connect-blackbaud');
        const disconnectBtn = document.getElementById('disconnect-blackbaud');
        const badge = document.getElementById('bb-status-badge');
        const statusText = document.getElementById('blackbaud-status-text');
        const connectionState = document.getElementById('bb-connection-state');

        if (isConnected) {
            // Connected State
            if (connectBtn) connectBtn.style.display = 'none';
            if (disconnectBtn) disconnectBtn.style.display = 'block';
            
            if (badge) {
                badge.textContent = '✅ Connected';
                badge.className = 'status-badge success';
            }
            if (statusText) {
                statusText.textContent = 'Active';
                statusText.className = 'status-value success';
            }
            if (connectionState) {
                connectionState.innerHTML = `
                    <div class="status-icon">✅</div>
                    <span class="status-text">Blackbaud account connected</span>
                `;
            }
        } else {
            // Disconnected State
            if (connectBtn) connectBtn.style.display = 'block';
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            
            if (badge) {
                badge.textContent = '❌ Not Connected';
                badge.className = 'status-badge error';
            }
            if (statusText) {
                statusText.textContent = 'Not configured';
                statusText.className = 'status-value error';
            }
            if (connectionState) {
                connectionState.innerHTML = `
                    <div class="status-icon">🔗</div>
                    <span class="status-text">Click below to connect your Blackbaud account.</span>
                `;
            }
        }
    }

    // ─── GMAIL METHODS ───────────────────────────────────────────────

    async checkGmailStatus() {
        try {
            console.log('Options: Checking Gmail connection status...');
            const response = await chrome.runtime.sendMessage({ type: 'GMAIL_CHECK_CONNECTION' });
            
            const isConnected = response?.connected || false;
            const email = response?.email || null;
            
            this.updateGmailUI(isConnected, email);
            return isConnected;
        } catch (error) {
            console.error('Options: Failed to check Gmail status:', error);
            this.updateGmailUI(false, null);
            return false;
        }
    }

    updateGmailUI(isConnected, email = null) {
        const connectBtn = document.getElementById('connect-gmail');
        const disconnectBtn = document.getElementById('disconnect-gmail');
        const badge = document.getElementById('gmail-status-badge');
        const connectionState = document.getElementById('gmail-connection-state');
        const emailDisplay = document.getElementById('gmail-email-display');
        const statusText = document.getElementById('gmail-status-text');
        const settingsCard = document.getElementById('gmail-settings-card');

        if (isConnected) {
            if (connectBtn) connectBtn.style.display = 'none';
            if (disconnectBtn) disconnectBtn.style.display = 'block';
            
            if (badge) {
                badge.textContent = '✅ Connected';
                badge.className = 'status-badge success';
            }
            if (statusText) {
                statusText.textContent = email || 'Connected';
                statusText.className = 'status-value success';
            }
            if (connectionState) {
                connectionState.innerHTML = `
                    <div class="status-icon-large">✅</div>
                    <div class="status-details">
                        <span class="status-text">Gmail account connected</span>
                        <span class="status-subtext" id="gmail-email-display">${email || 'School email linked'}</span>
                    </div>
                `;
            }
            // Show email settings when connected
            if (settingsCard) settingsCard.style.display = 'block';
        } else {
            if (connectBtn) connectBtn.style.display = 'block';
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            
            if (badge) {
                badge.textContent = '❌ Not Connected';
                badge.className = 'status-badge error';
            }
            if (statusText) {
                statusText.textContent = 'Not connected';
                statusText.className = 'status-value error';
            }
            if (connectionState) {
                connectionState.innerHTML = `
                    <div class="status-icon-large">📧</div>
                    <div class="status-details">
                        <span class="status-text">Connect your school Gmail (This feature is still under development)</span>
                        <span class="status-subtext">View school emails directly in the assistant</span>
                    </div>
                `;
            }
            // Dim email settings when disconnected
            if (settingsCard) {
                settingsCard.style.display = 'block';
                settingsCard.style.opacity = '0.6';
            }
        }
    }

    async handleGmailConnect() {
        this.showLoading('Connecting to Gmail...');
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GMAIL_CONNECT' });

            if (response && response.success) {
                this.showSuccess(`Gmail connected: ${response.email}`);
                this.updateGmailUI(true, response.email);
            } else {
                this.showError('Gmail connection failed: ' + (response?.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Options: Gmail connect error:', error);
            this.showError('Gmail connection error: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    async handleGmailDisconnect() {
        if (!confirm('Are you sure you want to disconnect Gmail? You won\'t see school emails in the assistant anymore.')) {
            return;
        }

        this.showLoading('Disconnecting Gmail...');
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GMAIL_DISCONNECT' });

            if (response && response.success) {
                this.showSuccess('Gmail disconnected.');
                this.updateGmailUI(false, null);
            } else {
                this.showError('Disconnect failed: ' + (response?.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Options: Gmail disconnect error:', error);
            this.showError('Gmail disconnect error: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    async handleGmailClearCache() {
        try {
            await chrome.runtime.sendMessage({ type: 'GMAIL_CLEAR_CACHE' });
            this.showToast('Email cache cleared. Next fetch will pull fresh data.', 'success');
        } catch (error) {
            this.showError('Failed to clear cache: ' + error.message);
        }
    }

    async handleGmailTestFetch() {
        // Save current gmail settings first
        const domainsInput = document.getElementById('gmail-sender-domains');
        const daysBackSelect = document.getElementById('gmail-days-back');
        const maxResultsSelect = document.getElementById('gmail-max-results');

        const domains = domainsInput 
            ? domainsInput.value.split(',').map(d => d.trim()).filter(d => d.length > 0)
            : ['christchurchschool.org'];
        const daysBack = daysBackSelect ? parseInt(daysBackSelect.value) : 7;
        const maxResults = maxResultsSelect ? parseInt(maxResultsSelect.value) : 15;

        // Save settings so the fetch uses them
        await chrome.storage.local.set({
            gmailSenderDomains: domains,
            gmailDaysBack: daysBack,
            gmailMaxResults: maxResults
        });

        // Clear cache to force fresh fetch
        await chrome.runtime.sendMessage({ type: 'GMAIL_CLEAR_CACHE' });

        this.showLoading('Fetching school emails...');
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS' });

            if (response && response.success) {
                const count = response.emails?.length || 0;
                if (count > 0) {
                    const subjects = response.emails.slice(0, 3).map(e => `• ${e.subject || '(No Subject)'}`).join('\n');
                    this.showSuccess(`Found ${count} school emails!\n\nRecent:\n${subjects}`);
                } else {
                    this.showWarning(`No emails found from ${domains.join(', ')} in the last ${daysBack} days. Check your domain settings.`);
                }
            } else {
                this.showError('Fetch failed: ' + (response?.error || 'Unknown error'));
            }
        } catch (error) {
            this.showError('Email fetch error: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    async handleBlackbaudConnect() {
        this.showLoading('Connecting to Blackbaud...');
        try {
            const response = await chrome.runtime.sendMessage({ 
                type: 'START_BLACKBAUD_OAUTH' 
            });

            if (response && response.success) {
                this.showSuccess('Blackbaud connected! Reload Canvas tab to sync schedule data.');
                this.updateBlackbaudUI(true);
            } else {
                this.showError('Connection failed: ' + (response?.error || 'Unknown error'));
                this.updateBlackbaudUI(false);
            }
        } catch (error) {
            this.showError('Connection error: ' + error.message);
            this.updateBlackbaudUI(false);
        } finally {
            this.hideLoading();
        }
    }

    async handleBlackbaudDisconnect() {
        if (confirm("Are you sure you want to disconnect Blackbaud? You will lose access to schedule data.")) {
            // 🛡️ FIX #4: Clean up — no subscription key to remove anymore
            await chrome.storage.local.remove([
                'bb_refresh_token', 
                'bb_auth_status', 
                'bb_auth_timestamp'
            ]);
            await chrome.storage.session.remove([
                'bb_access_token', 
                'bb_token_expiry'
            ]);
            this.updateBlackbaudUI(false);
            this.showSuccess('Blackbaud disconnected successfully');
        }
    }
    

    async validateCanvasToken(token) {
        if (!token || token.trim() === '') {
            return false;
        }
        
        try {
            console.log('Options: Validating Canvas token...');
            const response = await chrome.runtime.sendMessage({
                type: 'VALIDATE_CANVAS_TOKEN',
                token: token
            });
            
            console.log('Options: Token validation result:', response);
            return response && response.success;
            
        } catch (error) {
            console.error('Options: Token validation failed:', error);
            return false;
        }
    }

    async testCanvasToken() {
        console.log('Options: Testing Canvas token...');
        
        const tokenInput = document.getElementById('canvas-token-input');
        const token = tokenInput?.value.trim();
        
        if (!token) {
            this.showError('Please enter a Canvas token to test');
            return;
        }
        
        this.showLoading('Testing Canvas token...');
        
        try {
            const isValid = await this.validateCanvasToken(token);
            
            if (isValid) {
                this.showSuccess('Canvas token is valid! Reload Canvas tab to sync data.');
                tokenInput.style.borderColor = '#28a745';
                
                // Auto-save the valid token but NO sync
                await chrome.storage.local.set({ 
                    canvasToken: token,
                    authStatus: 'authenticated'
                });
                console.log('Options: Valid token auto-saved with authenticated status');
                
                // Update auth status display
                await this.loadAuthStatus();
                
            } else {
                this.showError('Canvas token is invalid or cannot be verified.');
                tokenInput.style.borderColor = '#dc3545';
                
                await chrome.storage.local.set({ 
                    authStatus: 'unauthenticated'
                });
            }
        } catch (error) {
            console.error('Options: Token test failed:', error);
            this.showError('Failed to test Canvas token. Please check your connection.');
            tokenInput.style.borderColor = '#dc3545';
        } finally {
            this.hideLoading();
        }
    }

    async resetSettings() {
        console.log('Options: Resetting settings...');
        
        if (confirm('Are you sure you want to reset all settings to defaults? This will clear your API keys and authentication.')) {
            this.showLoading('Resetting settings...');

            try {
                await chrome.storage.local.set({
                    canvasToken: '',
                    autoSync: false,
                    notifications: true,
                    theme: 'canvas',
                    authStatus: 'unauthenticated',
                    firstInstall: false
                });
                
                window.location.reload();
                
            } catch (error) {
                console.error('Options: Failed to reset settings:', error);
                this.showError('Failed to reset settings: ' + error.message);
                this.hideLoading();
            }
        }
    }

    showCanvasGuide() {
        console.log('Options: Showing Canvas guide');
        this.showInfo('Canvas guide would open here. This feature is under development.');
    }

    showOpenAIGuide() {
        console.log('Options: Showing OpenAI guide');
        this.showInfo('AI setup guide would open here. This feature is under development.');
    }

    handleProviderChange(provider) {
        console.log('Options: AI provider changed to:', provider);
        this.settings.aiProvider = provider;
    }

    // Utility methods
    showLoading(message) {
        this.isLoading = true;
        const overlay = document.getElementById('loading-overlay');
        const text = overlay?.querySelector('.loading-text');
        if (text) text.textContent = message;
        if (overlay) overlay.style.display = 'flex';
    }

    hideLoading() {
        this.isLoading = false;
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    showPopup(message, type = 'info', title = null) {
        const overlay = document.getElementById('notification-overlay');
        const popup = overlay?.querySelector('.notification-popup');
        const iconEl = document.getElementById('notification-icon');
        const titleEl = document.getElementById('notification-title');
        const messageEl = document.getElementById('notification-message');
        const progressEl = document.getElementById('notification-progress');
        const closeBtn = document.getElementById('notification-close');
        
        if (!overlay || !popup) {
            alert(message);
            return;
        }
        
        const config = {
            success: { icon: '✓', title: title || 'Success!', class: 'success' },
            error: { icon: '✕', title: title || 'Error', class: 'error' },
            warning: { icon: '⚠', title: title || 'Warning', class: 'warning' },
            info: { icon: 'ℹ', title: title || 'Info', class: 'info' }
        };
        
        const cfg = config[type] || config.info;
        
        popup.className = 'notification-popup ' + cfg.class;
        
        iconEl.textContent = cfg.icon;
        titleEl.textContent = cfg.title;
        messageEl.textContent = message;
        
        progressEl.style.animation = 'none';
        progressEl.offsetHeight;
        progressEl.style.animation = 'progress-shrink 4s linear forwards';
        
        overlay.classList.add('active');
        
        const autoCloseTimer = setTimeout(() => {
            this.hidePopup();
        }, 4000);
        
        const closeHandler = () => {
            clearTimeout(autoCloseTimer);
            this.hidePopup();
        };
        
        closeBtn.onclick = closeHandler;
        
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                closeHandler();
            }
        };
        
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeHandler();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }
    
    hidePopup() {
        const overlay = document.getElementById('notification-overlay');
        if (overlay) {
            overlay.classList.add('fade-out');
            setTimeout(() => {
                overlay.classList.remove('active', 'fade-out');
            }, 300);
        }
    }
    
    showToast(message, type = 'info', title = null) {
        const container = document.getElementById('toast-container');
        if (!container) {
            console.warn('Toast container not found');
            return;
        }
        
        const config = {
            success: { icon: '✓', title: title || 'Success' },
            error: { icon: '✕', title: title || 'Error' },
            warning: { icon: '⚠', title: title || 'Warning' },
            info: { icon: 'ℹ', title: title || 'Info' }
        };
        
        const cfg = config[type] || config.info;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-icon">${cfg.icon}</div>
            <div class="toast-content">
                <div class="toast-title">${cfg.title}</div>
                <p class="toast-message">${message}</p>
            </div>
            <button class="toast-close">×</button>
        `;
        
        container.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        const closeToast = () => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 400);
        };
        
        toast.querySelector('.toast-close').onclick = closeToast;
        
        setTimeout(closeToast, 5000);
    }
    
    showSuccess(message) {
        this.showPopup(message, 'success');
    }

    showError(message) {
        this.showPopup(message, 'error');
    }

    showWarning(message) {
        this.showPopup(message, 'warning');
    }

    showInfo(message) {
        this.showToast(message, 'info');
    }

    showMessage(message, type = 'info') {
        if (type === 'success' || type === 'error') {
            this.showPopup(message, type);
        } else {
            this.showToast(message, type);
        }
    }
}

// Initialize options when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Options: DOM loaded, initializing...');
    new CanvasAIOptions();
});

window.addEventListener('error', (event) => {
    console.error('Options: Uncaught error:', event.error);
});