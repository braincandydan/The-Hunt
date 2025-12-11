#!/usr/bin/env node
/**
 * Generate PWA icons
 * Run with: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Simple SVG icon - a ski/mountain themed icon
function createIconSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#4f46e5"/>
    </linearGradient>
    <linearGradient id="snow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff"/>
      <stop offset="100%" style="stop-color:#e5e7eb"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#bg)"/>
  <!-- Mountain -->
  <polygon points="${size * 0.15},${size * 0.75} ${size * 0.5},${size * 0.25} ${size * 0.85},${size * 0.75}" fill="url(#snow)"/>
  <!-- Snow cap -->
  <polygon points="${size * 0.35},${size * 0.5} ${size * 0.5},${size * 0.25} ${size * 0.65},${size * 0.5} ${size * 0.55},${size * 0.45} ${size * 0.5},${size * 0.35} ${size * 0.45},${size * 0.45}" fill="#ffffff"/>
  <!-- Ski trail -->
  <path d="M ${size * 0.3} ${size * 0.6} Q ${size * 0.5} ${size * 0.55} ${size * 0.7} ${size * 0.65}" stroke="#6366f1" stroke-width="${size * 0.03}" fill="none" stroke-linecap="round"/>
  <path d="M ${size * 0.35} ${size * 0.68} Q ${size * 0.55} ${size * 0.62} ${size * 0.75} ${size * 0.72}" stroke="#4f46e5" stroke-width="${size * 0.025}" fill="none" stroke-linecap="round"/>
</svg>`;
}

// Create the public directory icons
const publicDir = path.join(__dirname, '..', 'public');

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-180.png', size: 180 },
  { name: 'favicon.svg', size: 32 },
];

// For now, we'll save as SVG since we don't have sharp installed
// These work in modern browsers
sizes.forEach(({ name, size }) => {
  const svg = createIconSVG(size);
  const svgName = name.replace('.png', '.svg');
  const filePath = path.join(publicDir, svgName);
  fs.writeFileSync(filePath, svg);
  console.log(`Created ${svgName}`);
});

console.log('\nNote: SVG icons created. For PNG conversion, install sharp:');
console.log('npm install sharp --save-dev');
console.log('Then run this script again to generate PNGs.');

// Check if sharp is available for PNG conversion
try {
  const sharp = require('sharp');
  console.log('\nSharp detected! Converting to PNG...');
  
  sizes.filter(s => s.name.endsWith('.png')).forEach(async ({ name, size }) => {
    const svg = createIconSVG(size);
    const filePath = path.join(publicDir, name);
    await sharp(Buffer.from(svg)).png().toFile(filePath);
    console.log(`Created ${name}`);
  });
} catch (e) {
  // Sharp not available, SVGs will work
}

console.log('\nIcon generation complete!');

