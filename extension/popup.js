// Canvas AI Assistant - Popup Script (DEBUGGED VERSION)
class CanvasAIPopup {
    constructor() {
        this.isLoading = false;
        this.canvasData = null;
        this.currentTab = null;
        this.init();
    }

    async init() {
        try {
            
            console.log('Popup: Starting initialization...');
            const isAuthenticated = await this.checkAuthentication();
            console.log('Popup: check user authentication');
            
            if (!isAuthenticated) {
                console.log('Popup: User not authenticated, stopping initialization');
                return; 
            }

            // Get current tab first
            await this.getCurrentTab();
            console.log('Popup: Current tab:', this.currentTab?.url);
            
            // Set up event listeners
            this.setupEventListeners();
            console.log('Popup: Event listeners set up');
            
            // Load extension status
            await this.loadExtensionStatus();
            console.log('Popup: Extension status loaded');
            
            // Load canvas data
            await this.loadCanvasData();
            console.log('Popup: Canvas data loaded');
            
            // Update UI
            this.updateUI();
            console.log('Popup: UI updated');
            
            console.log('Canvas AI Assistant: Popup initialized successfully');
            
        } catch (error) {
            console.error('Canvas AI Assistant: Popup initialization failed:', error);
            this.showError('Failed to initialize popup: ' + error.message);
        }
    }
    
    async checkAuthentication() {
        try {
            console.log('Popup: Checking authentication status...');
            const response = await chrome.runtime.sendMessage({
                type: 'GET_AUTH_STATUS'
            });
    
            console.log('Popup: Auth status response:', response);
            
            if (response && response.authStatus) {
                const isAuthenticated = response.authStatus.isAuthenticated;
                console.log('Popup: User authenticated:', isAuthenticated);
                
                if (!isAuthenticated) {
                    console.log('Popup: User not authenticated, showing welcome page');
                    this.showUnauthenticatedUI();
                    return false;
                }
                return true;
            }
            
            console.log('Popup: No auth status in response');
            return false;
            
        } catch (error) {
            console.error('Popup: Error checking authentication:', error);
            this.showUnauthenticatedUI();
            return false;
        }
    }
    
