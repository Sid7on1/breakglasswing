export const NAV: { id: string; label: string }[] = [
  { id: 'turn', label: 'See it work' },
  { id: 'make', label: 'What it can do' },
  { id: 'control', label: 'Your control' },
  { id: 'compare', label: 'Compare harnesses' },
  { id: 'install', label: 'Install CLI' },
];

export const HARNESS_METRICS: { value: string; label: string; detail: string }[] = [
  {
    value: '8 / 8',
    label: 'core harness jobs',
    detail: 'Understand, plan, use tools, delegate, isolate, verify, remember, and extend.',
  },
  {
    value: '6 + custom',
    label: 'provider routes',
    detail: 'Choose a built-in provider or point Bimax at a compatible endpoint.',
  },
  {
    value: '4 at once',
    label: 'coordinated workers',
    detail: 'Parallel workers share one capacity guard, including nested work.',
  },
  {
    value: '3 levels',
    label: 'delegation depth',
    detail: 'The main agent can delegate through two additional worker layers.',
  },
  {
    value: 'Hours + resume',
    label: 'long-running work',
    detail: 'No fixed session timer. Progress is saved and sessions can continue later.',
  },
  {
    value: 'Free preview',
    label: 'Bimax software',
    detail: 'Bring a provider key and pay that provider directly for model usage.',
  },
];

export const HARNESS_COMPARISON: {
  question: string;
  bimax: string;
  claude: string;
  codex: string;
}[] = [
  {
    question: 'Can it split up a large job?',
    bimax: 'Four dependency-aware workers at once',
    claude: 'Parallel foreground or background agents',
    codex: 'Parallel, inspectable agent threads',
  },
  {
    question: 'Can delegated agents delegate again?',
    bimax: 'Yes — main agent plus two nested worker layers',
    claude: 'No — subagents cannot spawn subagents',
    codex: 'Configurable subagent depth',
  },
  {
    question: 'How does it know the job is done?',
    bimax: 'Acceptance criteria and fresh evidence must agree',
    claude: 'Tests, hooks, prompts, and agent workflow',
    codex: 'Tests, review, tools, and agent workflow',
  },
  {
    question: 'What happens when code changes after a test?',
    bimax: 'Old proof expires and affected work becomes unverified',
    claude: 'Depends on the configured workflow and hooks',
    codex: 'Depends on the active workflow and review',
  },
  {
    question: 'Can I choose the AI provider?',
    bimax: 'Six providers in the picker, plus a custom endpoint',
    claude: 'Claude models through Anthropic and supported clouds',
    codex: 'OpenAI defaults plus configurable and local providers',
  },
  {
    question: 'Can I return to long work later?',
    bimax: 'Saved local sessions plus seven-day automatic interruption recovery',
    claude: 'Persistent local or cloud sessions',
    codex: 'Persistent tasks and inspectable agent threads',
  },
];

export const TURN = {
  prompt: 'Build a clean booking page for my photography business',
  steps: [
    { label: 'Understands', detail: 'Finds the right screens, styles, and connected pieces.' },
    { label: 'Builds', detail: 'Creates the booking flow and connects it to the existing app.' },
    { label: 'Checks', detail: 'Opens the result, runs the checks, and reports what changed.' },
  ],
};

export const OUTCOMES: { title: string; body: string; media: string; alt: string; tag: string }[] = [
  {
    tag: 'Launch',
    title: 'Turn an idea into a real feature',
    body: 'Describe the result you want. Bimax finds where it belongs, builds it, and shows you the finished change.',
    media: '/media/ui-home.png',
    alt: 'Bimax desktop home screen with options to build, understand, and improve a project',
  },
  {
    tag: 'Understand',
    title: 'Ask your project anything',
    body: 'Wondering how something works? Get a plain answer grounded in the actual files, not a generic guess.',
    media: '/media/ui-transcript.png',
    alt: 'Bimax explaining how a project works in a conversation thread',
  },
  {
    tag: 'Repair',
    title: 'Fix the weird stuff',
    body: 'Share the error or describe what feels wrong. Bimax traces the cause, repairs it, and checks the result.',
    media: '/media/ui-diff.png',
    alt: 'Bimax showing a before-and-after view of a repaired project file',
  },
  {
    tag: 'Continue',
    title: 'Never lose the thread',
    body: 'Every idea, decision, and change stays with its project, ready for you when inspiration comes back.',
    media: '/media/ui-gallery.png',
    alt: 'Bimax showing recent project sessions and their progress',
  },
];

