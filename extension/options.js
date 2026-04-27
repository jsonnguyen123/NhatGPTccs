// Canvas AI Assistant - Options Page Script
// Handles settings management and UI interactions

class CanvasAIOptions {
    constructor() {
        this.settings = {};
        this.defaultSettings = {
            autoSync: false,
            notifications: true,
            chatbotAutoOpen: false,
            theme: 'canvas',
            language: 'en',
            apiKey: '',
            aiModel: 'gpt-4o',
            aiSuggestions: true,
            aiGradesAnalysis: true,
            aiTemperature: 0.7,
            maxTokens: 1000,
            dataCollection: false,
            chatHistory: true,
            localOnly: true
        };
        this.init();
    }

    async init() {
        try {
            // Load current settings
            await this.loadSettings();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Update UI
            this.updateUI();
            
            // Set version info
            this.updateVersionInfo();
            
            console.log('Canvas AI Assistant: Options page initialized');
            
        } catch (error) {
            console.error('Canvas AI Assistant: Options initialization failed:', error);
        }
    }

    async loadSettings() {
        try {
            const stored = await chrome.storage.local.get();
            this.settings = { ...this.defaultSettings, ...stored };
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to load settings:', error);
            this.settings = { ...this.defaultSettings };
        }
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchSection(e.target.dataset.section);
            });
        });

        // Form inputs
        document.querySelectorAll('.setting-checkbox, .setting-select, .setting-input, .setting-range').forEach(input => {
            input.addEventListener('change', () => {
                this.updateSetting(input.id, this.getInputValue(input));
            });
        });

        // Special handlers
        document.getElementById('toggle-api-key').addEventListener('click', () => {
            this.toggleApiKeyVisibility();
        });

        document.getElementById('ai-temperature').addEventListener('input', (e) => {
            document.querySelector('.range-value').textContent = e.target.value;
        });

        // Action buttons
        document.getElementById('save-settings-btn').addEventListener('click', () => {
            this.saveSettings();
        });

        document.getElementById('reset-settings-btn').addEventListener('click', () => {
            this.resetSettings();
        });

        document.getElementById('clear-data-btn').addEventListener('click', () => {
            this.clearData();
        });

        document.getElementById('export-data-btn').addEventListener('click', () => {
            this.exportData();
        });
    }

    updateUI() {
        // Update all form inputs with current settings
        Object.entries(this.settings).forEach(([key, value]) => {
            const input = document.getElementById(key.replace(/([A-Z])/g, '-$1').toLowerCase());
            if (input) {
                this.setInputValue(input, value);
            }
        });

        // Update range value display
        const temperatureRange = document.getElementById('ai-temperature');
        if (temperatureRange) {
            document.querySelector('.range-value').textContent = temperatureRange.value;
        }
    }

    updateVersionInfo() {
        const manifest = chrome.runtime.getManifest();
        const version = manifest.version;
        
        document.getElementById('version').textContent = version;
        document.getElementById('about-version').textContent = version;
    }

    switchSection(sectionName) {
        // Update navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.options-section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(`${sectionName}-section`).classList.add('active');
    }

    getInputValue(input) {
        if (input.type === 'checkbox') {
            return input.checked;
        } else if (input.type === 'number') {
            return parseInt(input.value) || 0;
        } else if (input.type === 'range') {
            return parseFloat(input.value) || 0;
        } else {
            return input.value;
        }
    }

    setInputValue(input, value) {
        if (input.type === 'checkbox') {
            input.checked = Boolean(value);
        } else {
            input.value = value;
        }
    }

    updateSetting(key, value) {
        // Convert kebab-case back to camelCase
        const camelKey = key.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        this.settings[camelKey] = value;
        
        // Enable save button
        document.getElementById('save-settings-btn').disabled = false;
    }

    toggleApiKeyVisibility() {
        const apiKeyInput = document.getElementById('api-key-input');
        const toggleBtn = document.getElementById('toggle-api-key');
        
        if (apiKeyInput.type === 'password') {
            apiKeyInput.type = 'text';
            toggleBtn.textContent = '🙈';
        } else {
            apiKeyInput.type = 'password';
            toggleBtn.textContent = '👁️';
        }
    }

    async saveSettings() {
        try {
            // Save to chrome storage
            await chrome.storage.local.set(this.settings);
            
            // Notify background script
            await chrome.runtime.sendMessage({
                type: 'UPDATE_SETTINGS',
                settings: this.settings
            });
            
            this.showSuccessMessage();
            document.getElementById('save-settings-btn').disabled = true;
            
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to save settings:', error);
            this.showError('Failed to save settings');
        }
    }

    async resetSettings() {
        if (!confirm('Are you sure you want to reset all settings to defaults? This action cannot be undone.')) {
            return;
        }

        try {
            // Reset to defaults
            this.settings = { ...this.defaultSettings };
            
            // Update UI
            this.updateUI();
            
            // Save reset settings
            await this.saveSettings();
            
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to reset settings:', error);
            this.showError('Failed to reset settings');
        }
    }

    async clearData() {
        if (!confirm('Are you sure you want to clear all Canvas data? This will remove all stored assignments, grades, and chat history. This action cannot be undone.')) {
            return;
        }

        try {
            // Clear canvas data but keep settings
            await chrome.storage.local.remove([
                'canvasData',
                'chatHistory',
                'lastUpdate'
            ]);
            
            this.showSuccessMessage('Data cleared successfully');
            
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to clear data:', error);
            this.showError('Failed to clear data');
        }
    }

    async exportData() {
        try {
            const data = await chrome.storage.local.get();
            
            // Create export object
            const exportData = {
                version: chrome.runtime.getManifest().version,
                exportDate: new Date().toISOString(),
                settings: this.settings,
                canvasData: data.canvasData || null,
                chatHistory: data.chatHistory || null
            };
            
            // Create and download file
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `canvas-ai-assistant-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('Canvas AI Assistant: Failed to export data:', error);
            this.showError('Failed to export data');
        }
    }

    showSuccessMessage(message = 'Settings saved successfully!') {
        const successDiv = document.getElementById('success-message');
        const successText = successDiv.querySelector('.success-text');
        
        successText.textContent = message;
        successDiv.classList.add('show');
        
        setTimeout(() => {
            successDiv.classList.remove('show');
        }, 3000);
    }

    showError(message) {
        // Create error message element
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = `
            <div class="error-content">
                <span class="error-icon">❌</span>
                <span class="error-text">${message}</span>
            </div>
        `;
        
        // Style the error message
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
            padding: 16px 20px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new CanvasAIOptions();
    });
} else {
    new CanvasAIOptions();
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateX(100%);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
    
    .error-content {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .error-icon {
        font-size: 20px;
    }
    
    .error-text {
        font-size: 14px;
        font-weight: 500;
    }
`;
document.head.appendChild(style);