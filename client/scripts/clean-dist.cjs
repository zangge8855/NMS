const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const distDir = path.resolve(process.cwd(), 'dist');

function removeWithFs() {
    fs.rmSync(distDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 150,
    });
}

function hasResidualFiles() {
    if (!fs.existsSync(distDir)) return false;
    const entries = fs.readdirSync(distDir);
    return entries.length > 0;
}

if (fs.existsSync(distDir)) {
    removeWithFs();
}

if (hasResidualFiles() && process.platform === 'win32') {
    const result = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `Remove-Item -Recurse -Force "${distDir}"`],
        { stdio: 'inherit' }
    );
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

if (hasResidualFiles()) {
    console.error(`Failed to clean dist directory: ${distDir}`);
    process.exit(1);
}
