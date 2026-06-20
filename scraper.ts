import * as fs from 'fs';
import * as path from 'path';

function walkDir(dir: string, callback: (path: string) => void) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const files: string[] = [];
walkDir('./src', (p) => {
  if (p.endsWith('.ts')) files.push(p);
});

let output = '# Bimax Feature & Component Dictionary\n\n';

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  let hasFeature = false;
  let fileSummary = `## ${file}\n`;

  // Extract file header comments
  const headerMatch = content.match(/^\/\*\*[\s\S]*?\*\//);
  if (headerMatch && !headerMatch[0].includes('eslint')) {
    fileSummary += `**Module Doc:** ${headerMatch[0].replace(/\/\*\*|\*\/|\*/g, '').trim().replace(/\n/g, ' ')}\n\n`;
    hasFeature = true;
  }

  // Extract tools
  const toolMatch = content.matchAll(/name:\s*['"]([^'"]+)['"][\s\S]*?description:\s*`([^`]+)`/g);
  for (const match of toolMatch) {
    const name = match[1];
    const desc = match[2].trim().replace(/\n/g, ' ');
    fileSummary += `- **Tool [${name}]**: ${desc.substring(0, 200)}...\n`;
    hasFeature = true;
  }
  
  // Extract tools with string descriptions
  const toolMatch2 = content.matchAll(/name:\s*['"]([^'"]+)['"][\s\S]*?description:\s*['"]([^'"]+)['"]/g);
  for (const match of toolMatch2) {
    const name = match[1];
    const desc = match[2].trim().replace(/\n/g, ' ');
    fileSummary += `- **Tool [${name}]**: ${desc.substring(0, 200)}...\n`;
    hasFeature = true;
  }

  // Extract classes and their JSDoc
  const classMatches = content.matchAll(/(?:\/\*\*([\s\S]*?)\*\/\s*)?(?:export )?class\s+([A-Za-z0-9_]+)/g);
  for (const match of classMatches) {
    const jsdoc = match[1] ? match[1].replace(/\/\*\*|\*\/|\*/g, '').trim().replace(/\n/g, ' ') : 'No description.';
    const name = match[2];
    fileSummary += `- **Class [${name}]**: ${jsdoc.substring(0, 300)}\n`;
    hasFeature = true;
  }

  // Extract key functions with JSDoc
  const funcMatches = content.matchAll(/(?:\/\*\*([\s\S]*?)\*\/\s*)(?:export )?function\s+([A-Za-z0-9_]+)/g);
  for (const match of funcMatches) {
    const jsdoc = match[1] ? match[1].replace(/\/\*\*|\*\/|\*/g, '').trim().replace(/\n/g, ' ') : '';
    const name = match[2];
    fileSummary += `- **Function [${name}]**: ${jsdoc.substring(0, 300)}\n`;
    hasFeature = true;
  }

  if (hasFeature) {
    output += fileSummary + '\n';
  }
}

fs.writeFileSync('/Users/vishsiddharth/Desktop/Bimax-All-Features.md', output);
console.log('Done mapping 294 files to Bimax-All-Features.md');
