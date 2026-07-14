import { Message } from '../core/llm.provider';
import { applyImplicitWriteConstraints, inferExactWordTarget } from '../tools/write.constraints';

const user = (content: string): Message => ({ role: 'user', content });

describe('implicit WriteFile prose constraints', () => {
  it('recognizes the observed "wrd" typo', () => {
    expect(inferExactWordTarget([user('now i want you to add a 200 wrd long story')])).toBe(200);
  });

  it('carries an exact count through a genre follow-up', () => {
    const messages: Message[] = [
      user('add a 200 wrd long story'),
      { role: 'assistant', content: 'Done.' },
      user('can we make it a horror stpry ?'),
    ];
    const enriched = JSON.parse(applyImplicitWriteConstraints(JSON.stringify({
      path: '~/Desktop/story.txt',
      content: 'The Dark Tower\n\none two three',
    }), messages));

    expect(enriched).toMatchObject({ expectedWords: 200, excludeTitleFromWordCount: true });
  });

  it('does not carry the old count when the user asks for a different relative length', () => {
    const messages: Message[] = [user('write a 200 word story'), user('make it much longer')];
    expect(inferExactWordTarget(messages)).toBeUndefined();
  });

  it('does not apply prose constraints to source code', () => {
    const raw = JSON.stringify({ path: 'src/story.ts', content: 'export const story = true;' });
    expect(JSON.parse(applyImplicitWriteConstraints(raw, [user('write 200 words')])).expectedWords).toBeUndefined();
  });
});
