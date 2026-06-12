const fs = require('fs');

let content = fs.readFileSync('src/cli/screens/FullScreen.tsx', 'utf8');

const switchStart = content.indexOf('if (query.startsWith(\'/\')) {');
const switchEnd = content.indexOf('setInput(\'\');\n      return;\n    }', switchStart);

if (switchStart === -1 || switchEnd === -1) {
  console.error('Could not find slash command block');
  process.exit(1);
}

const endOfBlock = switchEnd + 33;

let before = content.slice(0, switchStart);
let slashBlock = content.slice(switchStart, endOfBlock);
let after = content.slice(endOfBlock);

// In the slash block, replace addLog with addSystemMessage
slashBlock = slashBlock.replace(/addLog\(/g, 'addSystemMessage(');
// In the slash block, replace query.split(' ') with query.trim().split(/\s+/)
slashBlock = slashBlock.replace(/query\.split\(' '\)/g, 'query.trim().split(/\\s+/)');
slashBlock = slashBlock.replace(/query\.toLowerCase\(\)\.split\(' '\)/g, 'query.trim().toLowerCase().split(/\\s+/)');

// Insert addSystemMessage definition at the top of handleSubmit
const hsStart = before.indexOf('const handleSubmit = async');
const insertionPoint = before.indexOf('{', hsStart) + 1;

const addSysMsgCode = `
    const addSystemMessage = (level: 'info' | 'error' | 'success' | 'warn', text: string) => {
      let prefix = '';
      if (level === 'error') prefix = '❌ **Error:** ';
      if (level === 'success') prefix = '✅ **Success:** ';
      if (level === 'warn') prefix = '⚠️ **Warning:** ';
      
      cliEvents.emit('message', {
        id: \`sys-\${Date.now()}-\${Math.random()}\`,
        role: 'assistant',
        content: \`\${prefix}\${text}\`,
        timestamp: new Date()
      } as MessageEntry);
    };
`;

before = before.slice(0, insertionPoint) + addSysMsgCode + before.slice(insertionPoint);

fs.writeFileSync('src/cli/screens/FullScreen.tsx', before + slashBlock + after);
console.log('Fixed slash commands block');
