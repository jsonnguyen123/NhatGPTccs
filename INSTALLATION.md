# Canvas AI Assistant - Installation Guide

## 📦 Installation Package Contents

Your Canvas AI Assistant package includes:

```
canvas-ai-assistant/
├── extension/                 # Chrome Extension Files
│   ├── manifest.json         # Extension configuration
│   ├── background.js         # Service worker
│   ├── content.js            # Canvas data extraction
│   ├── content-styles.css    # Chatbot styling
│   ├── popup/                # Extension popup UI
│   ├── options/              # Settings page
│   ├── chatbot/              # AI chatbot interface
│   └── icons/                # Extension icons
├── backend/                  # API Server
│   ├── server.js             # Main server file
│   ├── package.json          # Dependencies
│   ├── .env.example          # Environment template
│   └── logs/                 # Server logs
├── README.md                 # Project overview
├── SETUP_GUIDE.md            # Detailed setup instructions
├── TECHNICAL_DOCUMENTATION.md # Technical details
└── INSTALLATION.md           # This file
```

## 🚀 Quick Installation

### Option 1: Complete Installation (Recommended)

1. **Extract the package** to a location on your computer
2. **Follow the SETUP_GUIDE.md** for detailed backend and extension setup
3. **Configure your OpenAI API key** for full AI features

### Option 2: Extension Only (Basic Features)

If you only want the basic Canvas integration without AI features:

1. **Navigate to** `chrome://extensions/`
2. **Enable "Developer mode"**
3. **Click "Load unpacked"**
4. **Select the `extension/` folder**
5. **The extension will work** with offline AI responses

## ⚙️ Configuration Files

### Backend Configuration

Before starting the backend server, create a `.env` file in the backend directory:

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your settings:
```env
# Required
OPENAI_API_KEY=your_api_key_here

# Optional customizations
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

### Extension Configuration

The extension is pre-configured but you can modify:

- **manifest.json**: Permissions, version, API endpoints
- **Popup settings**: UI customization in `popup/popup.css`
- **Chatbot styling**: Modify `content-styles.css`

## 🔧 Backend Setup

### Prerequisites
- Node.js 16+ and npm
- OpenAI API key (for AI features)

### Installation Steps

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
   # Edit .env with your OpenAI API key
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

5. **Verify server is running:**
   - Visit `http://localhost:3000/api/health`
   - Should return server status

## 🎯 Extension Setup

### Chrome Installation

1. **Open Chrome Extensions page:**
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle switch)

2. **Load the extension:**
   - Click "Load unpacked"
   - Select the `extension/` folder from your extracted package
   - Extension icon should appear in toolbar

3. **Verify installation:**
   - Click the extension icon
   - Should see the Canvas AI Assistant popup
   - Icon should be active when on Canvas pages

### Configuration

1. **Open extension options:**
   - Right-click extension icon → "Options"
   - Or click "Settings" in popup

2. **Configure AI settings:**
   - Enter OpenAI API key
   - Select AI model (GPT-4o recommended)
   - Adjust creativity settings

3. **General settings:**
   - Enable auto-sync
   - Choose theme preference
   - Configure notifications

## 📱 Usage Instructions

### Basic Usage

1. **Navigate to Canvas** (any instructure.com domain)
2. **Click extension icon** in Chrome toolbar
3. **Select "Open AI Chat"** to start chatbot

### Chat Commands

- **"Show my assignments"** - List upcoming assignments
- **"What's my grade in [course]?"** - Course grade information
- **"Help me prioritize"** - Task prioritization suggestions
- **"List my courses"** - Current course overview

### Popup Features

- **Quick Actions**: Direct access to main features
- **Recent Activity**: Upcoming assignments display
- **Statistics**: Course and assignment counts
- **Status Indicators**: Connection and sync status

## 🔒 Security Considerations

### Data Privacy
- All Canvas data stored locally
- No credentials transmitted
- OpenAI API key stored securely
- Session-based authentication only

### Network Security
- HTTPS required for all connections
- CORS properly configured
- Rate limiting implemented
- Input validation on all endpoints

## 🛠️ Troubleshooting

### Common Issues

**Extension not working:**
- Verify on Canvas instructure.com domain
- Check that you're logged into Canvas
- Ensure backend server is running (for AI features)

**AI features not working:**
- Verify OpenAI API key is configured
- Check backend server connectivity
- Review browser console for errors

**Data not syncing:**
- Refresh Canvas page
- Click "Refresh Data" in popup
- Check browser storage permissions

### Debug Mode

Enable detailed logging:
1. Open extension background page
2. Check console for error messages
3. Review network tab for API calls

## 📊 Performance

### Optimization Features
- Efficient DOM querying
- Smart data updates
- Background processing
- Memory management
- Rate limiting

### Resource Usage
- Minimal Canvas page impact
- Local data storage
- Efficient API calls
- Automatic cleanup

## 🔄 Updates

### Updating the Extension
1. Download latest package
2. Replace existing files
3. Reload extension in Chrome
4. Reconfigure settings if needed

### Updating Backend
1. Stop current server
2. Replace backend files
3. Run `npm install` for new dependencies
4. Restart server

## 📞 Support

For installation support:
1. Check SETUP_GUIDE.md for detailed instructions
2. Review TECHNICAL_DOCUMENTATION.md for technical details
3. Verify all prerequisites are met
4. Check browser console for error messages

---

**Note**: This installation package provides a complete Canvas AI Assistant solution with full AI capabilities. The extension respects Canvas terms of service and user privacy. Always ensure compliance with your institution's policies.