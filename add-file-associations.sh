#!/bin/bash

# Add file associations to macOS app Info.plist
APP_PLIST="src-tauri/target/release/bundle/macos/MD_RENDER.app/Contents/Info.plist"

if [ ! -f "$APP_PLIST" ]; then
  echo "Error: Info.plist not found at $APP_PLIST"
  exit 1
fi

# Check if CFBundleDocumentTypes already exists
if ! grep -q "CFBundleDocumentTypes" "$APP_PLIST"; then
  # Add file associations before </dict> closing tag
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes array" "$APP_PLIST"

  # Add markdown association
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0 dict" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 'Markdown Document'" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string 'md'" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:1 string 'markdown'" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeMIMETypes array" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeMIMETypes:0 string 'text/markdown'" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string 'Editor'" "$APP_PLIST"

  # Add text file association
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:1 dict" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:1:CFBundleTypeName string 'Text File'" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:1:CFBundleTypeExtensions array" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:1:CFBundleTypeExtensions:0 string 'txt'" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:1:CFBundleTypeMIMETypes array" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:1:CFBundleTypeMIMETypes:0 string 'text/plain'" "$APP_PLIST"
  /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:1:CFBundleTypeRole string 'Editor'" "$APP_PLIST"

  echo "File associations added successfully"
else
  echo "File associations already exist in Info.plist"
fi
