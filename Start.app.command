#!/bin/bash

# Confluence Release Manager - Quick Start Launcher
# Double-click this file to start the application

# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the project directory
cd "$DIR"

# Function to check if a port is in use
check_port() {
    lsof -ti:$1 > /dev/null 2>&1
}

# Check if app is already running
if check_port 3000 || check_port 3001; then
    echo "⚠️  The app appears to be already running!"
    echo ""
    read -p "Do you want to stop it and restart? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Stopping existing processes..."
        lsof -ti:3000 | xargs kill -9 2>/dev/null
        lsof -ti:3001 | xargs kill -9 2>/dev/null
        sleep 2
    else
        echo "Opening existing app in browser..."
        open "http://localhost:3000" 2>/dev/null || echo "Please open http://localhost:3000 in your browser"
        exit 0
    fi
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed!"
    echo ""
    echo "Please install Node.js 18+ from https://nodejs.org/"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "⚠️  Warning: Node.js version 18+ is recommended"
    echo "Current version: $(node -v)"
    echo ""
fi

echo "🚀 Starting Confluence Release Manager..."
echo ""

# Check and install dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing root dependencies (this may take a minute)..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        read -p "Press Enter to exit..."
        exit 1
    fi
    echo ""
fi

if [ ! -d "client/node_modules" ]; then
    echo "📦 Installing client dependencies (this may take a minute)..."
    cd client && npm install && cd ..
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install client dependencies"
        read -p "Press Enter to exit..."
        exit 1
    fi
    echo ""
fi

# Open browser after a short delay
(sleep 5 && open "http://localhost:3000" 2>/dev/null) &

echo "✅ Starting application..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📋 Confluence Release Manager"
echo "  🌐 App URL: http://localhost:3000"
echo "  🔌 Server: http://localhost:3001"
echo ""
echo "  💡 Tip: Keep this window open while using the app"
echo "  🛑 Press Ctrl+C to stop the server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start the application (disable React Scripts auto-browser opening)
BROWSER=none npm run dev

# If we get here, the app was stopped
echo ""
echo "👋 Application stopped"
read -p "Press Enter to close this window..."
