import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Markdown from 'ink-markdown';
import chalk from 'chalk';

const ACCENT = '#D77757';

export function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [asking, setAsking] = useState<{ question: string; options: string[]; resolve: (val: string) => void } | null>(null);

  // Fake initial greeting
  useEffect(() => {
    setMessages([
      { role: 'assistant', content: 'Welcome to BiMax (Ink Edition)! Type something.' }
    ]);
  }, []);

  const handleSubmit = () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
    
    // Simulate engine response
    setTimeout(() => {
      if (input.toLowerCase().includes('ask')) {
        setAsking({
          question: 'Are you enjoying the Ink TUI experiment?',
          options: ['Yes, it is great!', 'No, I miss Go', 'Cancel'],
          resolve: (val: string) => {
            setMessages(prev => [...prev, { role: 'assistant', content: `You selected: ${val}` }]);
            setAsking(null);
          }
        });
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `Echo: ${input}` }]);
      }
    }, 500);
  };

  return (
    <Box flexDirection="column" width="100%">
      <Box padding={1} borderStyle="round" borderColor="#5A5A5A">
        <Text bold color={ACCENT}>BiMax INK EXPERIMENT</Text>
      </Box>

      <Box flexDirection="column" paddingY={1} paddingX={2}>
        {messages.map((m, i) => (
          <Box key={i} marginBottom={1} flexDirection="row">
            {m.role === 'user' ? (
              <Text bold color={ACCENT}>❯ </Text>
            ) : (
              <Text color="#50C850">⏺ </Text>
            )}
            <Box paddingLeft={1}>
              {m.role === 'user' ? (
                <Text bold color="#E6E6E6">{m.content}</Text>
              ) : (
                <Markdown>{m.content}</Markdown>
              )}
            </Box>
          </Box>
        ))}
      </Box>

      {asking ? (
        <AskBox asking={asking} />
      ) : (
        <Box borderStyle="round" borderColor="#5A5A5A" paddingX={1}>
          <Text bold color={ACCENT}>❯ </Text>
          <Box paddingLeft={1} flexGrow={1}>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Message BiMax..."
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Minimal AskBox mock
function AskBox({ asking }: { asking: any }) {
  const [selected, setSelected] = useState(0);

  // We need useInput from 'ink' for raw key handling, but for brevity we'll just mock the visual part 
  // and accept number keys for now in this proof of concept.
  const { useInput } = require('ink');
  
  useInput((input: string, key: any) => {
    if (key.upArrow) {
      setSelected(Math.max(0, selected - 1));
    } else if (key.downArrow) {
      setSelected(Math.min(asking.options.length, selected + 1));
    } else if (key.return) {
      if (selected === asking.options.length) {
        asking.resolve("Type-in response (mock)");
      } else {
        asking.resolve(asking.options[selected]);
      }
    } else if (key.escape) {
      asking.resolve("Dismissed");
    }
  });

  return (
    <Box borderStyle="round" borderColor={ACCENT} paddingX={1} flexDirection="column">
      <Text color={ACCENT} bold>⚠ {asking.question}</Text>
      
      <Box flexDirection="column" paddingLeft={2} marginTop={1}>
        {asking.options.map((opt: string, i: number) => (
          <Box key={i}>
            <Text color={i === selected ? ACCENT : undefined}>
              {i === selected ? '❯ ' : '  '}
              {i === selected ? chalk.hex(ACCENT).bold(`${i + 1}) `) : `${i + 1}) `}
              {opt}
            </Text>
          </Box>
        ))}
        
        <Box>
          <Text color={selected === asking.options.length ? ACCENT : undefined}>
            {selected === asking.options.length ? '❯ ' : '  '}
            {selected === asking.options.length ? chalk.hex(ACCENT).bold(`${asking.options.length + 1}) `) : `${asking.options.length + 1}) `}
            Explain your answer:
          </Text>
        </Box>
        {selected === asking.options.length && (
          <Box paddingLeft={4}>
            <Text dimColor>Type your own answer...</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ navigate · enter to submit · esc to dismiss</Text>
      </Box>
    </Box>
  );
}
