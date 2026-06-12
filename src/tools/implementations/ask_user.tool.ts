import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { cliEvents } from '../../cli/events';
import { LlmAdapter } from '../../core/llm.adapter';
import { getConfig } from '../../cli/config';

export const createAskUserTool = (governor: IGovernor, llmAdapter: LlmAdapter) => buildTool({
  name: 'AskUserTool',
  description: `Pauses your execution and pings the user with an interactive multiple-choice prompt.

Use this tool when:
- You are about to create a file or folder but encounter a collision (e.g. "File exists" error) and need to ask the user to Overwrite, Cancel, or advise.
- You are asked to operate in a codebase on a directory that does not exist, and you want to explicitly ask if you should create it or abort.
- You hit any major ambiguity that requires human clarification.

The execution will pause until the user selects one of the provided options. The returned result will be the text of the exact option the user selected.`,
  isDestructive: false,
  schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question or statement to show to the user (e.g. "The folder \'math\' already exists. What should I do?")' },
      options: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'An array of up to 4 options (e.g. ["Overwrite", "Cancel", "Tell me what else to do"])' 
      }
    },
    required: ['question', 'options']
  },
  execute: async (args: { question: string, options: string[] }) => {
    const config = getConfig();
    if (config.autoAgentDecisions) {
      cliEvents.emit('log', { level: 'info', text: `[AskUserTool] Auto-Agent-Decisions is ON. Delegating question to LLM Supervisor...` } as any);
      const prompt = `You are an AI acting as a human user in an automated workflow.
An AI agent has paused its execution to ask the human a question.
Question: ${args.question}
Options: ${args.options.join(', ')}

Your task is to select the most logical, safest, and productive option to keep the automated workflow moving smoothly.
Reply ONLY with the exact text of the option you choose. Do not provide any conversational text, explanations, or quotes.`;
      
      try {
        const response = await llmAdapter.chatCompletion([{ role: 'user', content: prompt }]);
        cliEvents.emit('log', { level: 'info', text: `[AskUserTool] LLM Supervisor selected: ${response.trim()}` } as any);
        return `User selected: ${response.trim()}`;
      } catch (e: any) {
        cliEvents.emit('log', { level: 'error', text: `[AskUserTool] Auto-decision failed: ${e.message}. Falling back to human interaction.` } as any);
      }
    }

    return new Promise((resolve) => {
      // Re-use the existing veto_prompt event architecture, which pops up an Ink PermissionDialog
      // The 4th argument (true) tells the frontend not to bypass this even if YOLO mode is on
      const safeOptions = Array.isArray(args.options) ? args.options : ['Continue', 'Cancel'];
      const safeQuestion = args.question || 'Action requires confirmation';
      
      cliEvents.emit('veto_prompt', safeQuestion, safeOptions, (answer: string) => {
        resolve(`User selected: ${answer}`);
      }, true);
    });
  }
}, governor);
