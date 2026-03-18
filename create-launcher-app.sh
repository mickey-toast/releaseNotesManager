#!/bin/bash

# Create an AppleScript app that launches the server and opens the browser
APP_NAME="Confluence Release Manager"
APP_PATH="$HOME/Applications/${APP_NAME}.app"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Create the app bundle structure
mkdir -p "${APP_PATH}/Contents/MacOS"
mkdir -p "${APP_PATH}/Contents/Resources"

# Create the main executable script
cat > "${APP_PATH}/Contents/MacOS/${APP_NAME}" << 'EOF'
#!/bin/bash

# Get the project directory (assuming script is in the project root)
PROJECT_DIR="/Users/mickey.farmer/Documents/confluence-release-manager"
cd "$PROJECT_DIR"

# Check if server is already running
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null ; then
    open http://localhost:3001
    exit 0
fi

# Check if .env exists
if [ ! -f .env ]; then
    osascript -e 'display dialog "⚠️  .env file not found!\n\nPlease create a .env file with your Confluence credentials." buttons {"OK"} default button "OK" with icon caution'
fi

# Start server in background
cd "$PROJECT_DIR"
npm start > /tmp/confluence-server.log 2>&1 &
SERVER_PID=$!

# Save PID
echo $SERVER_PID > /tmp/confluence-server.pid

# Wait for server to start
sleep 3

# Open browser
open http://localhost:3001

# Show notification
osascript -e "display notification \"Server started on http://localhost:3001\" with title \"Confluence Release Manager\""
EOF

chmod +x "${APP_PATH}/Contents/MacOS/${APP_NAME}"

# Create Info.plist
cat > "${APP_PATH}/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>com.confluence.releasemanager</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
</dict>
</plist>
EOF

# Copy icon if it exists
if [ -f "${SCRIPT_DIR}/electron/icon.icns" ]; then
    cp "${SCRIPT_DIR}/electron/icon.icns" "${APP_PATH}/Contents/Resources/icon.icns"
    # Update Info.plist to use icon
    /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string icon" "${APP_PATH}/Contents/Info.plist" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon" "${APP_PATH}/Contents/Info.plist"
fi

echo "✅ Created launcher app at: ${APP_PATH}"
echo "📋 You can now find '${APP_NAME}' in your Applications folder"
echo ""
echo "To add it to Applications:"
echo "  cp -R '${APP_PATH}' ~/Applications/"
