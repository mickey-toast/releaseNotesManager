# Electron macOS App Setup

This directory contains the Electron configuration for packaging the Confluence Release Manager as a macOS application.

## Building the macOS App

1. **Install dependencies:**
   ```bash
   npm run install:all
   npm install
   ```

2. **Build the React client:**
   ```bash
   npm run build
   ```

3. **Build the macOS app:**
   ```bash
   npm run build:mac
   ```

   This will create:
   - A `.dmg` file in the `dist` folder (for distribution)
   - A `.zip` file in the `dist` folder (alternative distribution format)
   - The `.app` bundle will be inside the DMG

4. **To test the Electron app locally (without building):**
   ```bash
   npm run build  # Build the React app first
   npm run electron
   ```

## App Icon

To add a custom icon:
1. Create an `icon.icns` file (macOS icon format)
2. Place it in the `electron/` directory
3. You can convert PNG to ICNS using tools like:
   - `iconutil` (built into macOS)
   - Online converters
   - Image2icon app

## Environment Variables

The app will look for a `.env` file in the application's resources directory. Users should:
1. Copy `.env.example` to `.env` in the app bundle (or create it manually)
2. Configure their Confluence API credentials

For a production app, you might want to add a settings UI instead of requiring manual `.env` editing.

## Distribution

After building, the `.dmg` file in the `dist` folder can be:
- Shared directly with users
- Uploaded to a file sharing service
- Distributed via your internal tools

Users can drag the app from the DMG to their Applications folder.
