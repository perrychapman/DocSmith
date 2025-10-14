import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pngToIcns = require('png-to-icns');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function convertToIcns() {
  const inputPng = path.join(__dirname, '../frontend/public/docsmith-icon.png');
  const outputIcns = path.join(__dirname, '../frontend/public/favicon.icns');

  console.log('🎨 Converting PNG to ICNS format...');
  console.log(`   Input: ${inputPng}`);
  console.log(`   Output: ${outputIcns}`);

  try {
    const pngBuffer = fs.readFileSync(inputPng);
    const icnsBuffer = await pngToIcns(pngBuffer);
    fs.writeFileSync(outputIcns, icnsBuffer);
    
    console.log('✅ Successfully created favicon.icns');
    console.log(`   Size: ${(icnsBuffer.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error('❌ Failed to convert PNG to ICNS:', error.message);
    process.exit(1);
  }
}

convertToIcns();
