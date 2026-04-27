// Canvas AI Assistant - Side Panel
class SidePanelChatbot {
    constructor() {
        this.messages = [];
        this.canvasData = null;
        this.lastDataUpdate = null;
        this.isTyping = false;
        this.isProcessing = false;
        
        this.init();
    }

    async init() {
        console.log('SidePanel: Initializing...');
        
        // Load cached data first
        await this.loadCanvasData();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Update UI status
        this.updateConnectionStatus();
        
        // Show welcome message
        this.showWelcomeMessage();
        
        // Listen for storage changes (data updates from other sources)
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes.canvasData) {
                    this.canvasData = changes.canvasData.newValue;
                    this.updateConnectionStatus();
                }
                if (changes.lastUpdate) {
                    this.lastDataUpdate = changes.lastUpdate.newValue;
                    this.updateConnectionStatus();
                }
            }
        });
        
        console.log('SidePanel: Initialization complete');
    }

    setupEventListeners() {
        // Send button
        const sendBtn = document.getElementById('sidepanel-send');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }

        // Input field
        const input = document.getElementById('sidepanel-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            input.addEventListener('input', () => this.autoResizeInput());
        }

        // Quick action buttons
        const quickActions = document.querySelectorAll('.quick-action-btn');
        quickActions.forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.getAttribute('data-prompt');
                if (prompt) {
                    this.sendMessage(prompt);
                }
            });
        });

        // Sync button in header
        const syncBtn = document.getElementById('sync-btn');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.triggerSync());
        }

        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                chrome.runtime.openOptionsPage();
            });
        }

        // Sync Now button in banner
        const syncNowBtn = document.querySelector('.sync-now-btn');
        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', () => this.triggerSync());
        }
    }

    async loadCanvasData() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'GET_CACHED_DATA'
            });
            
            if (response && response.success && response.data) {
                this.canvasData = response.data;
                this.lastDataUpdate = response.lastUpdate;
                
                const courseCount = this.canvasData?.courses?.length || 0;
                const assignmentCount = this.canvasData?.assignments?.length || 0;
                
                console.log(`SidePanel: Loaded ${courseCount} courses, ${assignmentCount} assignments`);
                return true;
            }
            
            return false;
        } catch (error) {
            console.warn('SidePanel: Could not load canvas data:', error.message);
            return false;
        }
    }

    updateConnectionStatus() {
        const statusEl = document.getElementById('connection-status');
        const banner = document.getElementById('data-status-banner');
        const bannerText = banner?.querySelector('.status-text');
        
        const hasData = this.canvasData && this.canvasData.courses && this.canvasData.courses.length > 0;
        
        if (hasData) {
            // Calculate time since last update
            let timeAgo = '';
            if (this.lastDataUpdate) {
                const lastUpdate = new Date(this.lastDataUpdate);
                const now = new Date();
                const diffMs = now - lastUpdate;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMins / 60);
                
                if (diffMins < 1) {
                    timeAgo = 'just now';
                } else if (diffMins < 60) {
                    timeAgo = `${diffMins}m ago`;
                } else if (diffHours < 24) {
                    timeAgo = `${diffHours}h ago`;
                } else {
                    timeAgo = `${Math.floor(diffHours / 24)}d ago`;
                }
            }
            
            statusEl.textContent = `● Synced ${timeAgo}`;
            statusEl.className = 'header-status connected';
            
            // Hide banner if data is fresh (less than 1 hour old)
            const diffMs = this.lastDataUpdate ? (new Date() - new Date(this.lastDataUpdate)) : Infinity;
            if (diffMs < 60 * 60 * 1000) {
                banner?.classList.add('hidden');
            } else {
                banner?.classList.remove('hidden');
                if (bannerText) bannerText.textContent = `Data is ${timeAgo} old`;
            }
        } else {
            statusEl.textContent = '● No data';
            statusEl.className = 'header-status error';
            
            banner?.classList.remove('hidden');
            if (bannerText) bannerText.textContent = 'No Canvas data loaded';
        }
    }

    showWelcomeMessage() {
        const hasData = this.canvasData && this.canvasData.courses && this.canvasData.courses.length > 0;
        const assignmentCount = this.canvasData?.assignments?.length || 0;
        
        let welcomeContent;
        
        if (hasData) {
            let lastUpdateStr = '';
            if (this.lastDataUpdate) {
                const lastUpdate = new Date(this.lastDataUpdate);
                const now = new Date();
                const diffMs = now - lastUpdate;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMins / 60);
                const diffDays = Math.floor(diffHours / 24);
                
                if (diffMins < 1) {
                    lastUpdateStr = 'just now';
                } else if (diffMins < 60) {
                    lastUpdateStr = `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
                } else if (diffHours < 24) {
                    lastUpdateStr = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                } else {
                    lastUpdateStr = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                }
            }
            
            welcomeContent = `
                <div class="welcome-container">
                    <div class="welcome-icon">👋</div>
                    <h2 class="welcome-title">Welcome back!</h2>
                    <p class="welcome-subtitle">
                        I have <strong>${this.canvasData.courses.length} courses</strong> and 
                        <strong>${assignmentCount} assignments</strong> loaded.
                        ${lastUpdateStr ? `<br><small>Last synced: ${lastUpdateStr}</small>` : ''}
                    </p>
                </div>
            `;
        } else {
            welcomeContent = `
                <div class="welcome-container">
                    <div class="welcome-icon">📚</div>
                    <h2 class="welcome-title">Canvas AI Assistant</h2>
                    <p class="welcome-subtitle">
                        I don't have any Canvas data yet. Click the button below to sync your courses and assignments.
                    </p>
                    <div class="sync-prompt">
                        <button class="sync-prompt-btn" id="welcome-sync-btn">
                            <span class="sync-icon">🔄</span> Sync Canvas Data
                        </button>
                    </div>
                </div>
            `;
        }
        
        const messagesContainer = document.getElementById('sidepanel-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = welcomeContent;
            
            // Add sync button listener if present
            const welcomeSyncBtn = document.getElementById('welcome-sync-btn');
            if (welcomeSyncBtn) {
                welcomeSyncBtn.addEventListener('click', () => this.triggerSync());
            }
        }
    }

    async triggerSync() {
        const syncBtn = document.getElementById('sync-btn');
        const welcomeSyncBtn = document.getElementById('welcome-sync-btn');
        const statusEl = document.getElementById('connection-status');
        
        // Update UI to show syncing
        if (syncBtn) {
            syncBtn.querySelector('.sync-icon').classList.add('spinning');
        }
        if (welcomeSyncBtn) {
            welcomeSyncBtn.disabled = true;
            welcomeSyncBtn.innerHTML = '<span class="sync-icon spinning">🔄</span> Syncing...';
        }
        if (statusEl) {
            statusEl.textContent = '● Syncing...';
            statusEl.className = 'header-status syncing';
        }
        
        this.addMessage('🔄 Syncing your Canvas data...', 'system');
        
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'BACKGROUND_SYNC'
            });
            
            if (response && response.success) {
                this.canvasData = response.data;
                this.lastDataUpdate = new Date().toISOString();
                
                const courseCount = response.data?.courses?.length || 0;
                const assignmentCount = response.data?.assignments?.length || 0;
                
                this.addMessage(
                    `✅ Sync complete! Loaded **${courseCount} courses** and **${assignmentCount} assignments**.`,
                    'assistant'
                );
                
                this.updateConnectionStatus();
                
                // Refresh welcome if it was showing
                const welcomeContainer = document.querySelector('.welcome-container');
                if (welcomeContainer) {
                    this.showWelcomeMessage();
                }
            } else {
                throw new Error(response?.error || 'Sync failed');
            }
        } catch (error) {
            console.error('SidePanel: Sync failed:', error);
            this.addMessage(`❌ Sync failed: ${error.message}`, 'system');
            
            if (statusEl) {
                statusEl.textContent = '● Sync failed';
                statusEl.className = 'header-status error';
            }
        } finally {
            // Reset sync button
            if (syncBtn) {
                syncBtn.querySelector('.sync-icon').classList.remove('spinning');
            }
            if (welcomeSyncBtn) {
                welcomeSyncBtn.disabled = false;
                welcomeSyncBtn.innerHTML = '<span class="sync-icon">🔄</span> Sync Canvas Data';
            }
        }
    }

    async sendMessage(forcedPrompt = null) {
        if (this.isProcessing || this.isTyping) {
            return;
        }
        
        const input = document.getElementById('sidepanel-input');
        const message = forcedPrompt || (input ? input.value.trim() : '');
        
        if (!message) return;
        
        this.isProcessing = true;
        
        // Clear welcome container if present
        const welcomeContainer = document.querySelector('.welcome-container');
        if (welcomeContainer) {
            welcomeContainer.remove();
        }
        
        // Add user message
        this.addMessage(message, 'user');
        
        // Clear input
        if (!forcedPrompt && input) {
            input.value = '';
            this.autoResizeInput();
        }
        
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            const response = await this.getAIResponse(message);
            this.hideTypingIndicator();
            this.addMessage(response, 'assistant');
        } catch (error) {
            this.hideTypingIndicator();
            this.addMessage(`❌ ${error.message}`, 'system');
        } finally {
            this.isProcessing = false;
        }
    }

    async getAIResponse(message) {
        // Try to reload data if we don't have any
        if (!this.canvasData || !this.canvasData.courses || this.canvasData.courses.length === 0) {
            await this.loadCanvasData();
        }
        
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'AI_CHAT_REQUEST',
                data: {
                    message: message,
                    canvasData: this.canvasData
                }
            });
            
            if (response && response.success) {
                return response.response;
            } else {
                return this.getOfflineResponse(message);
            }
        } catch (error) {
            console.error('SidePanel: AI request error:', error);
            return this.getOfflineResponse(message);
        }
    }

    getOfflineResponse(message) {
        const lowerMessage = message.toLowerCase();
        
        if (!this.canvasData || !this.canvasData.courses || this.canvasData.courses.length === 0) {
            return "I don't have any Canvas data loaded yet. Please click the sync button to load your courses and assignments.";
        }
        
        if (lowerMessage.includes('assignment') || lowerMessage.includes('due')) {
            return this.getAssignmentsResponse();
        } else if (lowerMessage.includes('course') || lowerMessage.includes('class') || lowerMessage.includes('grade')) {
            return this.getCoursesResponse();
        } else {
            return "I can help you with your Canvas studies! Ask me about **assignments**, **grades**, or **deadlines**.";
        }
    }

    getAssignmentsResponse() {
        if (!this.canvasData?.assignments?.length) {
            return "I can't see any upcoming assignments right now.";
        }

        const upcoming = this.canvasData.assignments
            .filter(a => a.dueDate && new Date(a.dueDate) > new Date())
            .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
            .slice(0, 5);

        if (upcoming.length === 0) return "You have no upcoming assignments due soon! 🎉";

        let text = "📅 **Upcoming Assignments:**\n\n";
        upcoming.forEach(a => {
            const date = new Date(a.dueDate).toLocaleDateString();
            text += `• **${a.title}** (${a.courseName})\n  Due: ${date}\n\n`;
        });
        return text;
    }

    getCoursesResponse() {
        if (!this.canvasData?.courses?.length) {
            return "I couldn't find any course data.";
        }
        let text = "📚 **Your Courses:**\n\n";
        this.canvasData.courses.forEach(c => {
            text += `• **${c.name}**\n  Grade: ${c.grade || 'N/A'}%\n\n`;
        });
        return text;
    }

    addMessage(content, sender) {
        const messagesContainer = document.getElementById('sidepanel-messages');
        if (!messagesContainer) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        messageDiv.innerHTML = this.formatMessageContent(content);
        
        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
        this.messages.push({ content, sender, timestamp: new Date().toISOString() });
    }

    formatMessageContent(content) {
        let formatted = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        // Handle lists
        const lines = formatted.split('\n');
        let inList = false;
        let result = [];
        
        for (let line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('• ') || trimmedLine.startsWith('* ')) {
                if (!inList) {
                    result.push('<ul>');
                    inList = true;
                }
                result.push(`<li>${trimmedLine.substring(2)}</li>`);
            } else {
                if (inList) {
                    result.push('</ul>');
                    inList = false;
                }
                if (trimmedLine) {
                    result.push(`<p>${trimmedLine}</p>`);
                }
            }
        }
        
        if (inList) result.push('</ul>');
        
        formatted = result.join('');
        
        // Bold and italic
        formatted = formatted
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        return formatted;
    }

    showTypingIndicator() {
        const messagesContainer = document.getElementById('sidepanel-messages');
        if (!messagesContainer) return;
        
        const existingIndicator = document.getElementById('typing-indicator');
        if (existingIndicator) return;
        
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typing-indicator';
        typingDiv.className = 'message assistant';
        typingDiv.innerHTML = `
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        
        messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
        this.isTyping = true;
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
        this.isTyping = false;
    }

    autoResizeInput() {
        const input = document.getElementById('sidepanel-input');
        if (input) {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        }
    }

    scrollToBottom() {
        const container = document.getElementById('sidepanel-messages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.sidePanelChatbot = new SidePanelChatbot();
});