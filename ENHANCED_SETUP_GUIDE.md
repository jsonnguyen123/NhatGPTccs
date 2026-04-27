# Canvas AI Assistant - Enhanced Setup Guide

This guide covers the new authentication system with Canvas token setup and improved OpenAI key management.

## 🔐 New Authentication System

### Canvas Token Authentication

Instead of using browser session cookies, the extension now uses Canvas API tokens for authentication. This provides:

- **Better Security**: Dedicated API tokens with limited permissions
- **Longer Sessions**: Tokens can be configured with extended expiration
- **Granular Control**: You control exactly what the extension can access
- **Institution Compatibility**: Works with all Canvas instances that support API access

### OpenAI Key Management Improvements

The new system provides multiple options for OpenAI API key setup:

1. **Manual Setup** (Recommended): Get your own API key from OpenAI
2. **Institution Key**: Use your school's organization API key if available
3. **Guided Setup**: Step-by-step instructions for each option

## 🚀 Enhanced Setup Process

### Step 1: Canvas Token Setup

1. **Log into Canvas**
   - Navigate to your Canvas dashboard
   - Click on "Account" in the left sidebar
   - Select "Settings"

2. **Generate API Token**
   - Scroll down to "Approved Integrations" section
   - Click "+ New Access Token"
   - Name: "Canvas AI Assistant"
   - Expires: Set to 1 year for convenience
   - Click "Generate Token"

3. **Copy and Save Token**
   - Copy the generated token (it starts with a long string)
   - **Important**: Save this token securely - you won't be able to see it again

4. **Enter in Extension**
   - Open extension options (right-click extension icon → Options)
   - Navigate to "Authentication" tab
   - Paste your Canvas token in the "Canvas API Token" field
   - Click "Test Token" to verify
   - Click "Save Token" to store it

### Step 2: OpenAI Key Setup

