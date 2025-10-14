import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateMacIcons() {
  const inputPng = path.join(__dirname, '../frontend/public/docsmith-icon.png');
  const outputIcns = path.join(__dirname, '../frontend/public/favicon.icns');
  const tempDir = path.join(__dirname, '../frontend/public/iconset.iconset');

  // macOS icon sizes required for .icns
  const sizes = [
    { size: 16, scale: 1 },
    { size: 16, scale: 2 },
    { size: 32, scale: 1 },
    { size: 32, scale: 2 },
    { size: 128, scale: 1 },
    { size: 128, scale: 2 },
    { size: 256, scale: 1 },
    { size: 256, scale: 2 },
    { size: 512, scale: 1 },
    { size: 512, scale: 2 },
  ];

  // Create iconset directory
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  console.log('🎨 Generating macOS icon set from docsmith-icon.png...');

  // Generate all required PNG sizes
  for (const { size, scale } of sizes) {
    const actualSize = size * scale;
    const filename = scale === 1 
      ? `icon_${size}x${size}.png`
      : `icon_${size}x${size}@${scale}x.png`;
    
    const outputPath = path.join(tempDir, filename);
    
    await sharp(inputPng)
      .resize(actualSize, actualSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outputPath);
    
    console.log(`  ✓ Generated ${filename}`);
  }

  console.log('✅ Icon set generated in:', tempDir);
  console.log('');
  console.log('To complete the .icns creation, run:');
  console.log(`  iconutil -c icns "${tempDir}" -o "${outputIcns}"`);
  console.log('');
  console.log('Note: iconutil is only available on macOS. If on Windows/Linux, you can:');
  console.log('1. Copy the iconset.iconset folder to a Mac');
  console.log('2. Run the iconutil command there');
  console.log('3. Copy the generated favicon.icns back');
  console.log('');
  console.log('Alternatively, for cross-platform builds without signing:');
  console.log('  - Use .png icon (already configured as fallback)');
  console.log('  - Or upload the iconset to an online .icns converter');
}

generateMacIcons().catch(console.error);
