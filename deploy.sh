#!/bin/bash

# Canvas AI Assistant - Deployment Script
# This script helps set up the Canvas AI Assistant Chrome extension

echo "🎓 Canvas AI Assistant - Deployment Script"
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="16.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please upgrade to 16+ or higher."
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION detected"
echo ""

# Backend setup
echo "🔧 Setting up backend server..."
cd backend

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found in backend directory"
    exit 1
fi

# Install dependencies
echo "📦 Installing backend dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install backend dependencies"
    exit 1
fi

echo "✅ Backend dependencies installed"
echo ""

# Environment configuration
echo "⚙️  Configuring environment..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✅ Created .env file from template"
        echo ""
        echo "📝 IMPORTANT: Please edit the .env file and add your OpenAI API key:"
        echo "   OPENAI_API_KEY=sk-your-actual-api-key-here"
        echo ""
        echo "   You can get an API key from: https://platform.openai.com/api-keys"
        echo ""
    else
        echo "❌ .env.example file not found"
        exit 1
    fi
else
    echo "✅ .env file already exists"
fi

echo ""
echo "🔍 Checking for OpenAI API key..."
if grep -q "OPENAI_API_KEY=your_openai_api_key_here" .env; then
    echo "⚠️  Please update your OpenAI API key in the .env file"
    echo "   Current value is the placeholder 'your_openai_api_key_here'"
    echo ""
elif grep -q "OPENAI_API_KEY=sk-" .env; then
    echo "✅ OpenAI API key appears to be configured"
else
    echo "⚠️  Please verify your OpenAI API key in the .env file"
fi

cd ..
echo ""

# Extension validation
echo "🔍 Validating extension structure..."
if [ ! -f "extension/manifest.json" ]; then
    echo "❌ Extension manifest.json not found"
    exit 1
fi

if [ ! -f "extension/background.js" ]; then
    echo "❌ Extension background.js not found"
    exit 1
fi

if [ ! -f "extension/content.js" ]; then
    echo "❌ Extension content.js not found"
    exit 1
fi

echo "✅ Extension structure validated"
echo ""

# Create logs directory
echo "📁 Setting up logs directory..."
mkdir -p backend/logs
echo "✅ Logs directory created"
echo ""

# Final instructions
echo "🎉 Setup complete! Here's what to do next:"
echo ""
echo "1. BACKEND SETUP:"
echo "   cd backend"
echo "   npm start"
echo "   (The server will start on http://localhost:3000)"
echo ""
echo "2. CHROME EXTENSION SETUP:"
echo "   - Open Chrome and go to: chrome://extensions/"
echo "   - Enable 'Developer mode' (toggle in top right)"
echo "   - Click 'Load unpacked'"
echo "   - Select the 'extension' folder"
echo ""
echo "3. CONFIGURATION:"
echo "   - Click the extension icon in Chrome"
echo "   - Go to Settings → AI Configuration"
echo "   - Enter your OpenAI API key (if not in .env)"
echo "   - Save settings"
echo ""
echo "4. USAGE:"
echo "   - Navigate to your Canvas dashboard"
echo "   - Click the extension icon"
echo "   - Select 'Open AI Chat' to start using the assistant"
echo ""
echo "📚 For detailed instructions, see:"
echo "   - SETUP_GUIDE.md (comprehensive setup guide)"
echo "   - TECHNICAL_DOCUMENTATION.md (technical details)"
echo ""
echo "🔧 For troubleshooting, check:"
echo "   - Browser console for error messages"
echo "   - Backend logs in backend/logs/"
echo "   - Ensure Canvas is loaded before using the extension"
echo ""
echo "✨ Enjoy your Canvas AI Assistant!"