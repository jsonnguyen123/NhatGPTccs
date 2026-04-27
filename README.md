# Canvas AI Assistant - Chrome Extension

A comprehensive Chrome extension that integrates an AI-powered chatbot with Canvas LMS to help students organize assignments, track grades, and manage their academic workflow.

## Features

- **AI Chatbot Integration**: Powered by OpenAI GPT-4o for intelligent academic assistance
- **Canvas Data Extraction**: Seamlessly extracts course information, assignments, and grades
- **Smart Organization**: Helps students prioritize tasks and manage deadlines
- **Real-time Updates**: Syncs with Canvas to provide current academic information
- **SSO Authentication**: Leverages existing Canvas session cookies for secure access

## Architecture

### Frontend Components
- **Content Script**: Injects into Canvas pages to extract data using existing session
- **Popup UI**: Quick access interface with Canvas-matching design
- **Chatbot Interface**: Interactive AI assistant with conversation history
- **Options Page**: Extension settings and configuration

### Backend Services
- **API Server**: Handles data storage and AI processing
- **Database**: Stores user preferences and chat history
- **OpenAI Integration**: GPT-4o for multilingual, multimodal responses

## Installation & Setup

### Prerequisites
- Chrome Browser
- Canvas LMS account with SSO authentication
- OpenAI API key (optional, for AI features)

### Installation Steps

1. **Backend Setup** (Required for AI features)
   ```bash
   # Navigate to backend directory
   cd backend
   
   # Install dependencies
   npm install
   
   # Configure environment
   cp .env.example .env
   # Edit .env with your OpenAI API key
   
   # Start server
   npm start
   ```

2. **Extension Installation**
   ```bash
   # Load unpacked extension in Chrome
   chrome://extensions/ → Enable Developer Mode → Load unpacked
   Select the extension directory
   ```

3. **Canvas Integration**
   - Navigate to your Canvas dashboard
   - The extension will automatically detect Canvas pages
   - Grant necessary permissions when prompted

## Usage

### Accessing the Chatbot
1. Click the extension icon in Chrome toolbar
2. Select "Open AI Assistant" from the popup
3. The chatbot interface will appear as an overlay on Canvas

### Available Commands
- "Show my assignments for this week"
- "What's my current grade in [Course Name]?"
- "List upcoming deadlines"
- "Summarize my course progress"
- "Help me prioritize my tasks"

### Data Privacy
- All data extraction happens locally in your browser
- No Canvas credentials are stored or transmitted
- Chat history is optionally stored for session continuity
- OpenAI API calls are made securely with your own API key

## Technical Implementation

### Content Script Strategy
The extension uses content scripts injected into Canvas pages to:
- Access DOM elements containing course data
- Read JavaScript variables from Canvas scripts
- Extract metadata from `<meta>` tags
- Utilize existing session cookies for authentication

### Data Extraction Methods
- Course information from dashboard navigation
- Assignment details from course pages
- Grade data from gradebook sections
- Calendar events and deadlines
- Announcements and notifications

### AI Integration
- OpenAI GPT-4o for natural language processing
- Context-aware responses based on Canvas data
- Multilingual support for international students
- Multimodal capabilities for image-based queries

## Troubleshooting

### Common Issues
1. **Extension not detecting Canvas**: Ensure you're logged into Canvas
2. **AI features not working**: Check OpenAI API key configuration
3. **Data not syncing**: Refresh the Canvas page and try again
4. **Chatbot unresponsive**: Verify backend server is running

### Canvas Compatibility
- Tested with Canvas LMS versions 2024.1+
- Compatible with institutional SSO systems
- Works with custom Canvas themes

## Development

### Project Structure
```
canvas-ai-assistant/
├── extension/
│   ├── manifest.json
│   ├── content.js
│   ├── popup/
│   ├── chatbot/
│   └── options/
├── backend/
│   ├── server.js
│   ├── api/
│   └── database/
└── documentation/
```

### Contributing
1. Fork the repository
2. Create a feature branch
3. Implement changes
4. Test thoroughly
5. Submit pull request

## License

MIT License - See LICENSE file for details

## Support

For technical support or feature requests:
- GitHub Issues: Report bugs and suggest features
- Documentation: Check the `/documentation` folder
- Canvas Community: Share experiences with other users

---

**Note**: This extension is designed to work within Canvas LMS terms of service and respects user privacy. Always ensure compliance with your institution's policies when using third-party tools with Canvas.