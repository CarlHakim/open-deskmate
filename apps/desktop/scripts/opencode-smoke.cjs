const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const cliPath = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'opencode.cmd' : 'opencode'
);

if (!fs.existsSync(cliPath)) {
  console.error('[smoke] OpenCode CLI not found at:', cliPath);
  process.exit(1);
}

const model = process.env.OPENCODE_MODEL;
if (!model) {
  console.error('[smoke] Set OPENCODE_MODEL (example: google/gemini-1.5-flash).');
  process.exit(1);
}

const hasKey =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.XAI_API_KEY ||
  process.env.OLLAMA_HOST;

if (!hasKey) {
  console.error('[smoke] Set an API key env (GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY) or OLLAMA_HOST.');
  process.exit(1);
}

const config = {
  $schema: 'https://opencode.ai/config.json',
  default_agent: 'accomplish',
  agent: {
    accomplish: {
      description: 'Smoke-test agent',
      prompt: 'You are Accomplish. Respond with a single word: ok.',
      mode: 'primary',
    },
  },
  permission: 'allow',
};

const configPath = path.join(os.tmpdir(), `opencode-smoke-${Date.now()}.json`);
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

const env = {
  ...process.env,
  OPENCODE_CONFIG: configPath,
};

const args = [
  'run',
  'Reply with exactly: ok',
  '--format',
  'json',
  '--model',
  model,
  '--agent',
  'accomplish',
];

console.log('[smoke] Running:', cliPath, args.join(' '));

let child;
if (process.platform === 'win32') {
  const quoteCmdArg = (value) => {
    if (!/[ \t"]/g.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  };
  const quotedArgs = args.map(quoteCmdArg).join(' ');
  const commandLine = `"${cliPath}" ${quotedArgs}`;
  child = spawn(commandLine, {
    env,
    stdio: 'inherit',
    shell: true,
  });
} else {
  child = spawn(cliPath, args, {
    env,
    stdio: 'inherit',
  });
}

child.on('exit', (code) => {
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
  process.exit(code ?? 1);
});