    showUnauthenticatedUI() {
        // Disable main features
        const openChatbotBtn = document.getElementById('open-chatbot');
        const refreshDataBtn = document.getElementById('refresh-data');
        
        if (openChatbotBtn) openChatbotBtn.disabled = true;
        if (refreshDataBtn) refreshDataBtn.disabled = true;
        
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome.html')
        });
    }

    async getCurrentTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTab = tab;
            console.log('Popup: Current tab found:', tab?.url);
        } catch (error) {
            console.warn('Canvas AI Assistant: Could not get current tab:', error);
            this.currentTab = null;
        }
    }

    setupEventListeners() {
        try {
            // REFRESH BUTTON — Only way to manually trigger sync
            const refreshBtn = document.getElementById('refresh-data');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.handleRefreshClick());
            } else {
                console.error('Can not refresh page');
            }
            // Open Chatbot button
            const openChatbotBtn = document.getElementById('open-chatbot');
            if (openChatbotBtn) {
                openChatbotBtn.addEventListener('click', () => {
                    console.log('Open Chatbot button clicked');
                    this.openChatbot();
                });
            } else {
                console.error('Open Chatbot button not found!');
            }

            // Settings button
            const settingsBtn = document.getElementById('open-settings');
            if (settingsBtn) {
                settingsBtn.addEventListener('click', () => {
                    console.log('Settings button clicked');
                    this.openSettings();
                });
            } else {
                console.error('Settings button not found!');
            }

            // Help link
            const helpLink = document.getElementById('help-link');
            if (helpLink) {
                helpLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    chrome.runtime.openOptionsPage();
                });
            }

            // Docs link
            const docsLink = document.getElementById('docs-link');
            if (docsLink) {
                docsLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    chrome.tabs.create({
                        url: 'https://github.com/your-repo/docs'
                    });
                });
            }

            console.log('Popup: All event listeners attached successfully');
            
        } catch (error) {
            console.error('Popup: Error setting up event listeners:', error);
        }
    }
    async handleRefreshClick() {
        const refreshBtn = document.getElementById('refresh-data');
        const dataStatus = document.getElementById('data-status');
        
        // Disable button and show syncing state
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.querySelector('.btn-icon').textContent = '⏳';
            refreshBtn.querySelector('.btn-text').textContent = 'Syncing...';
        }
        if (dataStatus) {
            dataStatus.textContent = 'Syncing...';
            dataStatus.className = 'status-value warning';
        }

        try {
            const syncResult = await chrome.runtime.sendMessage({
                type: 'TRIGGER_MANUAL_SYNC'
            });

            if (syncResult?.success) {
                this.showSuccess('✅ Data synced successfully!');
                if (dataStatus) {
                    dataStatus.textContent = 'Just now';
                    dataStatus.className = 'status-value success';
                }
                // Reload popup stats with fresh data
                await this.loadCachedData();

            } else if (syncResult?.needsReauth || syncResult?.authError) {
                // 🔄 Token expired — prompt re-authentication
                console.warn('Popup: Token expired, prompting re-auth');
                
                if (dataStatus) {
                    dataStatus.textContent = 'Expired';
                    dataStatus.className = 'status-value error';
                }

                // Update canvas status card too
                const canvasStatus = document.getElementById('canvas-status');
                if (canvasStatus) {
                    canvasStatus.textContent = 'Expired';
                    canvasStatus.className = 'status-value error';
                }

                // Update status dot
                const statusDot = document.querySelector('.status-dot');
                const statusLabel = document.querySelector('.status-label');
                if (statusDot) statusDot.className = 'status-dot error';
                if (statusLabel) statusLabel.textContent = 'Expired';

                this.showReauthPrompt();

            } else {
                throw new Error(syncResult?.error || 'Sync failed');
            }

        } catch (error) {
            console.error('Popup: Sync failed:', error);
            this.showError(`❌ Sync failed: ${error.message}`);
            if (dataStatus) {
                dataStatus.textContent = 'Error';
                dataStatus.className = 'status-value error';
            }
        } finally {
            // Re-enable button
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.querySelector('.btn-icon').textContent = '🔄';
                refreshBtn.querySelector('.btn-text').textContent = 'Refresh';
            }
        }
    }

    // 🔄 Show re-authentication prompt when token expires
    showReauthPrompt() {
        const toastContainer = document.getElementById('toast-container');

        const toast = document.createElement('div');
        toast.className = 'toast error';
        toast.style.cssText = 'flex-direction: column; align-items: flex-start; gap: 8px; max-width: 350px;';
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">🔑</span>
                <span style="font-weight: 600; color: var(--text-primary);">Session Expired</span>
            </div>
            <span style="font-size: 12px; color: var(--text-secondary);">
                Your Canvas token has expired. Please re-authenticate to continue syncing.
            </span>
            <div style="display: flex; gap: 8px; margin-top: 4px;">
                <button id="reauth-btn" style="
                    padding: 6px 16px;
                    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
                    border: none;
                    border-radius: 8px;
                    color: white;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                ">Re-authenticate</button>
                <button id="reauth-settings-btn" style="
                    padding: 6px 16px;
                    background: rgba(124, 77, 255, 0.1);
                    border: 1px solid rgba(124, 77, 255, 0.2);
                    border-radius: 8px;
                    color: var(--text-secondary);
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                ">Settings</button>
            </div>
        `;

        toastContainer.appendChild(toast);

        // Re-auth button: trigger OAuth flow
        toast.querySelector('#reauth-btn').addEventListener('click', async () => {
            toast.remove();
            this.showLoading('Re-authenticating with Canvas...');
            try {
                const result = await chrome.runtime.sendMessage({ type: 'START_OAUTH_FLOW' });
                this.hideLoading();
                if (result?.success) {
                    this.showSuccess('✅ Re-authenticated! Try syncing again.');
                    // Update UI
                    const canvasStatus = document.getElementById('canvas-status');
                    if (canvasStatus) {
                        canvasStatus.textContent = 'Active';
                        canvasStatus.className = 'status-value success';
                    }
                    const statusDot = document.querySelector('.status-dot');
                    const statusLabel = document.querySelector('.status-label');
                    if (statusDot) statusDot.className = 'status-dot';
                    if (statusLabel) statusLabel.textContent = 'Ready';
                } else {
                    this.showError('❌ Re-authentication failed: ' + (result?.error || 'Unknown error'));
                }
            } catch (err) {
                this.hideLoading();
                this.showError('❌ Re-authentication failed: ' + err.message);
            }
        });

        // Settings button: open options page
        toast.querySelector('#reauth-settings-btn').addEventListener('click', () => {
            toast.remove();
            this.openSettings();
        });

        // Auto-remove after 15 seconds
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 15000);
    }

    // ✅ Load cached data from storage (no API calls)
    async loadCachedData() {
        try {
            const result = await chrome.storage.local.get(['canvasData', 'lastUpdate']);
            const data = result.canvasData;

            if (data) {
                this.canvasData = data;
                this.updateDataDisplay();

                // Update data status
                const dataStatus = document.getElementById('data-status');
                if (dataStatus && result.lastUpdate) {
                    const lastSync = new Date(result.lastUpdate);
                    const minutesAgo = Math.round((Date.now() - lastSync.getTime()) / 60000);
                    
                    if (minutesAgo < 1) {
                        dataStatus.textContent = 'Just now';
                    } else if (minutesAgo < 60) {
                        dataStatus.textContent = `${minutesAgo}m ago`;
                    } else {
                        dataStatus.textContent = `${Math.round(minutesAgo / 60)}h ago`;
                    }
                    dataStatus.className = 'status-value success';
                }
            } else {
                const dataStatus = document.getElementById('data-status');
                if (dataStatus) {
                    dataStatus.textContent = 'Not synced';
                    dataStatus.className = 'status-value warning';
                }
            }
        } catch (error) {
            console.error('Popup: Failed to load cached data:', error);
        }
    }

    async loadExtensionStatus() {
        try {
            console.log('Popup: Loading extension status...');
            
            const response = await chrome.runtime.sendMessage({
                type: 'GET_EXTENSION_STATUS'
            });
    
            console.log('Popup: Extension status response:', response);
    
            if (response && response.success) {
                this.updateStatusDisplay(response.status);
            } else {
                console.warn('Canvas AI Assistant: Failed to get extension status:', response?.error);
                this.updateStatusDisplay({
                    initialized: false,
                    canvasDetected: false,
                    hasApiKey: false,
                    hasCanvasData: false,
                    dataSource: 'none'
                });
            }
        } catch (error) {
            console.error('Canvas AI Assistant: Error loading extension status:', error);
            this.updateStatusDisplay({
                initialized: false,
                canvasDetected: false,
                hasApiKey: false,
                hasCanvasData: false,
                dataSource: 'error'
            });
        }
    }

    async loadCanvasData() {
        try {
            console.log('Popup: Loading canvas data...');
            
            const response = await chrome.runtime.sendMessage({
                type: 'GET_CANVAS_DATA'
            });

            console.log('Popup: Canvas data response:', response);

            if (response && response.success && response.data) {
                this.canvasData = response.data;
                this.updateDataDisplay();
                console.log('Popup: Canvas data loaded successfully');
            } else {
                console.log('Canvas AI Assistant: No canvas data available yet');
                this.canvasData = null;
                this.showNoDataMessage();
            }
        } catch (error) {
            console.error('Canvas AI Assistant: Error loading canvas data:', error);
            this.canvasData = null;
            this.showNoDataMessage();
        }
    }

    updateStatusDisplay(status) {
        console.log('Popup: Updating status display:', status);
        
        try {
            // Update data status
            const dataStatus = document.getElementById('data-status');
            if (dataStatus) {
                if (status.hasCanvasData) {
                    dataStatus.textContent = 'Synced';
                    dataStatus.className = 'status-value success';
                } else {
                    dataStatus.textContent = 'Pending';
                    dataStatus.className = 'status-value warning';
                }
            }

            // Update canvas status
            const canvasStatus = document.getElementById('canvas-status');
            if (canvasStatus) {
                if (this.currentTab && this.currentTab.url && this.currentTab.url.includes('instructure.com')) {
                    canvasStatus.textContent = 'Active';
                    canvasStatus.className = 'status-value success';
                } else {
                    canvasStatus.textContent = 'Not Detected';
                    canvasStatus.className = 'status-value warning';
                }
            }

            // 🔧 AI Status - ALWAYS ACTIVE (No API key needed)
            const aiStatus = document.getElementById('ai-status');
            if (aiStatus) {
                aiStatus.textContent = 'Active';
                aiStatus.className = 'status-value success';
            }

            // Update status indicator
            const statusIndicator = document.getElementById('status-indicator');
            if (statusIndicator) {
                const statusDot = statusIndicator.querySelector('.status-dot');
                const statusLabel = statusIndicator.querySelector('.status-label');
                
                if (statusDot && statusLabel) {
                    if (status.initialized && this.currentTab && this.currentTab.url.includes('instructure.com')) {
                        statusDot.className = 'status-dot';
                        statusLabel.textContent = 'Ready';
                    } else if (status.initialized) {
                        statusDot.className = 'status-dot inactive';
                        statusLabel.textContent = 'Inactive';
                    } else {
                        statusDot.className = 'status-dot error';
                        statusLabel.textContent = 'Error';
                    }
                }
            }
        } catch (error) {
            console.error('Popup: Error updating status display:', error);
        }
    }

    updateDataDisplay() {
        console.log('Popup: Updating data display');
        
        if (!this.canvasData) {
            this.showNoDataMessage();
            return;
        }

        // Update stats
        this.updateStats();
        
        // Update activity list
        this.updateActivityList();
    }

    updateStats() {
        try {
            const coursesCount = this.canvasData.courses ? this.canvasData.courses.length : 0;
            const assignmentsCount = this.canvasData.assignments ? 
                this.canvasData.assignments.filter(a => a.dueDate && new Date(a.dueDate) > new Date()).length : 0;
            const grades = this.canvasData.courses
                ? this.canvasData.courses
                    .map(course => Number(course.grade))
                    .filter(grade => Number.isFinite(grade))
                : [];
            
            document.getElementById('courses-count').textContent = coursesCount;
            document.getElementById('assignments-count').textContent = assignmentsCount;
            const averageGrade = grades.length > 0
                ? `${Math.round(grades.reduce((sum, grade) => sum + grade, 0) / grades.length)}%`
                : '--';
            document.getElementById('avg-grade').textContent = averageGrade;
            
        } catch (error) {
            console.error('Popup: Error updating stats:', error);
        }
    }

    updateActivityList() {
        const activityList = document.getElementById('activity-list');
        if (!activityList) {
            console.error('Activity list element not found!');
            return;
        }

        if (!this.canvasData || !this.canvasData.assignments || this.canvasData.assignments.length === 0) {
            this.showNoDataMessage();
            return;
        }

        try {
            // Get upcoming assignments
            const upcomingAssignments = this.canvasData.assignments
                .filter(a => a.dueDate && new Date(a.dueDate) > new Date())
                .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
                .slice(0, 3);

            if (upcomingAssignments.length === 0) {
                this.showNoDataMessage();
                return;
            }

            activityList.innerHTML = '';

            upcomingAssignments.forEach(assignment => {
                const activityItem = document.createElement('div');
                activityItem.className = 'activity-item';
                
                // Make clickable if URL exists
                if (assignment.url) {
                    activityItem.classList.add('clickable');
                    activityItem.dataset.url = assignment.url;
                    activityItem.title = `Click to open: ${assignment.title}`;
                }
                
                const dueDate = new Date(assignment.dueDate);
                const daysUntilDue = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
                
                let icon = '📝';
                let urgencyClass = '';
                
                if (daysUntilDue <= 1) {
                    icon = '🔥';
                    urgencyClass = 'urgent';
                } else if (daysUntilDue <= 3) {
                    icon = '⏰';
                    urgencyClass = 'soon';
                }

                activityItem.innerHTML = `
                    <span class="activity-icon">${icon}</span>
                    <div class="activity-content">
                        <div class="activity-title ${urgencyClass}">${this.truncateText(assignment.title, 30)}</div>
                        <div class="activity-subtitle">${assignment.courseName || 'Unknown Course'}</div>
                        <div class="activity-due">${this.formatDueDate(dueDate)}</div>
                    </div>
                    <div class="activity-meta">
                        <span class="days-badge ${urgencyClass}">${daysUntilDue > 0 ? `${daysUntilDue}d` : 'Today'}</span>
                        ${assignment.url ? '<span class="activity-arrow">→</span>' : ''}
                    </div>
                `;

                // Add click handler to open assignment in new tab
                if (assignment.url) {
                    activityItem.addEventListener('click', () => {
                        console.log('Popup: Opening assignment:', assignment.title, assignment.url);
                        chrome.tabs.create({ url: assignment.url });
                    });
                }

                activityList.appendChild(activityItem);
            });
            
        } catch (error) {
            console.error('Popup: Error updating activity list:', error);
            this.showNoDataMessage();
        }
    }

    showNoDataMessage() {
        const activityList = document.getElementById('activity-list');
        if (activityList) {
            activityList.innerHTML = `
                <div class="activity-item placeholder">
                    <span class="activity-icon">📚</span>
                    <div class="activity-content">
                        <div class="activity-title">No recent activity</div>
                        <div class="activity-subtitle">Visit Canvas to see your assignments</div>
                    </div>
                </div>
            `;
        }
    }

    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    formatDueDate(date) {
        const now = new Date();
        const diffTime = date - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return 'Due today';
        } else if (diffDays === 1) {
            return 'Due tomorrow';
        } else if (diffDays < 0) {
            return 'Overdue';
        } else {
            return `Due in ${diffDays} days`;
        }
    }

    async openChatbot() {
        console.log('Popup: Opening chatbot...');
        if (!this.currentTab || !this.currentTab.url || !this.currentTab.url.includes('instructure.com')) {
            this.showError('Please open the chatbot from a Canvas page.');
            return;
        }    
        this.showLoading('Opening AI Chatbot...');
    
        try {
            console.log('Popup: Sending openChatbot message to tab:', this.currentTab.id);
            
            // First, check if content script is already loaded by sending a ping
            try {
                const pingResponse = await chrome.tabs.sendMessage(
                    this.currentTab.id,
                    { action: 'ping' }
                );
                console.log('Popup: Content script already loaded');
            } catch (error) {
                // Content script not loaded, inject it
                console.log('Popup: Content script not loaded, injecting...');
                await chrome.scripting.executeScript({
                    target: { tabId: this.currentTab.id },
                    files: ['content.js']
                });
                console.log('Popup: Content script injected');
                
                // Wait for content script to initialize
                await new Promise(resolve => setTimeout(resolve, 500));
            }
    
            // Now send the message to open chatbot
            const response = await chrome.tabs.sendMessage(
                this.currentTab.id,
                { action: 'openChatbot' }
            );
    
            console.log('Popup: Content script response:', response);
            
            if (response && response.success) {
                console.log('Popup: Chatbot opened successfully, closing popup');
                this.showSuccess('Chatbot opened!');
                setTimeout(() => window.close(), 1000);
            } else {
                console.error('Popup: Failed to open chatbot - response:', response);
                this.showError('Failed to open chatbot: ' + (response?.error || 'Unknown error'));
            }
    
        } catch (error) {
            console.error('Canvas AI Assistant: Error opening chatbot:', error);
            this.showError('Failed to open chatbot: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    openSettings() {
        console.log('Popup: Opening settings...');
        chrome.runtime.openOptionsPage();
        window.close();
    }

    updateUI() {
        console.log('Popup: Updating UI...');
        
        try {
            // Update version
            const manifest = chrome.runtime.getManifest();
            const versionElement = document.getElementById('version');
            if (versionElement) {
                versionElement.textContent = manifest.version;
            }

            // Update button states
            const openChatbotBtn = document.getElementById('open-chatbot');
            const refreshDataBtn = document.getElementById('refresh-data');

            if (openChatbotBtn) {
                 openChatbotBtn.disabled = false;
                 openChatbotBtn.style.opacity = '1';
            }

            // ✅ CHANGED: Refresh works from ANY page via background script
            if (refreshDataBtn) {
                refreshDataBtn.disabled = false;
                refreshDataBtn.style.opacity = '1';
                refreshDataBtn.title = "Sync Canvas Data";
            }
        } catch (error) {
            console.error('Popup: Error updating UI:', error);
        }
    }

    showLoading(message) {
        console.log('Popup: Showing loading:', message);
        this.isLoading = true;
        const overlay = document.getElementById('loading-overlay');
        const text = overlay.querySelector('.loading-text');
        if (text) text.textContent = message;
        overlay.classList.add('active');
    }

    hideLoading() {
        console.log('Popup: Hiding loading');
        this.isLoading = false;
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('active');
    }

    showError(message) {
        console.error('Popup Error:', message);
        const toastContainer = document.getElementById('toast-container');
        
        const toast = document.createElement('div');
        toast.className = 'toast error';
        toast.innerHTML = `
            <span style="font-size: 16px; margin-right: 8px;">❌</span>
            <span>${message}</span>
        `;
        
        toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 4000);
    }

    showSuccess(message) {
        console.log('Popup Success:', message);
        const toastContainer = document.getElementById('toast-container');
        
        const toast = document.createElement('div');
        toast.className = 'toast success';
        toast.innerHTML = `
            <span style="font-size: 16px; margin-right: 8px;">✅</span>
            <span>${message}</span>
        `;
        
        toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize and apply theme
    await ThemeManager.init();
    ThemeManager.applyToDocument();
    
    // Listen for theme changes
    ThemeManager.onThemeChange((theme) => {
        ThemeManager.applyToDocument(theme);
    });
    console.log('Popup: DOM loaded, initializing...');
    new CanvasAIPopup();
});

// Add error handling for uncaught errors
window.addEventListener('error', (event) => {
    console.error('Popup: Uncaught error:', event.error);
});
