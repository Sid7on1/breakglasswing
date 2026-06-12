import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import cliSpinners from 'cli-spinners';
import { cliEvents, AgentState } from '../events';
import { ThemeColors } from '../themes';

const spinners = (cliSpinners as any).default || cliSpinners;

interface AgentSpinnerProps {
  theme: ThemeColors;
}

const STALL_TIMEOUT = 3000;

function lerpColor(from: string, to: string, t: number): string {
  const parse = (c: string) => {
    const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    const named: Record<string, [number, number, number]> = {
      gray: [128, 128, 128], cyan: [0, 255, 255], red: [255, 0, 0],
      orange: [255, 165, 0],
    };
    return named[c] || [128, 128, 128];
  };
  const [fr, fg, fb] = parse(from);
  const [tr, tg, tb] = parse(to);
  const r = Math.round(fr + (tr - fr) * t);
  const g = Math.round(fg + (tg - fg) * t);
  const bl = Math.round(fb + (tb - fb) * t);
  return `rgb(${r},${g},${bl})`;
}

function ShimmerText({ text, color, stallProgress }: { text: string; color: string; stallProgress: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => f + 1), 60);
    return () => clearInterval(t);
  }, []);

  const len = text.length;
  // Shimmer sweeps from -5 to len+5
  const shimmerPos = (frame % (len + 20)) - 5;
  const chars = text.split('');
  
  const stallColor = stallProgress > 0 ? lerpColor(color, 'rgb(255,0,0)', stallProgress) : color;

  return (
    <Text>
      {chars.map((char, i) => {
        const dist = Math.abs(i - shimmerPos);
        const isHighlight = dist < 2;
        // If it's highlighted, we dim it or brighten it (brighten by using text color or white)
        // Here we just use the base color, but if isHighlight, use white
        if (stallProgress > 0.5) return <Text key={i} color={stallColor}>{char}</Text>;
        return (
          <Text key={i} color={isHighlight ? '#ffffff' : stallColor} bold={isHighlight}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

const STATE_CONFIG: Record<AgentState, { color: string; spinner: string }> = {
  idle: { color: 'gray', spinner: '' },
  thinking: { color: '#00BFFF', spinner: 'earth' },
  decomposing: { color: 'cyan', spinner: 'earth' },
  executing: { color: '#FF5E00', spinner: 'dots' },
  vetoing: { color: '#8A2BE2', spinner: 'line' },
  blocked: { color: 'red', spinner: 'growVertical' },
  responding: { color: '#00FF7F', spinner: 'dots' },
};

export function AgentSpinner({ theme }: AgentSpinnerProps) {
  const [state, setState] = useState<AgentState>('idle');
  const [message, setMessage] = useState('Awaiting orders...');
  const [stallProgress, setStallProgress] = useState(0);
  const lastUpdate = useRef(Date.now());
  const raf = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const handleStateChange = (newState: AgentState, msg?: string) => {
      setState(newState);
      if (msg) setMessage(msg);
      lastUpdate.current = Date.now();
      setStallProgress(0);
    };
    cliEvents.on('spinner_state', handleStateChange);
    return () => {
      cliEvents.off('spinner_state', handleStateChange);
    };
  }, []);

  useEffect(() => {
    if (state === 'idle') {
      if (raf.current) clearInterval(raf.current);
      setStallProgress(0);
      return;
    }

    raf.current = setInterval(() => {
      const elapsed = Date.now() - lastUpdate.current;
      if (elapsed > STALL_TIMEOUT) {
        setStallProgress(Math.min(1, (elapsed - STALL_TIMEOUT) / 5000));
      }
    }, 200);

    return () => {
      if (raf.current) clearInterval(raf.current);
    };
  }, [state]);

  const [dots, setDots] = useState('');
  useEffect(() => {
    const t = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 300);
    return () => clearInterval(t);
  }, []);

  const cfg = STATE_CONFIG[state];

  if (state === 'idle') {
    return <Text color={theme.spinnerIdle}>✻ {message}</Text>;
  }

  const stallColor = stallProgress > 0 ? lerpColor(cfg.color, 'rgb(255,0,0)', stallProgress) : cfg.color;

  return (
    <Box>
      <Text color={stallColor}>
        ✻{' '}
      </Text>
      <ShimmerText text={message} color={cfg.color} stallProgress={stallProgress} />
      <Text color={stallColor}>{dots.padEnd(3, ' ')}</Text>
      {stallProgress > 0.5 && <Text color="red"> (stalled)</Text>}
    </Box>
  );
}
