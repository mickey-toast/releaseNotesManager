# App Icon

To add a custom icon for the macOS app:

1. **Create an icon file:**
   - Create a 512x512 or 1024x1024 PNG image
   - Name it `icon.png` and place it in this directory

2. **Convert to ICNS format:**
   ```bash
   # Create an iconset directory
   mkdir icon.iconset
   
   # Create different sizes (required for macOS)
   sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
   sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
   sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
   sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
   sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
   sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
   sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
   sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
   sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
   sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
   
   # Convert to ICNS
   iconutil -c icns icon.iconset -o icon.icns
   
   # Clean up
   rm -rf icon.iconset
   ```

3. **Or use an online tool:**
   - Upload your PNG to an online ICNS converter
   - Download the `.icns` file
   - Place it in this directory as `icon.icns`

**Note:** If no icon is provided, Electron will use a default icon. The app will still work fine without a custom icon.
