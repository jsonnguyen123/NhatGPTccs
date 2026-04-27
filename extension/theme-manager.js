// theme-manager.js - Shared theme management for Canvas AI Assistant

const ThemeManager = {
    // Theme definitions with all CSS variables
    themes: {
        canvas: {
            name: 'Canvas (Default)',
            // Background Colors
            '--bg-primary': '#0B0812',
            '--bg-dark': '#0a0a0f',
            '--bg-purple': '#1a0a2e',
            '--bg-elevated': '#140C22',
            '--bg-tertiary': '#1A1030',
            '--bg-card': 'rgba(20, 10, 40, 0.6)',
            '--bg-hover': 'rgba(124, 77, 255, 0.1)',
            '--bg-input': 'rgba(20, 15, 35, 0.9)',
            
            // Accent Colors
            '--accent-primary': '#7C4DFF',
            '--accent-secondary': '#9333ea',
            '--accent-violet': '#a855f7',
            '--accent-pink': '#c084fc',
            '--accent-light': '#B388FF',
            '--accent-primary-light': '#B388FF',
            
            // Text Colors
            '--text-primary': '#ffffff',
            '--text-secondary': '#B6AFC9',
            '--text-muted': '#8A839B',
            
            // Status Colors
            '--status-success': '#4CAF50',
            '--status-warning': '#ffc107',
            '--status-error': '#dc3545',
            
            // Border Colors
            '--border-color': 'rgba(124, 77, 255, 0.2)',
            '--border-hover': 'rgba(124, 77, 255, 0.4)',
            
            // Shadows & Glows
            '--shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.2)',
            '--shadow-md': '0 8px 16px rgba(0, 0, 0, 0.3)',
            '--shadow-lg': '0 20px 40px rgba(0, 0, 0, 0.4)',
            '--glow-primary': '0 0 20px rgba(124, 77, 255, 0.3)',
            '--glow-secondary': '0 0 30px rgba(147, 51, 234, 0.2)',
            
            // Gradients (as separate properties for JS application)
            '--gradient-body': 'linear-gradient(180deg, #0a0a0f 0%, #1a0a2e 50%, #0a0a0f 100%)',
            '--gradient-accent': 'linear-gradient(135deg, #7C4DFF, #a855f7)',
            '--gradient-button': 'linear-gradient(135deg, #7C4DFF, #a855f7)',
        },
        
        dark: {
            name: 'Dark Mode',
            // Background Colors - Pure dark with subtle blue
            '--bg-primary': '#0d0d0d',
            '--bg-dark': '#000000',
            '--bg-purple': '#0d0d0d',
            '--bg-elevated': '#1a1a1a',
            '--bg-tertiary': '#242424',
            '--bg-card': 'rgba(30, 30, 30, 0.8)',
            '--bg-hover': 'rgba(255, 255, 255, 0.05)',
            '--bg-input': 'rgba(20, 20, 20, 0.9)',
            
            // Accent Colors - Cyan/Teal
            '--accent-primary': '#00BCD4',
            '--accent-secondary': '#00ACC1',
            '--accent-violet': '#26C6DA',
            '--accent-pink': '#4DD0E1',
            '--accent-light': '#80DEEA',
            '--accent-primary-light': '#80DEEA',
            
            // Text Colors
            '--text-primary': '#ffffff',
            '--text-secondary': '#b0b0b0',
            '--text-muted': '#707070',
            
            // Status Colors
            '--status-success': '#00E676',
            '--status-warning': '#FFAB00',
            '--status-error': '#FF5252',
            
            // Border Colors
            '--border-color': 'rgba(255, 255, 255, 0.1)',
            '--border-hover': 'rgba(0, 188, 212, 0.4)',
            
            // Shadows & Glows
            '--shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.4)',
            '--shadow-md': '0 8px 16px rgba(0, 0, 0, 0.5)',
            '--shadow-lg': '0 20px 40px rgba(0, 0, 0, 0.6)',
            '--glow-primary': '0 0 20px rgba(0, 188, 212, 0.3)',
            '--glow-secondary': '0 0 30px rgba(0, 188, 212, 0.2)',
            
            // Gradients
            '--gradient-body': 'linear-gradient(180deg, #0d0d0d 0%, #1a1a1a 50%, #0d0d0d 100%)',
            '--gradient-accent': 'linear-gradient(135deg, #00BCD4, #26C6DA)',
            '--gradient-button': 'linear-gradient(135deg, #00BCD4, #00ACC1)',
        },
        
        light: {
            name: 'Light Mode',
            // Background Colors - Clean whites and grays
            '--bg-primary': '#ffffff',
            '--bg-dark': '#f8f9fa',
            '--bg-purple': '#f0f2f5',
            '--bg-elevated': '#ffffff',
            '--bg-tertiary': '#e9ecef',
            '--bg-card': 'rgba(255, 255, 255, 0.9)',
            '--bg-hover': 'rgba(99, 102, 241, 0.08)',
            '--bg-input': '#ffffff',
            
            // Accent Colors - Indigo
            '--accent-primary': '#6366F1',
            '--accent-secondary': '#4F46E5',
            '--accent-violet': '#7C3AED',
            '--accent-pink': '#8B5CF6',
            '--accent-light': '#4F46E5',
            '--accent-primary-light': '#4F46E5',
            
            // Text Colors
            '--text-primary': '#1f2937',
            '--text-secondary': '#4b5563',
            '--text-muted': '#9ca3af',
            
            // Status Colors
            '--status-success': '#10B981',
            '--status-warning': '#F59E0B',
            '--status-error': '#EF4444',
            
            // Border Colors
            '--border-color': 'rgba(0, 0, 0, 0.1)',
            '--border-hover': 'rgba(99, 102, 241, 0.4)',
            
            // Shadows & Glows
            '--shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.1)',
            '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.1)',
            '--shadow-lg': '0 10px 25px rgba(0, 0, 0, 0.15)',
            '--glow-primary': '0 0 20px rgba(99, 102, 241, 0.2)',
            '--glow-secondary': '0 0 30px rgba(99, 102, 241, 0.15)',
            
            // Gradients
            '--gradient-body': 'linear-gradient(180deg, #ffffff 0%, #f0f2f5 50%, #ffffff 100%)',
            '--gradient-accent': 'linear-gradient(135deg, #6366F1, #8B5CF6)',
            '--gradient-button': 'linear-gradient(135deg, #6366F1, #4F46E5)',
        }
    },

    // Current theme
    currentTheme: 'canvas',

    /**
     * Initialize theme manager - load saved theme
     */
    async init() {
        try {
            const result = await chrome.storage.local.get(['theme']);
            this.currentTheme = result.theme || 'canvas';
            console.log('ThemeManager: Initialized with theme:', this.currentTheme);
            return this.currentTheme;
        } catch (error) {
            console.error('ThemeManager: Failed to load theme:', error);
            return 'canvas';
        }
    },

    /**
     * Apply theme to a specific element (for content scripts/shadow DOM)
     * @param {HTMLElement} element - The root element to apply theme to
     * @param {string} themeName - Theme name (canvas, dark, light)
     */
    applyToElement(element, themeName = null) {
        const theme = this.themes[themeName || this.currentTheme];
        if (!theme || !element) return;

        // Apply all CSS variables to the element
        Object.entries(theme).forEach(([property, value]) => {
            if (property.startsWith('--')) {
                element.style.setProperty(property, value);
            }
        });

        // Set data attribute for CSS selectors
        element.setAttribute('data-theme', themeName || this.currentTheme);
        
        console.log('ThemeManager: Applied theme to element:', themeName || this.currentTheme);
    },

    /**
     * Apply theme to document root (for popup, options pages)
     * @param {string} themeName - Theme name (canvas, dark, light)
     */
    applyToDocument(themeName = null) {
        const theme = this.themes[themeName || this.currentTheme];
        if (!theme) return;

        const root = document.documentElement;
        
        // Apply all CSS variables
        Object.entries(theme).forEach(([property, value]) => {
            if (property.startsWith('--')) {
                root.style.setProperty(property, value);
            }
        });

        // Set data attribute on body for additional CSS targeting
        document.body.setAttribute('data-theme', themeName || this.currentTheme);
        
        // Apply body background gradient
        if (theme['--gradient-body']) {
            document.body.style.background = theme['--gradient-body'];
        }

        console.log('ThemeManager: Applied theme to document:', themeName || this.currentTheme);
    },

    /**
     * Save and apply new theme
     * @param {string} themeName - Theme name to save and apply
     */
    async setTheme(themeName) {
        if (!this.themes[themeName]) {
            console.error('ThemeManager: Unknown theme:', themeName);
            return false;
        }

        try {
            // Save to storage
            await chrome.storage.local.set({ theme: themeName });
            this.currentTheme = themeName;
            
            // Notify all parts of the extension
            chrome.runtime.sendMessage({
                type: 'THEME_CHANGED',
                theme: themeName
            }).catch(() => {
                // Ignore errors if no listeners
            });

            console.log('ThemeManager: Theme saved and broadcasted:', themeName);
            return true;
        } catch (error) {
            console.error('ThemeManager: Failed to save theme:', error);
            return false;
        }
    },

    /**
     * Get CSS variables as a style string (for injecting into shadow DOM)
     * @param {string} themeName - Theme name
     * @returns {string} CSS variables as style content
     */
    getThemeCSS(themeName = null) {
        const theme = this.themes[themeName || this.currentTheme];
        if (!theme) return '';

        let css = ':host {\n';
        Object.entries(theme).forEach(([property, value]) => {
            if (property.startsWith('--')) {
                css += `  ${property}: ${value};\n`;
            }
        });
        css += '}\n';
        
        return css;
    },

    /**
     * Listen for theme changes from other parts of extension
     * @param {function} callback - Called when theme changes
     */
    onThemeChange(callback) {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'THEME_CHANGED' && message.theme) {
                this.currentTheme = message.theme;
                callback(message.theme);
            }
        });

        // Also listen for storage changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.theme) {
                this.currentTheme = changes.theme.newValue;
                callback(changes.theme.newValue);
            }
        });
    },

    /**
     * Get theme display name
     * @param {string} themeName - Theme key
     * @returns {string} Display name
     */
    getThemeName(themeName = null) {
        const theme = this.themes[themeName || this.currentTheme];
        return theme?.name || 'Unknown';
    },

    /**
     * Get all available themes
     * @returns {Array} Array of {key, name} objects
     */
    getAvailableThemes() {
        return Object.entries(this.themes).map(([key, theme]) => ({
            key,
            name: theme.name
        }));
    }
};

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemeManager;
}