1. **Choose Setup Method**
   - **Option A: Personal Account** (Recommended)
     - Visit https://platform.openai.com/api-keys
     - Sign up or log in to OpenAI
     - Click "Create new secret key"
     - Copy the key immediately (you won't see it again)
   
   - **Option B: Institution Key**
     - Contact your IT department
     - Request access to your school's OpenAI organization
     - Get the organization API key

2. **Configure in Extension**
   - In the extension options, go to "Authentication" tab
   - Choose your preferred setup method
   - Follow the guided instructions
   - Enter your OpenAI key
   - Test and save the key

### Step 3: Complete Setup

1. **Verify Authentication**
   - Both Canvas token and OpenAI key should show as "✅" in the status
   - The authentication indicator should be green

2. **Configure AI Settings**
   - Navigate to "AI Configuration" tab
   - Select your preferred AI model (GPT-4o recommended)
   - Adjust creativity and response length settings

3. **Test the Extension**
   - Visit your Canvas dashboard
   - Click the extension icon
   - Open the AI chatbot
   - Ask about your assignments or grades

## 📋 Canvas Token Management

### Token Security
- **Store Securely**: Keep your token in a password manager
- **Limited Scope**: Token only has read access to your Canvas data
- **Expiration**: Set expiration based on your preference (1 year recommended)
- **Revocation**: You can revoke the token anytime in Canvas settings

### Token Renewal
When your token expires:
1. Generate a new token in Canvas
2. Update the token in extension options
3. Test the new token
4. Save the changes

## 🤖 OpenAI Key Options

### Personal API Key (Recommended)
**Pros:**
- Full control over usage and billing
- Access to latest models and features
- Can set custom usage limits
- Free tier available for testing

**Cons:**
- Requires personal OpenAI account
- You're responsible for usage costs

**Setup Steps:**
1. Visit https://platform.openai.com/api-keys
2. Create account or sign in
3. Add payment method (required for usage)
4. Generate API key
5. Set usage limits in billing settings
6. Copy key to extension

### Institution Key
**Pros:**
- No personal account needed
- Institution handles billing
- May have higher rate limits
- Centralized management

**Cons:**
- Limited availability
- May have usage restrictions
- Dependent on institution policies

**Setup Steps:**
1. Contact IT department
2. Request OpenAI organization access
3. Get organization API key
4. Configure usage permissions
5. Add to extension

## 🎯 Usage Instructions

### Basic Usage
1. **Navigate to Canvas** (any instructure.com domain)
2. **Click extension icon** in Chrome toolbar
3. **Check authentication status** in the popup
4. **Open AI Chat** to start interacting with the assistant

### Chat Commands
- **"Show my assignments"** - List upcoming assignments with deadlines
- **"What's my grade in [course name]?"** - Get current grade information
- **"Help me prioritize"** - Get AI-powered task prioritization
- **"List my courses"** - See all current courses
- **"What deadlines do I have this week?"** - Weekly deadline overview

### Popup Features
- **Authentication Status**: Quick view of Canvas and OpenAI connectivity
- **Recent Activity**: Upcoming assignments with urgency indicators
- **Quick Stats**: Course and assignment counts
- **Direct Access**: One-click access to chatbot and settings

## 🔧 Troubleshooting

### Authentication Issues

**Canvas Token Problems:**
- **Invalid Token**: Regenerate token in Canvas settings
- **Expired Token**: Generate new token with longer expiration
- **Permission Errors**: Ensure token has read access to courses and assignments
- **Token Format**: Should be a long string starting with random characters

**OpenAI Key Issues:**
- **Invalid Key**: Verify key starts with "sk-" and is complete
- **Rate Limits**: Check usage in OpenAI dashboard
- **Billing Issues**: Ensure payment method is added and valid
- **Model Access**: Verify your account has access to selected model

### Extension Issues

**Not Detecting Canvas:**
- Ensure you're on instructure.com domain
- Check that Canvas is fully loaded
- Try refreshing the page
- Verify extension has necessary permissions

**Chatbot Not Working:**
- Check authentication status in popup
- Verify backend server is running (if using local backend)
- Check browser console for error messages
- Ensure Canvas token has proper permissions

**Data Not Syncing:**
- Check Canvas token is valid and saved
- Verify you're on a Canvas page with accessible data
- Try refreshing the Canvas page
- Check extension permissions

## 🛡️ Security & Privacy

### Canvas Token Security
- **Local Storage**: Token stored only in your browser
- **Encrypted Storage**: Uses Chrome's secure storage
- **No Transmission**: Token never sent to external servers
- **Scoped Access**: Read-only access to Canvas data
- **User Control**: You can revoke token anytime

### OpenAI Key Security
- **Local Storage**: Key stored securely in browser
- **No Sharing**: Key never shared with third parties
- **Usage Control**: You control API usage and costs
- **Secure Communication**: HTTPS-only API calls

### Privacy Features
- **Anonymous Mode**: Option to disable usage analytics
- **Local Data**: All Canvas data stored locally
- **No Tracking**: No user behavior tracking
- **Data Export**: Export your data anytime
- **Automatic Cleanup**: Old data automatically removed

## 📊 Performance & Limits

### Canvas API Limits
- **Rate Limiting**: Canvas has API rate limits (currently 3000 requests per hour)
- **Token Expiration**: Tokens expire based on your configuration
- **Permission Scope**: Limited to read-only access you grant

### OpenAI API Limits
- **Rate Limits**: Depend on your account type and usage
- **Usage Costs**: Charged based on tokens processed
- **Model Access**: Based on your account permissions
- **Free Tier**: Available for testing and light usage

### Extension Performance
- **Efficient Updates**: Only syncs changed data
- **Background Processing**: Heavy operations in service worker
- **Memory Management**: Automatic cleanup of old data
- **Optimized Queries**: Smart Canvas data extraction

## 🚀 Advanced Features

### AI Configuration
- **Model Selection**: Choose between GPT-4o, GPT-4, or GPT-3.5
- **Creativity Control**: Adjust response randomness
- **Response Length**: Set maximum token limits
- **Context Awareness**: Uses Canvas data for personalized responses

### Settings Customization
- **Theme Options**: Canvas, light, dark, or system theme
- **Language Support**: Multiple language options
- **Notification Preferences**: Control alert types
- **Auto-Sync**: Automatic Canvas data synchronization
- **Privacy Controls**: Data collection and storage preferences

### Data Management
- **Export Data**: Download your Canvas data and settings
- **Clear Data**: Remove all stored information
- **Reset Settings**: Return to default configuration
- **Backup/Restore**: Save and restore extension state

## 📞 Support & Resources

### Getting Help
1. **Check Documentation**: Review setup guides and troubleshooting
2. **Verify Prerequisites**: Ensure all requirements are met
3. **Check Authentication**: Verify Canvas token and OpenAI key
4. **Browser Console**: Look for error messages
5. **Community Support**: Check for similar issues

### Useful Links
- [Canvas API Documentation](https://canvas.instructure.com/doc/api/)
- [OpenAI Platform](https://platform.openai.com/)
- [Chrome Extension Development](https://developer.chrome.com/docs/extensions/)

### Contact & Feedback
- **Bug Reports**: Use the extension's issue reporting feature
- **Feature Requests**: Submit through the extension options
- **General Feedback**: Available in the About section

## 🔮 Future Enhancements

### Planned Features
- **Mobile App**: Companion mobile application
- **Advanced Analytics**: Detailed academic performance insights
- **Study Groups**: Collaborative features for group projects
- **Calendar Integration**: Sync with external calendar apps
- **Voice Commands**: Voice-activated AI assistant

### Roadmap
- **Short Term**: Enhanced authentication, improved UI/UX
- **Medium Term**: Mobile support, advanced analytics
- **Long Term**: AI tutoring, career guidance, global expansion

---

**Note**: This enhanced authentication system provides better security, more options, and improved user experience while maintaining the privacy-first approach of the original design.