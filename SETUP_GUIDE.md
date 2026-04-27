# Canvas AI Assistant - Complete Setup Guide

This guide will walk you through setting up the Canvas AI Assistant Chrome extension with full AI capabilities.

## 📋 Prerequisites

Before you begin, ensure you have:
- **Chrome Browser** (latest version recommended)
- **Canvas LMS Account** with SSO authentication
- **Node.js 16+** and **npm** (for backend setup)
- **OpenAI API Key** (optional but recommended for full AI features)

## 🚀 Quick Start

### Step 1: Get Your OpenAI API Key

1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy and securely store your API key

### Step 2: Backend Setup (Required for AI Features)

1. **Navigate to backend directory:**
   ```bash
   cd canvas-ai-assistant/backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

4. **Edit .env file with your OpenAI API key:**
   ```env
   OPENAI_API_KEY=sk-your-actual-api-key-here
   PORT=3000
   NODE_ENV=development
   ```

5. **Start the backend server:**
   ```bash
   npm start
   ```

   The server should start on `http://localhost:3000`

### Step 3: Chrome Extension Installation

1. **Open Chrome Extensions page:**
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)

2. **Load the extension:**
   - Click "Load unpacked"
   - Select the `canvas-ai-assistant/extension` folder
   - The extension should appear in your toolbar

3. **Verify installation:**
   - Click the extension icon
   - You should see the Canvas AI Assistant popup

### Step 4: Configuration

1. **Open extension options:**
   - Right-click the extension icon
   - Select "Options" or click "Settings" in the popup

2. **Configure AI settings:**
   - Navigate to "AI Configuration" tab
   - Enter your OpenAI API key
   - Select your preferred AI model (GPT-4o recommended)
   - Adjust creativity settings as desired

3. **General settings:**
   - Enable "Auto-sync Canvas Data" for automatic updates
   - Choose your preferred theme
   - Configure notification preferences

4. **Save settings** and close the options page

## 🎯 Using the Extension

### Basic Usage

1. **Navigate to Canvas** (any instructure.com domain)
2. **Click the extension icon** in your toolbar
3. **Select "Open AI Chat"** to start the chatbot

### Chatbot Features

- **Assignment Tracking**: "Show my upcoming assignments"
- **Grade Monitoring**: "What's my current grade in [Course Name]?"
- **Task Prioritization**: "Help me prioritize my tasks"
- **Course Information**: "List my current courses"
- **Deadline Management**: "What deadlines do I have this week?"

### Popup Features

- **Quick Stats**: View course and assignment counts
- **Recent Activity**: See upcoming assignments at a glance
- **Status Indicators**: Check connection and sync status
- **Quick Actions**: Direct access to chatbot and data refresh

## 🔧 Advanced Configuration

### Backend Customization

**Environment Variables:**
- `PORT`: Server port (default: 3000)
- `LOG_LEVEL`: Logging verbosity (debug, info, warn, error)
- `RATE_LIMIT_MAX_REQUESTS`: API rate limiting
- `ALLOWED_ORIGINS`: CORS origins for security

**Production Deployment:**
```bash
# Set production environment
export NODE_ENV=production

# Use process manager
npm install -g pm2
pm2 start server.js --name canvas-ai-backend

# Or use systemd
sudo systemctl enable canvas-ai-assistant
```

### Extension Customization

**Manifest Modifications:**
- Update permissions for additional Canvas domains
- Modify content script injection patterns
- Adjust API endpoint URLs

**Styling:**
- Edit `content-styles.css` for chatbot appearance
- Modify `popup.css` for popup UI changes
- Update `options.css` for settings page styling

## 🔒 Security & Privacy

### Data Protection
- **Local Storage**: All Canvas data stored locally in your browser
- **No Credential Storage**: Canvas credentials never stored or transmitted
- **API Key Security**: OpenAI key stored securely in browser storage
- **Session-Based**: Uses existing Canvas session cookies

### Privacy Settings
- **Anonymous Analytics**: Optional usage statistics (disabled by default)
- **Chat History**: Local storage of conversations (configurable)
- **Data Export**: Export your data anytime
- **Data Cleanup**: Automatic cleanup of old data

## 🛠️ Troubleshooting

### Common Issues

**Extension not detecting Canvas:**
- Ensure you're logged into Canvas
- Check that you're on an instructure.com domain
- Refresh the Canvas page
- Verify extension has necessary permissions

**AI features not working:**
- Check backend server is running on localhost:3000
- Verify OpenAI API key is configured in settings
- Check browser console for error messages
- Ensure CORS is properly configured

**Data not syncing:**
- Refresh the Canvas page
- Click "Refresh Data" in the popup
- Check browser storage permissions
- Verify content script is injected

**Chatbot not responding:**
- Check internet connection
- Verify OpenAI API key validity
- Try simpler questions first
- Check rate limits on your OpenAI account

### Debug Mode

Enable detailed logging:
1. Open extension background page (chrome://extensions/ → Inspect views)
2. Check console for detailed error messages
3. Enable verbose logging in settings
4. Check network tab for API calls

## 📊 Performance Optimization

### Backend Optimization
- **Rate Limiting**: Prevents API abuse
- **Compression**: Reduces response size
- **Caching**: In-memory data storage
- **Cleanup Jobs**: Automatic old data removal

### Extension Optimization
- **Lazy Loading**: Content scripts load on demand
- **Efficient DOM Parsing**: Minimal page impact
- **Smart Updates**: Only sync changed data
- **Memory Management**: Proper cleanup of resources

## 🌐 Network Requirements

### Required Connections
- **Canvas LMS**: instructure.com domains
- **Backend API**: localhost:3000 (or configured port)
- **OpenAI API**: api.openai.com (for AI features)

### Firewall Configuration
If behind a corporate firewall, ensure access to:
- `*.instructure.com` (Canvas)
- `localhost:3000` (Backend)
- `api.openai.com` (OpenAI - optional)

## 📱 Mobile Support

The extension is designed for desktop Chrome but can work on:
- Chrome OS devices
- Chrome Remote Desktop
- Chrome on tablets with desktop mode

## 🤝 Contributing

To contribute to the project:
1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License. See the LICENSE file for details.

## 🔗 Additional Resources

- [Canvas LMS Documentation](https://canvas.instructure.com/doc/api/)
- [Chrome Extension Development](https://developer.chrome.com/docs/extensions/)
- [OpenAI API Documentation](https://platform.openai.com/docs/)
- [Express.js Documentation](https://expressjs.com/)

## 📞 Support

For support or questions:
- Check the troubleshooting section above
- Review browser console for error messages
- Verify all setup steps were completed
- Ensure all requirements are met

---

**Note**: This extension is designed to work within Canvas LMS terms of service and respects user privacy. Always ensure compliance with your institution's policies when using third-party tools with Canvas.