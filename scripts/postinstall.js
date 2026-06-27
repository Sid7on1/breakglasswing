#!/usr/bin/env node

/**
 * Post-install setup for bimax CLI.
 * Creates default .breakglass/config.json if it doesn't exist.
 * Prints welcome message with setup instructions.
 */

const fs = require('fs');
const path = require('path');

const breakglassDir = path.join(process.cwd(), '.breakglass');
const configPath = path.join(breakglassDir, 'config.json');

if (fs.existsSync(configPath)) {
  process.exit(0);
}

const DEFAULT_CONFIG = {
  defaultAgent: 'bimax',
  model: 'meta/llama-3.1-70b-instruct',
  timeout: 120000,
  temperature: 0.7,
  maxTokens: 4096,
  theme: 'dark',
  verbose: false,
  dangerouslySkipPermissions: false,
  skipSemanticMetadata: false,
  autoIndex: true,
  excludeFromIndex: ['**/*.test.ts', '**/node_modules/**'],
  maxToolIterations: 20,
  maxSubAgents: 3,
  notificationBell: true,
  customRoutingRules: [],
};

try {
  fs.mkdirSync(breakglassDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
} catch (e) {
  // Non-fatal — config will be created on first run
}

console.log('');
console.log('╔═══════════════════════════════════════════════════════╗');
console.log('║                BiMax — Terminal AI Agent             ║');
console.log('╠═══════════════════════════════════════════════════════╣');
console.log('║  Thank you for installing!                           ║');
console.log('║                                                       ║');
console.log('║  To get started:                                     ║');
console.log('║                                                       ║');
console.log('║  1. Set an API key:                                   ║');
console.log('║     export NVIDIA_API_KEY="your-key-here"             ║');
console.log('║     (or OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)      ║');
console.log('║                                                       ║');
console.log('║  2. Run:                                              ║');
console.log('║     bimax                                              ║');
console.log('║                                                       ║');
console.log('║  3. Or run with a prompt:                             ║');
console.log('║     bimax "explain this dir" --print                   ║');
console.log('║                                                       ║');
console.log('║  Full docs: https://bimax.ai/docs                    ║');
console.log('╚═══════════════════════════════════════════════════════╝');
console.log('');
