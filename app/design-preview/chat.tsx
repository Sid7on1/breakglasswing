import React from 'react';
import { useChat } from '@ai-sdk/react';
import { createChat } from '@shadcn/helpers/ai-sdk';

/**
 * The chat surface, driven by `@shadcn/helpers/ai-sdk`.
 *
 * The conversation below is written in code and streamed through the real `useChat` lifecycle —
 * no model, no API route, no key, no engine. That is the point: the transcript's states (streaming
 * text, reasoning, a tool call moving from input to output) are the hardest part of this surface to
 * design, and until now the only way to see them was to run a live task and hope it produced one.
 *
 * This is a design harness, not the shipping transcript. Bimax's real transcript is fed by the
 * engine's NDJSON protocol (`protocol.ts` → `Transcript.tsx`); moving it onto `useChat` would mean
 * replacing that transport, which is a product decision rather than a styling one.
 */
const chat = createChat()
  .user('Redesign the left panel — liquid glass when windowed, solid when maximised.')
  .sleep(400)
  .assistant(({ writer }) => {
    writer.reasoning(
      'The panel is translucent but the window paints an opaque background behind it, so the blur '
      + 'has nothing to sample. I should check how the window itself is configured before touching CSS.',
    );
    writer
      .tool('readFile', { title: 'Reading the window setup', input: { path: 'src/main/index.ts' } })
      .sleep(700)
      .output({ backgroundColor: '#161412', vibrancy: 'sidebar' });
    writer.text(
      'Found it. The window asks for `vibrancy: \'sidebar\'` and then covers it with an opaque '
      + '`backgroundColor`, so macOS never gets to show the material. Clearing the background and '
      + 'letting each non-glass pane paint its own fixes it.',
    );
  })
  .user('Does that break the maximised state?')
  .assistant('No — maximised drops the material entirely and paints the panel solid, so there is nothing to see through.');

// `get(0)`, not `get(1)`: seeding the first *user* message without its reply makes `next()` skip
// straight to the second user turn, and the assistant response in between never streams at all.
const INITIAL = chat.get(0);
const transport = chat.transport({
  delayMs: 24,
  fallback: 'That is the end of this scripted conversation.',
});

export function ChatPreview(): React.ReactElement {
  const { messages, sendMessage, status } = useChat({ messages: INITIAL, transport });
  const next = chat.next(messages);
  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="app-surface flex h-[620px] w-[560px] flex-col overflow-hidden rounded-[14px] border border-line">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.map((message) => (
          <div key={message.id} className="space-y-1.5">
            <p className="text-[10px] font-semibold tracking-[0.09em] text-faint uppercase">
              {message.role === 'user' ? 'You' : 'Bimax'}
            </p>
            {message.parts.map((part, index) => <Part key={index} part={part} />)}
          </div>
        ))}
      </div>

      <div className="border-t border-line px-5 py-3">
        <button
          disabled={!next || busy}
          onClick={() => { if (next && !busy) void sendMessage(next); }}
          className="glass-pill w-full cursor-pointer rounded-xl px-3 py-2 text-[13px] font-semibold text-ink disabled:cursor-default disabled:opacity-40"
        >
          {busy ? 'Streaming…' : next ? 'Send next message' : 'Conversation finished'}
        </button>
      </div>
    </div>
  );
}

/** Renders one AI SDK message part. Each kind gets the treatment its content deserves. */
function Part({ part }: { part: { type: string } & Record<string, unknown> }): React.ReactElement | null {
  if (part.type === 'text') {
    return <p className="text-[13px] leading-relaxed text-ink">{String(part.text ?? '')}</p>;
  }

  if (part.type === 'reasoning') {
    return (
      <p className="border-l-2 border-line pl-3 text-[12.5px] leading-relaxed text-faint italic">
        {String(part.text ?? '')}
      </p>
    );
  }

  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
    const done = part.state === 'output-available';
    return (
      <div className="rounded-lg border border-line bg-raise px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] text-dim">
          <span className={done ? 'text-ember' : 'text-faint'}>⏺</span>
          <span className="flex-1 truncate">{String(part.title ?? part.type.replace('tool-', ''))}</span>
          <span className="font-mono text-[10px] text-faint">{done ? 'done' : 'running'}</span>
        </div>
        {done && (
          <pre className="mt-1.5 overflow-x-auto font-mono text-[10.5px] leading-relaxed text-faint">
            ⎿ {JSON.stringify(part.output)}
          </pre>
        )}
      </div>
    );
  }

  return null;
}
