/**
 * Dynamic Icon Selection Script for DocSmith
 * Automatically selects the best icon size based on platform and context
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ICON_SIZES = {
  small: 'docsmith-16.ico',    // System tray, small taskbar
  medium: 'docsmith-32.ico',   // Standard desktop, file explorer
  large: 'docsmith-48.ico',    // Large icon view, installer
  xlarge: 'docsmith-256.ico'   // High-DPI displays, modern Windows
};

const PLATFORM_CONFIGS = {
  win32: {
    app: ICON_SIZES.large,        // 48x48 for main app icon
    installer: ICON_SIZES.large,  // 48x48 for installer
    uninstaller: ICON_SIZES.medium // 32x32 for uninstaller
  },
  darwin: {
    app: ICON_SIZES.xlarge        // macOS prefers higher resolution
  },
  linux: {
    app: ICON_SIZES.large         // 48x48 is standard for Linux
  }
};

function getIconPath(iconKey, platform = 'win32') {
  const config = PLATFORM_CONFIGS[platform];
  const iconFile = config[iconKey] || ICON_SIZES.medium;
  return path.join('frontend', 'public', iconFile);
}

function updatePackageJsonIcons(platform = 'win32') {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  // Update main icon
  packageJson.build.icon = getIconPath('app', platform);
  
  // Update platform-specific icons
  if (platform === 'win32' && packageJson.build.nsis) {
    packageJson.build.nsis.installerIcon = getIconPath('installer', platform);
    packageJson.build.nsis.uninstallerIcon = getIconPath('uninstaller', platform);
  }
  
  // Write back to package.json
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4));
  
  console.log(`✓ Updated icons for ${platform}:`);
  console.log(`  App icon: ${packageJson.build.icon}`);
  if (platform === 'win32') {
    console.log(`  Installer icon: ${packageJson.build.nsis.installerIcon}`);
    console.log(`  Uninstaller icon: ${packageJson.build.nsis.uninstallerIcon}`);
  }
}

function verifyIconsExist() {
  const iconDir = path.join(__dirname, '..', 'frontend', 'public');
  const missingIcons = [];
  
  Object.values(ICON_SIZES).forEach(iconFile => {
    const iconPath = path.join(iconDir, iconFile);
    if (!fs.existsSync(iconPath)) {
      missingIcons.push(iconFile);
    }
  });
  
  if (missingIcons.length > 0) {
    console.error('❌ Missing icon files:');
    missingIcons.forEach(icon => console.error(`  - ${icon}`));
    return false;
  }
  
  console.log('✓ All icon files verified');
  return true;
}

// CLI usage - always run the main logic
const platform = process.argv[2] || process.platform;

console.log('DocSmith Dynamic Icon Builder');
console.log('=============================');

if (!verifyIconsExist()) {
  process.exit(1);
}

updatePackageJsonIcons(platform);
console.log(`\n✓ Configuration updated for ${platform}`);

export {
  getIconPath,
  updatePackageJsonIcons,
  verifyIconsExist,
  ICON_SIZES,
  PLATFORM_CONFIGS
};