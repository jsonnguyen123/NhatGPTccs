// SINGLETON GUARD: Prevent multiple instances
if (window._canvasAIChatbotLoaded) {
    console.log('Chatbot: Already loaded, skipping duplicate initialization');
} else {
    window._canvasAIChatbotLoaded = true;

    window.CanvasAIChatbotInterface = class CanvasAIChatbotInterface {
        constructor() {
            // INSTANCE GUARD: Only allow one instance
            if (window.canvasAIChatbot instanceof CanvasAIChatbotInterface) {
                console.warn('Chatbot: Instance already exists, returning existing instance');
                return window.canvasAIChatbot;
            }

            this.messages = [];
            this.conversationHistory = [];
            this.isTyping = false;
            this.apiKey = null;
            this.canvasData = null;
            this.chatbotContainer = null;
            this.blackbaudData = null;
            this.isMinimized = false;
            this.eventListenersAttached = false;
            this.contextValid = true;
            this.isProcessing = false;
            this.boundHandlers = {}; // Store bound handlers for cleanup
            this.instanceId = Date.now(); // Unique ID for debugging

            console.log(`Chatbot: Creating new instance (ID: ${this.instanceId})`);
            
            this.initPromise = this.init();
        }

        async init() {
            try {
                console.log(`Chatbot [${this.instanceId}]: Starting initialization...`);
                
                // First check if extension context is valid
                if (!this.isExtensionContextValid()) {
                    console.warn(`Chatbot [${this.instanceId}]: Extension context invalid at start`);
                    this.contextValid = false;
                    // Don't show error yet - wait for container
                }
                
                // Load theme
                await this.loadTheme();
        
                // Wait for chatbot container
                this.chatbotContainer = await this.waitForChatbotContainer();
                console.log(`Chatbot [${this.instanceId}]: Container found`);
                
                // If context was invalid, show error now that we have the container
                if (!this.contextValid) {
                    this.showContextInvalidError();
                    return; // Stop initialization but container is visible
                }
        
                // Apply theme to the chatbot container (scoped)
                this.applyThemeToContainer(this.currentTheme);

                // ✅ Fix logo image paths for extension context
                this.fixLogoImages();
        
                // Listen for theme changes
                this.listenForThemeChanges();
        
                // Clean up any existing listeners before adding new ones
                this.cleanupEventListeners();
        
                // Load data - DON'T fail if no data, just continue
                await this.loadSettings();
                
                // Try to load canvas data but don't fail if unavailable
                try {
                    await this.loadCanvasData();
                } catch (dataError) {
                    console.warn(`Chatbot [${this.instanceId}]: Could not load Canvas data (this is OK on non-Canvas pages):`, dataError.message);
                    // Don't set contextValid to false - this is expected on non-Canvas pages
                }
                
                // Set up event listeners - THIS IS CRITICAL
                this.setupEventListeners();
                
                // Show welcome message
                this.showWelcomeMessage();
                console.log(`Chatbot [${this.instanceId}]: Initialization complete`);
                
            } catch (error) {
                console.error(`Chatbot [${this.instanceId}]: Initialization failed:`, error);
                
                // Only show context invalid error if it's actually a context issue
                if (this.isContextInvalidError(error)) {
                    this.contextValid = false;
                    this.showContextInvalidError();
                } else {
                    // For other errors, still set up basic functionality
                    console.warn(`Chatbot [${this.instanceId}]: Setting up basic UI despite error`);
                    this.setupEventListeners();
                }
            }
        }

        // ✅ NEW: Fix all logo image paths to use extension URLs
        fixLogoImages() {
            if (!this.chatbotContainer) return;
            
            const logoUrl = chrome.runtime.getURL('final-school-logo.png');
            
            // Fix header logo
            const headerLogo = this.chatbotContainer.querySelector('.header-logo-img');
            if (headerLogo) {
                headerLogo.src = logoUrl;
            }
            
            // Fix minimized state — set CSS custom property
            this.chatbotContainer.style.setProperty('--logo-url', `url('${logoUrl}')`);
            
            console.log(`Chatbot [${this.instanceId}]: Logo paths fixed to ${logoUrl}`);
        }

        async loadTheme() {
            try {
                if (!chrome?.storage?.local) {
                    console.warn('Chatbot: Chrome storage not available, using default theme');
                    this.currentTheme = 'canvas';
                    return;
                }
                
                const result = await chrome.storage.local.get(['theme']);
                this.currentTheme = result.theme || 'canvas';
                console.log(`Chatbot [${this.instanceId}]: Theme loaded:`, this.currentTheme);
            } catch (error) {
                console.warn('Chatbot: Failed to load theme, using default:', error.message);
                this.currentTheme = 'canvas';
            }
        }

        // Clean up all event listeners
        cleanupEventListeners() {
            console.log(`Chatbot [${this.instanceId}]: Cleaning up old event listeners`);
            
            // Remove old handlers if they exist
            const messagesContainer = document.getElementById('canvas-ai-messages');
            const sendBtn = document.getElementById('canvas-ai-send');
            const input = document.getElementById('canvas-ai-input');
            const minimizeBtn = document.getElementById('canvas-ai-minimize');
            const closeBtn = document.getElementById('canvas-ai-close');
            const syncHeaderBtn = document.getElementById('canvas-ai-sync-header');

            if (this.boundHandlers.messagesClick && messagesContainer) {
                messagesContainer.removeEventListener('click', this.boundHandlers.messagesClick);
            }
            if (this.boundHandlers.sendClick && sendBtn) {
                sendBtn.removeEventListener('click', this.boundHandlers.sendClick);
            }
            if (this.boundHandlers.inputKeydown && input) {
                input.removeEventListener('keydown', this.boundHandlers.inputKeydown);
            }
            if (this.boundHandlers.inputInput && input) {
                input.removeEventListener('input', this.boundHandlers.inputInput);
            }
            if (this.boundHandlers.minimizeClick && minimizeBtn) {
                minimizeBtn.removeEventListener('click', this.boundHandlers.minimizeClick);
            }
            if (this.boundHandlers.closeClick && closeBtn) {
                closeBtn.removeEventListener('click', this.boundHandlers.closeClick);
            }
            if (this.boundHandlers.syncHeaderClick && syncHeaderBtn) {
                syncHeaderBtn.removeEventListener('click', this.boundHandlers.syncHeaderClick);
            }

            this.eventListenersAttached = false;
        }

        setupEventListeners() {
            // Guard: Don't add listeners twice
            if (this.eventListenersAttached) {
                console.log(`Chatbot [${this.instanceId}]: Event listeners already attached, skipping`);
                return;
            }
        
            console.log(`Chatbot [${this.instanceId}]: Setting up event listeners`);
        
            const minimizeBtn = document.getElementById('canvas-ai-minimize');
            const closeBtn = document.getElementById('canvas-ai-close');
            const sendBtn = document.getElementById('canvas-ai-send');
            const input = document.getElementById('canvas-ai-input');
            const messagesContainer = document.getElementById('canvas-ai-messages');
            const syncHeaderBtn = document.getElementById('canvas-ai-sync-header');

            // Create and store bound handlers so we can remove them later
            this.boundHandlers.messagesClick = (event) => {
                const btn = event.target.closest('.canvas-ai-quick-btn');
                if (!btn) return; // Only handle quick action button clicks
                
                // Check context only when actually trying to send
                if (!this.isExtensionContextValid()) {
                    console.warn('Chatbot: Context invalid when trying quick action');
                    this.handleContextInvalidation();
                    return;
                }
                
                event.preventDefault();
                event.stopPropagation();
                
                const prompt = btn.getAttribute('data-prompt');
                if (prompt) {
                    console.log(`Chatbot [${this.instanceId}]: Quick action clicked:`, prompt);
                    this.sendMessage(prompt);
                }
            };
        
            this.boundHandlers.sendClick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.sendMessage();
            };
        
            this.boundHandlers.inputKeydown = (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    this.sendMessage();
                }
            };
        
            this.boundHandlers.inputInput = () => {
                this.autoResizeInput();
            };
        
            // These handlers should ALWAYS work, even if context is invalid
            this.boundHandlers.minimizeClick = () => {
                console.log(`Chatbot [${this.instanceId}]: Minimize clicked`);
                this.toggleMinimize();
            };
        
            this.boundHandlers.closeClick = () => {
                console.log(`Chatbot [${this.instanceId}]: Close clicked`);
                this.closeChatbot();
            };

            this.boundHandlers.syncHeaderClick = () => {
                console.log(`Chatbot [${this.instanceId}]: Header sync clicked`);
                this.triggerBackgroundSync(); 
            };
        
            // Attach event listeners
            if (messagesContainer) {
                messagesContainer.addEventListener('click', this.boundHandlers.messagesClick);
            }
            if (sendBtn) {
                sendBtn.addEventListener('click', this.boundHandlers.sendClick);
            }
            if (input) {
                input.addEventListener('keydown', this.boundHandlers.inputKeydown);
                input.addEventListener('input', this.boundHandlers.inputInput);
            }
            
            // CRITICAL: Always attach close/minimize handlers
            if (minimizeBtn) {
                minimizeBtn.addEventListener('click', this.boundHandlers.minimizeClick);
                console.log(`Chatbot [${this.instanceId}]: Minimize button handler attached`);
            }
            if (closeBtn) {
                closeBtn.addEventListener('click', this.boundHandlers.closeClick);
                console.log(`Chatbot [${this.instanceId}]: Close button handler attached`);
            }

            // NEW: Attach sync handler
            if (syncHeaderBtn) {
                syncHeaderBtn.addEventListener('click', this.boundHandlers.syncHeaderClick);
            }
        
            // Only make draggable/resizable if we have a valid container
            if (this.chatbotContainer) {
                this.makeDraggable();
                this.makeResizable();
            }
        
            this.eventListenersAttached = true;
            console.log(`Chatbot [${this.instanceId}]: Event listeners attached successfully`);
        }

        applyThemeToContainer(themeName) {
            if (!this.chatbotContainer) return;
        
            // Prefer ThemeManager if available
            if (typeof ThemeManager !== 'undefined' && ThemeManager.applyToElement) {
                ThemeManager.applyToElement(this.chatbotContainer, themeName);
            } else {
                // Fallback: set minimal variables so CSS picks them up
                const themes = {
                    canvas: {
                        '--bg-dark': '#0a0a0f',
                        '--bg-purple': '#1a0a2e',
                        '--bg-elevated': '#140C22',
                        '--bg-card': 'rgba(20, 10, 40, 0.6)',
                        '--bg-hover': 'rgba(124, 77, 255, 0.1)',
                        '--accent-primary': '#7C4DFF',
                        '--accent-violet': '#a855f7',
                        '--accent-light': '#B388FF',
                        '--text-primary': '#ffffff',
                        '--text-secondary': '#B6AFC9',
                        '--text-muted': '#8A839B',
                        '--border-color': 'rgba(124, 77, 255, 0.2)',
                        '--border-hover': 'rgba(124, 77, 255, 0.4)',
                        '--glow-primary': '0 0 20px rgba(124, 77, 255, 0.3)',
                        '--glow-secondary': '0 0 30px rgba(147, 51, 234, 0.2)',
                    },
                    dark: {
                        '--bg-dark': '#000000',
                        '--bg-purple': '#0d0d0d',
                        '--bg-elevated': '#1a1a1a',
                        '--bg-card': 'rgba(30, 30, 30, 0.8)',
                        '--bg-hover': 'rgba(255, 255, 255, 0.05)',
                        '--accent-primary': '#00BCD4',
                        '--accent-violet': '#26C6DA',
                        '--accent-light': '#80DEEA',
                        '--text-primary': '#ffffff',
                        '--text-secondary': '#b0b0b0',
                        '--text-muted': '#707070',
                        '--border-color': 'rgba(255, 255, 255, 0.1)',
                        '--border-hover': 'rgba(0, 188, 212, 0.4)',
                        '--glow-primary': '0 0 20px rgba(0, 188, 212, 0.3)',
                        '--glow-secondary': '0 0 30px rgba(0, 188, 212, 0.2)',
                    },
                    light: {
                        '--bg-dark': '#f8f9fa',
                        '--bg-purple': '#f0f2f5',
                        '--bg-elevated': '#ffffff',
                        '--bg-card': 'rgba(255, 255, 255, 0.9)',
                        '--bg-hover': 'rgba(99, 102, 241, 0.08)',
                        '--accent-primary': '#6366F1',
                        '--accent-violet': '#7C3AED',
                        '--accent-light': '#4F46E5',
                        '--text-primary': '#1f2937',
                        '--text-secondary': '#4b5563',
                        '--text-muted': '#9ca3af',
                        '--border-color': 'rgba(0, 0, 0, 0.1)',
                        '--border-hover': 'rgba(99, 102, 241, 0.4)',
                        '--glow-primary': '0 0 20px rgba(99, 102, 241, 0.2)',
                        '--glow-secondary': '0 0 30px rgba(99, 102, 241, 0.15)',
                    }
                };
                const themeVars = themes[themeName] || themes.canvas;
                Object.entries(themeVars).forEach(([k, v]) => {
                    this.chatbotContainer.style.setProperty(k, v);
                });
            }
        
            // Mark the container for CSS selectors in [canvas-ai-assistant/extension/chatbot.css](canvas-ai-assistant/extension/chatbot.css)
            this.chatbotContainer.setAttribute('data-theme', themeName);
        }

        listenForThemeChanges() {
            // Storage changes
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes.theme) {
                    this.currentTheme = changes.theme.newValue;
                    this.applyThemeToContainer(this.currentTheme);
                }
            });
        
            // Broadcast messages
            chrome.runtime.onMessage.addListener((message) => {
                if (message?.type === 'THEME_CHANGED' && message.theme) {
                    this.currentTheme = message.theme;
                    this.applyThemeToContainer(this.currentTheme);
                }
            });
        }

        isExtensionContextValid() {
            try {
                return !!(chrome && chrome.runtime && chrome.runtime.id);
            } catch (e) {
                return false;
            }
        }

        isContextInvalidError(error) {
            if (!error) return false;
            const message = (error.message || error.toString() || '').toLowerCase();
            return message.includes('extension context invalidated') ||
                   message.includes('extension context was invalidated') ||
                   (message.includes('message port closed') && message.includes('before'));
        }

        showContextInvalidError() {
            const messagesContainer = document.getElementById('canvas-ai-messages');
            if (messagesContainer) {
                messagesContainer.innerHTML = `
                    <div class="context-invalid-notice">
                        <div class="notice-icon">🔄</div>
                        <div class="notice-content">
                            <h3>Extension Updated</h3>
                            <p>The Canvas AI Assistant was reloaded. Please refresh this page to reconnect.</p>
                            <button class="refresh-page-btn" onclick="window.location.reload()">
                                <span>↻</span> Refresh Page
                            </button>
                        </div>
                    </div>
                `;
            }
            
            const input = document.getElementById('canvas-ai-input');
            const sendBtn = document.getElementById('canvas-ai-send');
            if (input) {
                input.disabled = true;
                input.placeholder = 'Please refresh the page...';
            }
            if (sendBtn) {
                sendBtn.disabled = true;
            }
            
            // IMPORTANT: Still set up close/minimize buttons even in error state
            const closeBtn = document.getElementById('canvas-ai-close');
            const minimizeBtn = document.getElementById('canvas-ai-minimize');
            
            if (closeBtn) {
                closeBtn.onclick = () => {
                    console.log('Chatbot: Close button clicked (error state)');
                    if (this.chatbotContainer) {
                        this.chatbotContainer.classList.add('hidden');
                        this.chatbotContainer.style.display = 'none';
                    }
                };
            }
            
            if (minimizeBtn) {
                minimizeBtn.onclick = () => {
                    console.log('Chatbot: Minimize button clicked (error state)');
                    this.toggleMinimize();
                };
            }
        }

        async waitForChatbotContainer(maxRetries = 10, interval = 200) {
            for (let i = 0; i < maxRetries; i++) {
                const container = document.getElementById('canvas-ai-assistant');
                if (container && container.querySelector('.canvas-ai-messages')) {
                    return container;
                }
                await new Promise(resolve => setTimeout(resolve, interval));
            }
            throw new Error('Chatbot container not found after ' + maxRetries + ' attempts');
        }

        async sendMessageToBackground(message) {
            return new Promise((resolve) => {
                // Check if we can send messages
                if (!chrome?.runtime?.id) {
                    console.warn(`Chatbot [${this.instanceId}]: Cannot send message - no runtime ID`);
                    // Don't invalidate context immediately - could be temporary
                    resolve(null);
                    return;
                }
        
                try {
                    chrome.runtime.sendMessage(message, (response) => {
                        if (chrome.runtime.lastError) {
                            const errorMsg = chrome.runtime.lastError.message || '';
                            console.warn(`Chatbot [${this.instanceId}]: Message error:`, errorMsg);
                            
                            // Only invalidate for actual context errors, not network issues
                            if (this.isContextInvalidError({ message: errorMsg })) {
                                this.handleContextInvalidation();
                            }
                            resolve(null);
                        } else {
                            resolve(response);
                        }
                    });
                } catch (error) {
                    console.warn(`Chatbot [${this.instanceId}]: sendMessage exception:`, error.message);
                    // Only invalidate for actual context errors
                    if (this.isContextInvalidError(error)) {
                        this.handleContextInvalidation();
                    }
                    resolve(null);
                }
            });
        }

        handleContextInvalidation() {
            if (!this.contextValid) return;
            
            this.contextValid = false;
            console.warn(`Chatbot [${this.instanceId}]: Context invalidated - showing refresh notice`);
            this.showContextInvalidError();
        }

        async loadCanvasData() {
            try {
                console.log(`Chatbot [${this.instanceId}]: Fetching Canvas data...`);
                
                // ALWAYS try to get cached data from storage first (works on ANY page)
                const response = await this.sendMessageToBackground({
                    type: 'GET_CACHED_DATA'
                });
                
                if (response && response.success && response.data) {
                    this.canvasData = response.data;
                    this.lastDataUpdate = response.lastUpdate;
                    
                    const courseCount = this.canvasData?.courses?.length || 0;
                    const assignmentCount = this.canvasData?.assignments?.length || 0;
                    
                    console.log(`Chatbot [${this.instanceId}]: Loaded cached data - ${courseCount} courses, ${assignmentCount} assignments`);
                    console.log(`Chatbot [${this.instanceId}]: Data last updated: ${this.lastDataUpdate}`);
                    
                    return true;
                }
                
                // Fallback: Try local data service (only available on Canvas pages)
                if (window.canvasDataService?.extractedData) {
                    this.canvasData = window.canvasDataService.extractedData;
                    console.log(`Chatbot [${this.instanceId}]: Using local extracted data`);
                    return true;
                }
                
                // No data available
                console.log(`Chatbot [${this.instanceId}]: No Canvas data available yet`);
                this.canvasData = null;
                return false;
                
            } catch (error) {
                console.warn(`Chatbot [${this.instanceId}]: Could not load canvas data:`, error.message);
                
                // Try local fallback
                if (window.canvasDataService?.extractedData) {
                    this.canvasData = window.canvasDataService.extractedData;
                    return true;
                }
                
                this.canvasData = null;
                return false;
            }
        }

        async loadSettings() {
            try {
                const response = await this.sendMessageToBackground({ type: 'GET_SETTINGS' });
                if (response && response.success) {
                    this.apiKey = response.settings?.apiKey;
                    console.log(`Chatbot [${this.instanceId}]: Settings loaded`);
                }
            } catch (error) {
                console.warn(`Chatbot [${this.instanceId}]: Could not load settings:`, error.message);
            }
        }

        makeDraggable() {
            const header = this.chatbotContainer?.querySelector('.canvas-ai-header');
            if (!header) return;

            let isDragging = false;
            let hasMoved = false;
            let startX, startY, initialX, initialY;

            const onMouseDown = (e) => {
                if (e.target.tagName === 'BUTTON') return;
                if (this.isMinimized) return;
                isDragging = true;
                hasMoved = false;
                startX = e.clientX;
                startY = e.clientY;
                initialX = this.chatbotContainer.offsetLeft;
                initialY = this.chatbotContainer.offsetTop;
                header.style.cursor = 'grabbing';
                this.chatbotContainer.style.transition = 'none';
            };

            const onMinimizedMouseDown = (e) => {
                if (!this.isMinimized) return;
                if (e.target.tagName === 'BUTTON') return;
                
                isDragging = true;
                hasMoved = false;
                startX = e.clientX;
                startY = e.clientY;
                
                const rect = this.chatbotContainer.getBoundingClientRect();
                initialX = rect.left;
                initialY = rect.top;
                
                this.chatbotContainer.style.transition = 'none';
                e.preventDefault();
            };

            const onMouseMove = (e) => {
                if (!isDragging) return;
                e.preventDefault();
                
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                
                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    hasMoved = true;
                }
                
                let newLeft = initialX + deltaX;
                let newTop = initialY + deltaY;
                
                const containerWidth = this.isMinimized ? 60 : this.chatbotContainer.offsetWidth;
                const containerHeight = this.isMinimized ? 60 : this.chatbotContainer.offsetHeight;
                
                newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - containerWidth));
                newTop = Math.max(0, Math.min(newTop, window.innerHeight - containerHeight));
                
                this.chatbotContainer.style.left = newLeft + 'px';
                this.chatbotContainer.style.top = newTop + 'px';
                this.chatbotContainer.style.right = 'auto';
                this.chatbotContainer.style.bottom = 'auto';
            };

            const onMouseUp = () => {
                if (isDragging) {
                    isDragging = false;
                    header.style.cursor = 'move';
                    this.chatbotContainer.style.transition = '';
                    
                    if (this.isMinimized && !hasMoved) {
                        this.toggleMinimize();
                    }
                }
            };

            header.addEventListener('mousedown', onMouseDown);
            this.chatbotContainer.addEventListener('mousedown', onMinimizedMouseDown);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }

        makeResizable() {
            if (!this.chatbotContainer) return;

            const resizeHandles = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
            
            resizeHandles.forEach(direction => {
                // Check if handle already exists
                if (!this.chatbotContainer.querySelector(`.resize-${direction}`)) {
                    const handle = document.createElement('div');
                    handle.className = `resize-handle resize-${direction}`;
                    handle.dataset.direction = direction;
                    this.chatbotContainer.appendChild(handle);
                }
            });

            let isResizing = false;
            let currentHandle = null;
            let startX, startY, startWidth, startHeight, startLeft, startTop;

            const minWidth = 300;
            const minHeight = 400;
            const maxWidth = 800;
            const maxHeight = window.innerHeight * 0.9;

            const onMouseDown = (e) => {
                if (!e.target.classList.contains('resize-handle')) return;
                if (this.isMinimized) return;

                isResizing = true;
                currentHandle = e.target.dataset.direction;
                
                startX = e.clientX;
                startY = e.clientY;
                startWidth = this.chatbotContainer.offsetWidth;
                startHeight = this.chatbotContainer.offsetHeight;
                
                const rect = this.chatbotContainer.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;

                this.chatbotContainer.style.transition = 'none';
                e.preventDefault();
            };

            const onMouseMove = (e) => {
                if (!isResizing || !currentHandle) return;
                e.preventDefault();

                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;

                let newWidth = startWidth;
                let newHeight = startHeight;
                let newLeft = startLeft;
                let newTop = startTop;

                if (currentHandle.includes('e')) {
                    newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX));
                }
                if (currentHandle.includes('w')) {
                    const possibleWidth = startWidth - deltaX;
                    if (possibleWidth >= minWidth && possibleWidth <= maxWidth) {
                        newWidth = possibleWidth;
                        newLeft = startLeft + deltaX;
                    }
                }

                if (currentHandle.includes('s')) {
                    newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY));
                }
                if (currentHandle.includes('n')) {
                    const possibleHeight = startHeight - deltaY;
                    if (possibleHeight >= minHeight && possibleHeight <= maxHeight) {
                        newHeight = possibleHeight;
                        newTop = startTop + deltaY;
                    }
                }

                this.chatbotContainer.style.width = newWidth + 'px';
                this.chatbotContainer.style.height = newHeight + 'px';
                this.chatbotContainer.style.left = newLeft + 'px';
                this.chatbotContainer.style.top = newTop + 'px';
                this.chatbotContainer.style.right = 'auto';
                this.chatbotContainer.style.bottom = 'auto';
            };

            const onMouseUp = () => {
                if (isResizing) {
                    isResizing = false;
                    currentHandle = null;
                    this.chatbotContainer.style.transition = '';
                }
            };

            this.chatbotContainer.addEventListener('mousedown', onMouseDown);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }

        showWelcomeMessage() {
            if (!this.contextValid) return;
            
            setTimeout(() => {
                if (this.messages.length > 0) return;
                
                const messagesContainer = document.getElementById('canvas-ai-messages');
                if (messagesContainer && messagesContainer.children.length > 1) return;
        
                const hasData = this.canvasData && this.canvasData.courses && this.canvasData.courses.length > 0;
                
                // ✅ Count only upcoming assignments (due date in the future)
                const upcomingAssignments = this.canvasData?.assignments?.filter(a => 
                    a.dueDate && new Date(a.dueDate) > new Date()
                ) || [];
                const assignmentCount = upcomingAssignments.length;
                
                let welcomeMessages;
                
                if (hasData) {
                    // Format last update time
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
                    
                    welcomeMessages = [
                        "👋 Hello! I'm your Canvas AI Assistant.",
                        `📊 I have your data loaded: **${this.canvasData.courses.length} courses** and **${assignmentCount} upcoming assignment${assignmentCount !== 1 ? 's' : ''}**.\n\n${lastUpdateStr ? `*Last synced: ${lastUpdateStr}*` : ''}\n\nAsk me questions like:\n• "What assignments are due this week?"\n• "Show my grades"\n• "What's overdue?"`
                    ];
                } if (!hasData) {
                    // Try background sync automatically instead of making user click
                    welcomeMessages = [
                        "👋 Hello! I'm your Canvas AI Assistant.",
                        "Loading your Canvas data in the background... You can start asking questions and I'll use the latest data as it arrives."
                    ];
                    
                    // Auto-trigger sync silently
                    setTimeout(() => {
                        this.triggerBackgroundSync().catch(() => {});
                    }, 1000);
                }
        
                welcomeMessages.forEach((message, index) => {
                    setTimeout(() => {
                        this.addMessage(message, 'assistant');
                    }, index * 1000);
                });
            }, 500);
        }
        
        // Add a sync button method
        addSyncButton() {
            const messagesContainer = document.getElementById('canvas-ai-messages');
            if (!messagesContainer) return;
            
            // Check if button already exists
            if (document.getElementById('canvas-ai-sync-btn')) return;
            
            const syncDiv = document.createElement('div');
            syncDiv.className = 'canvas-ai-sync-prompt';
            syncDiv.innerHTML = `
                <button id="canvas-ai-sync-btn" class="canvas-ai-quick-btn sync-btn">
                    <span class="sync-icon">🔄</span> Sync Canvas Data
                </button>
            `;
            messagesContainer.appendChild(syncDiv);
            
            // Add click handler
            document.getElementById('canvas-ai-sync-btn').addEventListener('click', async () => {
                await this.triggerBackgroundSync();
            });
        }
        
        // Add background sync trigger method
        async triggerBackgroundSync() {
            const syncBtn = document.getElementById('canvas-ai-sync-btn');
            const headerSyncBtn = document.getElementById('canvas-ai-sync-header');
            if (syncBtn) {
                syncBtn.disabled = true;
                syncBtn.innerHTML = '<span class="sync-icon spinning">🔄</span> Syncing...';
            }
            if (headerSyncBtn) {
                headerSyncBtn.classList.add('spinning');
                headerSyncBtn.disabled = true;
            }
            
            this.addMessage("🔄 Syncing your Canvas data...", 'assistant');
            
            try {
                const response = await this.sendMessageToBackground({
                    type: 'BACKGROUND_SYNC'
                });
                
                if (response && response.success) {
                    this.canvasData = response.data;
                    this.lastDataUpdate = new Date().toISOString();
                    
                    const courseCount = response.data?.courses?.length || 0;
                    const assignmentCount = response.data?.assignments?.length || 0;
                    
                    this.addMessage(`✅ Sync complete! Loaded **${courseCount} courses** and **${assignmentCount} assignments**.\n\nYou can now ask me about your assignments, grades, and deadlines!`, 'assistant');
                    
                    // Remove sync button
                    const syncPrompt = document.querySelector('.canvas-ai-sync-prompt');
                    if (syncPrompt) syncPrompt.remove();
                    
                } else {
                    throw new Error(response?.error || 'Sync failed');
                }
            } catch (error) {
                console.error('Chatbot: Background sync failed:', error);
                this.addMessage(`❌ Sync failed: ${error.message}\n\nPlease make sure you've configured your Canvas token in the extension settings.`, 'assistant');
                
                if (syncBtn) {
                    syncBtn.disabled = false;
                    syncBtn.innerHTML = '<span class="sync-icon">🔄</span> Try Again';
                }
            } finally {
                // Always reset header button animation
                if (headerSyncBtn) {
                    headerSyncBtn.classList.remove('spinning');
                    headerSyncBtn.disabled = false;
                }
            }
        }

        addMessage(content, sender = 'user') {
            const messagesContainer = document.getElementById('canvas-ai-messages');
            if (!messagesContainer) return;

            const messageDiv = document.createElement('div');
            messageDiv.className = `canvas-ai-message ${sender}`;
            
            const bubbleDiv = document.createElement('div');
            bubbleDiv.className = 'canvas-ai-message-bubble';
            bubbleDiv.innerHTML = this.formatMessageContent(content);
            
            messageDiv.appendChild(bubbleDiv);
            messagesContainer.appendChild(messageDiv);
            this.scrollToBottom();
            
            this.messages.push({ content, sender, timestamp: new Date().toISOString() });
        }

        formatMessageContent(content) {
            let formatted = content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            
            // 🛡️ FIX #12: Safely convert markdown links — validate URLs
            formatted = formatted.replace(
                /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
                (match, text, url) => {
                    try {
                        const parsed = new URL(url.replace(/&amp;/g, '&'));
                        if (!['http:', 'https:'].includes(parsed.protocol)) return text;
                        const safeUrl = url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                        const safeText = text.replace(/"/g, '&quot;');
                        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
                    } catch {
                        return text; // Invalid URL — show as plain text
                    }
                }
            );

            // 🛡️ FIX #12: Safely convert raw URLs — validate protocol
            formatted = formatted.replace(
                /(?<!href="|">)(?:Source:\s*)?(https?:\/\/[^\s<)\]]+)/g,
                (match, url) => {
                    try {
                        const cleanUrl = url.replace(/&amp;/g, '&');
                        const parsed = new URL(cleanUrl);
                        if (!['http:', 'https:'].includes(parsed.protocol)) return url;
                        const safeUrl = url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                        return `<a href="${safeUrl}" class="search-result-link" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
                    } catch {
                        return url;
                    }
                }
            );
            
            const lines = formatted.split('\n');
            let inList = false;
            let result = [];
            
            for (let line of lines) {
                const trimmedLine = line.trim();
                
                if (trimmedLine.startsWith('• ') || trimmedLine.startsWith('* ')) {
                    if (!inList) {
                        result.push('<ul class="ai-message-list">');
                        inList = true;
                    }
                    let listContent = trimmedLine.substring(2);
                    listContent = this.linkifyAssignments(listContent);
                    result.push(`<li>${listContent}</li>`);
                } else {
                    if (inList) {
                        result.push('</ul>');
                        inList = false;
                    }
                    if (trimmedLine) {
                        const linkedLine = this.linkifyAssignments(trimmedLine);
                        result.push(`<p>${linkedLine}</p>`);
                    }
                }
            }
            
            if (inList) {
                result.push('</ul>');
            }
            
            formatted = result.join('');
            
            formatted = formatted
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`(.*?)`/g, '<code>$1</code>');
            
            return formatted;
        }

        // 🛡️ FIX #12: Also sanitize linkifyAssignments
        linkifyAssignments(text) {
            if (!this.canvasData?.assignments) return text;
            
            let result = text;
            
            const sortedAssignments = [...this.canvasData.assignments]
                .sort((a, b) => (b.title?.length || 0) - (a.title?.length || 0));
            
            for (const assignment of sortedAssignments) {
                if (!assignment.title || !assignment.url) continue;
                
                // 🛡️ Validate URL before creating link
                try {
                    const parsed = new URL(assignment.url);
                    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
                } catch {
                    continue; // Skip invalid URLs
                }
                
                const escapedTitle = assignment.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\b${escapedTitle}\\b`, 'gi');
                
                const safeUrl = assignment.url.replace(/"/g, '&quot;');
                const safeTitle = assignment.title.replace(/"/g, '&quot;');
                
                result = result.replace(regex, (match) => {
                    return `<a href="${safeUrl}" class="assignment-link" target="_blank" title="Open ${safeTitle} in Canvas">${match}</a>`;
                });
            }
            
            return result;
        }

        showTypingIndicator() {
            const messagesContainer = document.getElementById('canvas-ai-messages');
            if (!messagesContainer) return;
            
            // Remove existing typing indicator first
            const existing = document.getElementById('typing-indicator');
            if (existing) existing.remove();
            
            const typingDiv = document.createElement('div');
            typingDiv.id = 'typing-indicator';
            typingDiv.className = 'canvas-ai-message assistant typing';
            typingDiv.innerHTML = `
                <div class="canvas-ai-message-bubble">
                    <div class="canvas-ai-typing">
                        <div class="canvas-ai-typing-dot"></div>
                        <div class="canvas-ai-typing-dot"></div>
                        <div class="canvas-ai-typing-dot"></div>
                    </div>
                </div>
            `;
            messagesContainer.appendChild(typingDiv);
            this.scrollToBottom();
            this.isTyping = true;
        }

        hideTypingIndicator() {
            const typingIndicator = document.getElementById('typing-indicator');
            if (typingIndicator) typingIndicator.remove();
            this.isTyping = false;
        }

        async sendMessage(forcedPrompt = null) {
            // Guard against double sends
            if (this.isProcessing) {
                console.log(`Chatbot [${this.instanceId}]: Already processing, ignoring send request`);
                return;
            }
            
            if (this.isTyping) {
                console.log(`Chatbot [${this.instanceId}]: Already typing, ignoring send request`);
                return;
            }

            if (!this.contextValid) {
                this.addMessage("🔄 Please refresh the page to reconnect the AI Assistant.", 'system');
                return;
            }
            
            const input = document.getElementById('canvas-ai-input');
            const message = forcedPrompt || (input ? input.value.trim() : '');
            
            if (!message) {
                console.log(`Chatbot [${this.instanceId}]: Empty message, ignoring`);
                return;
            }

            console.log(`Chatbot [${this.instanceId}]: Sending message:`, message.substring(0, 50) + '...');
            this.isProcessing = true;

            this.addMessage(message, 'user');
            
            if (!forcedPrompt && input) {
                input.value = '';
                this.autoResizeInput();
            }
            
            this.showTypingIndicator();
            
            try {
                const response = await this.getAIResponse(message);
                this.hideTypingIndicator();
                this.addMessage(response, 'assistant');
            } catch (error) {
                this.hideTypingIndicator();
                this.handleAIError(error);
            } finally {
                this.isProcessing = false;
            }
        }

        async getAIResponse(message) {
            if (!this.contextValid) {
                return "🔄 The extension was updated. Please **refresh this page** to continue.";
            }

            // Client-side safety gate — stays here as first line of defense
            if (!this.isSearchQuerySafe(message)) {
                return "I can't help with that type of request. Please keep your questions appropriate for a school setting. 📚";
            }

            // Refresh canvas data if missing
            if (!this.canvasData || !this.canvasData.courses || this.canvasData.courses.length === 0) {
                console.log(`Chatbot [${this.instanceId}]: Data missing, attempting to fetch...`);
                await this.loadCanvasData();
            }

            // Build a lightweight canvas data summary for the server
            const canvasDataSummary = this.buildCanvasDataSummary();

            console.log(`Chatbot [${this.instanceId}]: Sending to background (Gemini function calling)`, {
                messagePreview: message.substring(0, 50),
                historyLength: this.conversationHistory.length,
                hasCanvasData: !!canvasDataSummary
            });

            try {
                const response = await this.sendMessageToBackground({
                    type: 'AI_CHAT_REQUEST',
                    data: {
                        message: message,
                        canvasData: canvasDataSummary,
                        conversationHistory: this.conversationHistory.slice(-20) // Last 20 turns max
                    }
                });

                if (response && response.success) {
                    // Track conversation history for multi-turn context
                    this.conversationHistory.push(
                        { role: 'user', content: message },
                        { role: 'assistant', content: response.response }
                    );

                    // Keep history from growing too large
                    if (this.conversationHistory.length > 40) {
                        this.conversationHistory = this.conversationHistory.slice(-30);
                    }

                    return response.response;
                } else {
                    const errorMsg = response?.error || 'Unknown error';
                    console.warn(`Chatbot [${this.instanceId}]: AI request failed:`, errorMsg);

                    // If blocked by content filter
                    if (response?.blocked) {
                        return "I can't help with that type of request. Please keep your questions appropriate. 📚";
                    }

                    // Fall back to offline response
                    return this.getOfflineResponse(message);
                }
            } catch (error) {
                console.error(`Chatbot [${this.instanceId}]: AI request error:`, error.message);

                if (this.isContextInvalidError(error)) {
                    this.handleContextInvalidation();
                    return "🔄 The extension was updated. Please **refresh this page** to continue.";
                }

                return this.getOfflineResponse(message);
            }
        }

        // Build a lightweight summary of canvas data to send with each request
        buildCanvasDataSummary() {
            if (!this.canvasData) return null;

            const summary = {};

            if (this.canvasData.courses) {
                summary.courses = this.canvasData.courses.map(c => ({
                    id: c.id,
                    name: c.name,
                    code: c.code,
                    grade: c.grade,
                    enrollmentGrade: c.enrollmentGrade
                }));
            }

            if (this.canvasData.assignments) {
                summary.assignments = this.canvasData.assignments.map(a => ({
                    id: a.id,
                    title: a.title,
                    courseId: a.courseId,
                    courseName: a.courseName,
                    dueDate: a.dueDate,
                    status: a.status,
                    pointsPossible: a.pointsPossible
                }));
            }

            if (this.canvasData.announcements) {
                summary.announcements = this.canvasData.announcements.slice(0, 20);
            }

            if (this.canvasData.assignmentGrades) {
                summary.assignmentGrades = this.canvasData.assignmentGrades.slice(0, 50);
            }

            return summary;
        }


        getOfflineResponse(message) {
            const lowerMessage = message.toLowerCase();

            // Check if we have data for Canvas-specific fallbacks
            if (!this.canvasData || !this.canvasData.courses || this.canvasData.courses.length === 0) {
                const isCanvasPage = window.location.hostname?.includes('instructure.com');
                if (!isCanvasPage) {
                    return "I'm having trouble connecting to the AI right now. Please check your internet connection and try again. 🔌";
                }
                return "I'm still loading your Canvas data. Please wait a moment and try again, or refresh the page if this persists.";
            }

            if (lowerMessage.includes('assignment') || lowerMessage.includes('due') || lowerMessage.includes('homework')) {
                return this.getAssignmentsResponse();
            } else if (lowerMessage.includes('course') || lowerMessage.includes('class') || lowerMessage.includes('grade')) {
                return this.getCoursesResponse();
            } else {
                return "I'm having trouble connecting to the AI right now, but I can still help with your **assignments**, **grades**, or **courses** using your cached Canvas data. 😊";
            }
        }

        // 🛡️ Client-side content safety check for search queries
        isSearchQuerySafe(query) {
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
                if (cleaned.includes(term)) {
                    console.warn(`🛡️ Chatbot: Blocked search term detected: "${term}"`);
                    return false;
                }
            }

            const dangerousPatterns = [
                /how\s+to\s+(kill|murder|poison|harm|hurt)\s+(myself|someone|people)/i,
                /how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|explosive|weapon|meth|cocaine)/i,
                /where\s+to\s+(buy|get|find)\s+(drugs|guns|weapons|illegal)/i,
                /ways\s+to\s+(die|commit\s+suicide|end\s+(my|it|life))/i
            ];

            for (const pattern of dangerousPatterns) {
                if (pattern.test(query)) {
                    console.warn(`🛡️ Chatbot: Blocked dangerous search pattern`);
                    return false;
                }
            }

            return true;
        }

        getAssignmentsResponse() {
            if (!this.canvasData?.assignments?.length) {
                return "I can't see any upcoming assignments right now. Please ensure you are logged into Canvas.";
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
        

        getHelpResponse() {
            return "I can help you with your Canvas studies! Ask me about **assignments**, **grades**, or **deadlines**.";
        }

        handleAIError(error) {
            console.error(`Chatbot [${this.instanceId}]: Error:`, error);
            
            if (this.isContextInvalidError(error)) {
                this.handleContextInvalidation();
            } else {
                this.addMessage("I'm having trouble connecting. Please check your internet or API key settings.", 'assistant');
            }
        }

        toggleMinimize() {
            this.isMinimized = !this.isMinimized;
            
            if (this.chatbotContainer) {
                if (this.isMinimized) {
                    const rect = this.chatbotContainer.getBoundingClientRect();
                    this.lastPosition = {
                        left: rect.left,
                        top: rect.top
                    };
                    
                    this.chatbotContainer.style.width = '';
                    this.chatbotContainer.style.height = '';
                    this.chatbotContainer.classList.add('minimized');
                    this.chatbotContainer.style.cursor = 'move';
                    
                    if (this.lastPosition) {
                        this.chatbotContainer.style.left = this.lastPosition.left + 'px';
                        this.chatbotContainer.style.top = this.lastPosition.top + 'px';
                        this.chatbotContainer.style.right = 'auto';
                        this.chatbotContainer.style.bottom = 'auto';
                    }
                } else {
                    this.chatbotContainer.classList.remove('minimized');
                    this.chatbotContainer.style.cursor = 'default';
                    this.chatbotContainer.style.width = '';
                    this.chatbotContainer.style.height = '';
                    
                    const rect = this.chatbotContainer.getBoundingClientRect();
                    const expandedWidth = 480;
                    const expandedHeight = 700;
                    
                    if (rect.left + expandedWidth > window.innerWidth || 
                        rect.top + expandedHeight > window.innerHeight ||
                        rect.left < 0 || rect.top < 0) {
                        this.chatbotContainer.style.right = '20px';
                        this.chatbotContainer.style.bottom = '20px';
                        this.chatbotContainer.style.left = 'auto';
                        this.chatbotContainer.style.top = 'auto';
                    }
                }
            }
        }

        closeChatbot() {
            console.log(`Chatbot [${this.instanceId}]: Closing chatbot`);
            if (this.chatbotContainer) {
                this.chatbotContainer.classList.add('hidden');
                this.chatbotContainer.style.display = 'none';
            }
        }

        autoResizeInput() {
            const input = document.getElementById('canvas-ai-input');
            if (input) {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 100) + 'px';
            }
        }

        scrollToBottom() {
            const container = document.getElementById('canvas-ai-messages');
            if (container) container.scrollTop = container.scrollHeight;
        }

        showError(message) {
            this.addMessage(`❌ ${message}`, 'system');
        }

        // Cleanup method for when the chatbot is destroyed
        destroy() {
            console.log(`Chatbot [${this.instanceId}]: Destroying instance`);
            this.cleanupEventListeners();
            this.contextValid = false;
            if (window.canvasAIChatbot === this) {
                window.canvasAIChatbot = null;
            }
        }
    };

    // SINGLETON INITIALIZATION
    (function() {
        let initAttempted = false;

        function init() {
            // Only attempt init once per page load
            if (initAttempted && window.canvasAIChatbot) {
                console.log('Chatbot: Init already completed, skipping');
                return;
            }

            const container = document.getElementById('canvas-ai-assistant');
            if (!container) {
                return; // Container not ready yet
            }

            // Check if we already have a valid instance
            if (window.canvasAIChatbot && window.canvasAIChatbot.chatbotContainer) {
                console.log('Chatbot: Valid instance already exists');
                return;
            }

            console.log('Chatbot: Creating singleton instance');
            initAttempted = true;
            window.canvasAIChatbot = new window.CanvasAIChatbotInterface();
        }

        // Try init on DOMContentLoaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(init, 500);
            });
        } else {
            setTimeout(init, 500);
        }

        // Also watch for dynamic container injection
        let observerActive = false;
        const observer = new MutationObserver((mutations) => {
            if (window.canvasAIChatbot) {
                // Already have an instance, stop observing
                if (observerActive) {
                    observer.disconnect();
                    observerActive = false;
                }
                return;
            }

            for (let m of mutations) {
                if (m.addedNodes) {
                    for (let n of m.addedNodes) {
                        if (n.id === 'canvas-ai-assistant') {
                            console.log('Chatbot: Container dynamically added, initializing');
                            setTimeout(init, 100);
                            return;
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        observerActive = true;
    })();
}