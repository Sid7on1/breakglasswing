import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { ThemeColors } from '../themes';

const PHRASES = [
  "Thinking...", "Architecting...", "Baking...", "Beaming...", 
  "Bootstrapping...", "Brewing...", "Calculating...", "Cascading...",
  "Catapulting...", "Cerebrating...", "Channeling...", "Choreographing...",
  "Churning...", "Coalescing...", "Cogitating...", "Combobulating...",
  "Composing...", "Computing...", "Concocting...", "Considering...",
  "Contemplating...", "Cooking...", "Crafting...", "Creating...",
  "Crunching...", "Crystallizing...", "Cultivating...", "Deciphering...",
  "Deliberating...", "Determining...", "Discombobulating...", "Doing...",
  "Ebbing...", "Effecting...", "Elucidating...", "Embellishing...",
  "Enchanting...", "Envisioning...", "Evaporating...", "Fermenting...",
  "Finagling...", "Flambéing...", "Flowing...", "Flummoxing...",
  "Fluttering...", "Forging...", "Forming...", "Generating...",
  "Germinating...", "Harmonizing...", "Hashing...", "Hatching...",
  "Ideating...", "Imagining...", "Improvising...", "Incubating...",
  "Inferring...", "Infusing...", "Ionizing...", "Kneading...",
  "Levitating...", "Manifesting...", "Marinating...", "Metamorphosing...",
  "Misting...", "Mulling...", "Mustering...", "Musing...", "Nebulizing...",
  "Nesting...", "Noodling...", "Nucleating...", "Orbiting...",
  "Orchestrating...", "Osmosing...", "Percolating...", "Perusing...",
  "Philosophising...", "Photosynthesizing...", "Pollinating...", "Pondering...",
  "Pontificating...", "Precipitating...", "Processing...", "Propagating...",
  "Puzzling...", "Quantumizing...", "Recombobulating...", "Reticulating...",
  "Ruminating...", "Sautéing...", "Seasoning...", "Simmering...",
  "Sketching...", "Spinning...", "Sprouting...", "Stewing...", "Sublimating...",
  "Swirling...", "Synthesizing...", "Tempering...", "Thundering...",
  "Tinkering...", "Transfiguring...", "Transmuting...", "Undulating...",
  "Unfurling...", "Unravelling...", "Warping...", "Whirring...",
  "Working...", "Wrangling..."
];

interface ThinkingTextProps {
  theme: ThemeColors;
}

export function ThinkingText({ theme }: ThinkingTextProps) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * PHRASES.length));
  const [elapsedMs, setElapsedMs] = useState(0);

  // Cycle phrases every 2.5s
  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % PHRASES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // Update color interpolation every 50ms
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Transition from Orange (255, 153, 51) to Red (255, 51, 51) over 5000ms
  const progress = Math.min(1, elapsedMs / 5000);
  const r = 255;
  const g = Math.round(153 - (102 * progress));
  const b = 51;

  const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

  return <Text color={hexColor} bold italic> {PHRASES[index]}</Text>;
}
