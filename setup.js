const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const requiredNode = [20, 19, 0];

function nodeVersion() {
  return process.versions.node.split('.').map(Number);
}

function isSupportedNode() {
  const current = nodeVersion();
  return current[0] > requiredNode[0]
    || (current[0] === requiredNode[0]
      && (current[1] > requiredNode[1]
        || (current[1] === requiredNode[1] && current[2] >= requiredNode[2])));
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function upgradeWithNvm() {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
  const nvmScript = path.join(nvmDir, 'nvm.sh');

  if (!fs.existsSync(nvmScript) || process.platform === 'win32') {
    return false;
  }

  const command = [
    `source ${shellQuote(nvmScript)}`,
    'nvm install',
    'nvm use',
    'npm install --prefix client',
    'npm install --prefix server',
  ].join(' && ');

  const result = spawnSync('bash', ['-lc', command], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

if (!isSupportedNode()) {
  console.error(`Node.js ${requiredNode.join('.')} or newer is required. Current version: ${process.versions.node}`);

  if (!upgradeWithNvm()) {
    console.error('Install Node.js 20.19.0 or newer, then run this command again.');
    console.error('With nvm: nvm install 20.19.0 && nvm use 20.19.0');
    process.exit(1);
  }
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const directory of ['client', 'server']) {
  console.log(`Installing ${directory} dependencies...`);
  const result = spawnSync(npmCommand, ['install'], {
    cwd: path.join(__dirname, directory),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('Setup complete. Start the app with: npm run dev');