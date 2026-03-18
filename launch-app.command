#!/bin/bash

# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Check if server is already running
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null ; then
    echo "Server is already running on port 3001"
    open http://localhost:3001
    exit 0
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "Please create a .env file with your Confluence credentials."
    echo ""
    read -p "Press Enter to continue anyway, or Ctrl+C to exit..."
fi

# Start the server in the background
echo "🚀 Starting Confluence Release Manager server..."
npm start > /tmp/confluence-server.log 2>&1 &
SERVER_PID=$!

# Wait a moment for server to start
sleep 3

# Check if server started successfully
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ Failed to start server. Check /tmp/confluence-server.log for errors"
    exit 1
fi

# Save PID to a file so we can kill it later if needed
echo $SERVER_PID > /tmp/confluence-server.pid

echo "✅ Server started (PID: $SERVER_PID)"
echo "📋 Opening browser..."
echo ""
echo "To stop the server, run: kill \$(cat /tmp/confluence-server.pid)"
echo "Or close this terminal window"

# Open browser
open http://localhost:3001

# Keep script running (so terminal window stays open)
wait $SERVER_PID
