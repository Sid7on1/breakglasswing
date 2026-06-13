/**
 * Recovery for tool calls a model emits as plain text instead of through the
 * function-calling API. Some OpenAI-compatible models (notably minimax on NVIDIA)
 * intermittently answer with `{"name":"BashTool","parameters":{...}}` written into
 * the content channel. Left alone, that JSON leaks to the user and the tool never
 * runs — so the agent loop uses this to recover the call and execute it through the
 * normal, governor-gated path.
 *
 * Safety: a JSON blob is only treated as a call when its `name` matches a REAL
 * registered tool (checked via the `isRegisteredTool` predicate). Arbitrary JSON a
 * user asked the model to produce will not name a live tool, so it is never matched
 * and never executed.
 */

/** A tool call recovered from text, shaped like the native streaming tool_call. */
export interface ParsedToolCall {
  id: string;
  name: string;
  /** Arguments as a JSON string, matching the native function-calling path. */
  args: string;
}

export interface TextToolCallExtraction {
  toolCalls: ParsedToolCall[];
  /** The content with every recognized tool-call JSON blob removed. */
  cleanedText: string;
}

/** Index of the `}` that closes the `{` at `start`, respecting strings/escapes; -1 if unbalanced. */
function matchBalancedObject(s: string, start: number): number {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Parse a candidate object into a tool call if it has a registered name; else null. */
function asToolCall(candidate: string, isRegisteredTool: (name: string) => boolean): { name: string; args: string } | null {
  let obj: any;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  // Accept the common shapes: {name, parameters|arguments|input} and {function:{name, arguments}}.
  const name = obj.name ?? obj.tool ?? obj.function?.name;
  if (typeof name !== 'string' || !isRegisteredTool(name)) return null;

  const rawArgs = obj.parameters ?? obj.arguments ?? obj.input ?? obj.function?.arguments ?? {};
  let args: string;
  if (typeof rawArgs === 'string') {
    args = rawArgs; // already a JSON string (some models nest a stringified payload)
  } else {
    try { args = JSON.stringify(rawArgs); } catch { args = '{}'; }
  }
  return { name, args };
}

/**
 * Scan `content` for tool calls written as JSON text and return them alongside the
 * content with those blobs stripped out. Only blobs naming a registered tool match.
 */
export function extractTextToolCalls(
  content: string,
  isRegisteredTool: (name: string) => boolean
): TextToolCallExtraction {
  const toolCalls: ParsedToolCall[] = [];
  const removals: Array<[number, number]> = [];

  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '{') continue;
    const end = matchBalancedObject(content, i);
    if (end === -1) break; // no balanced object from here on
    const call = asToolCall(content.slice(i, end + 1), isRegisteredTool);
    if (call) {
      toolCalls.push({ id: `text-call-${toolCalls.length}-${Date.now()}`, name: call.name, args: call.args });
      removals.push([i, end + 1]);
      i = end; // skip past this object
    }
  }

  let cleanedText = content;
  if (removals.length > 0) {
    let out = '';
    let last = 0;
    for (const [a, b] of removals) { out += content.slice(last, a); last = b; }
    out += content.slice(last);
    cleanedText = out.replace(/<\/?tool_call>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  return { toolCalls, cleanedText };
}
