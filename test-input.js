import React, {useState} from 'react';
import {render, Box, Text} from 'ink';
import TextInput from 'ink-text-input';

function App() {
  const [val, setVal] = useState('');
  return (
    <Box flexDirection="column">
      <Text>Value: "{val}"</Text>
      <TextInput value={val} onChange={setVal} focus />
    </Box>
  );
}

render(<App />);