export const FEATURES: { title: string; body: string; signal: string }[] = [
  {
    signal: 'Whole-project view',
    title: 'It sees how the pieces connect',
    body: 'Bimax looks beyond the screen you mention, so a new feature fits the rest of your app instead of breaking something nearby.',
  },
  {
    signal: 'Built-in planning',
    title: 'Big ideas become doable steps',
    body: 'Give it the messy version. Bimax turns the goal into a plan, handles the connected jobs, and keeps you updated in plain language.',
  },
  {
    signal: 'Project memory',
    title: 'It remembers the decisions',
    body: 'Come back tomorrow without starting over. Your threads, progress, and project context stay together.',
  },
  {
    signal: 'Proof, not promises',
    title: 'It checks before it celebrates',
    body: 'Bimax runs the project, checks the important paths, and puts the evidence beside the result for you to review.',
  },
];

export const CONTROL: { title: string; body: string }[] = [
  {
    title: 'Important moves ask first',
    body: 'Bimax pauses before sensitive actions. You choose what it is allowed to change or run.',
  },
  {
    title: 'Every change stays visible',
    body: 'See a plain summary first, then open the exact before-and-after whenever you want more detail.',
  },
  {
    title: 'Checks sit beside the work',
    body: 'You can see what passed, what did not, and what Bimax did about it before you keep the result.',
  },
  {
    title: 'Safe points make undo normal',
    body: 'Stop a task, reject a change, or return to an earlier point without turning recovery into a crisis.',
  },
];

export const PROOF: { value: string; label: string }[] = [
  { value: '6 providers', label: 'NVIDIA, OpenAI, Anthropic, OpenRouter, DeepSeek, or Google.' },
  { value: 'Free preview', label: 'Bimax adds no subscription; provider usage is separate.' },
  { value: 'Hours + resume', label: 'No fixed session timer, with progress saved locally.' },
];

export const MARQUEE = [
  'Say what you want',
  'Watch it take shape',
  'See what changed',
  'Keep what works',
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Can I use Bimax today?',
    a: 'Yes. The Bimax CLI public beta is available now for macOS and Linux. The desktop workspace is still in early access, so join the list if you want the visual experience too.',
  },
  {
    q: 'Do I need to know how to code?',
    a: 'No. If you can describe what you want and judge whether the result feels right, you can drive Bimax. It explains its work in plain language and lets you open the technical detail only when you want it.',
  },
  {
    q: 'What can I make with it?',
    a: 'Bimax is designed to help you build features, shape an existing app, understand unfamiliar projects, fix errors, and keep longer ideas moving across multiple sessions.',
  },
  {
    q: 'Where does my code go?',
    a: 'Bimax works in the project folder on your computer. Requests sent to an AI model use the provider and key you choose; we will publish clear privacy details before early access opens.',
  },
  {
    q: 'Which AI does it use?',
    a: 'Your choice. Bimax includes NVIDIA, OpenAI, Anthropic, OpenRouter, DeepSeek, and Google in the provider picker, plus a custom compatible endpoint. You enter your own key through a masked field and can switch providers without reinstalling.',
  },
  {
    q: 'Is Bimax free?',
    a: 'The Bimax software is free during the public preview. Model usage is separate: you bring a provider key and pay that provider at its own rates. Bimax does not add a subscription charge during preview.',
  },
  {
    q: 'How long can one session run?',
    a: 'There is no fixed wall-clock session timer. Bimax can keep a substantial job moving for hours while your machine and provider remain available, with safety limits that stop stuck work. Sessions are saved locally and can be resumed later; eligible interrupted worker snapshots can recover automatically for up to seven days.',
  },
  {
    q: 'Which platforms are planned?',
    a: 'The CLI is available now for macOS and Linux on ARM64 and x64. The first desktop release is being built for Apple Silicon Macs, with Windows and Linux planned later.',
  },
];
