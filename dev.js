const { spawn } = require('node:child_process');

const processes = [
  { name: 'server', cwd: 'server', command: 'npm', args: ['start'] },
  { name: 'client', cwd: 'client', command: 'npm', args: ['run', 'dev'] },
];

const children = processes.map(({ name, cwd, command, args }) => {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  const prefix = `[${name}]`;
  child.stdout.on('data', (chunk) => process.stdout.write(`${prefix} ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`${prefix} ${chunk}`));
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGINT') {
      console.error(`${prefix} exited with ${signal || `code ${code}`}`);
    }
  });
  return child;
});

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
}

process.on('SIGINT', () => {
  stopAll();
  setTimeout(() => process.exit(0), 250);
});

process.on('SIGTERM', () => {
  stopAll();
  setTimeout(() => process.exit(0), 250);
});