import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

function extractJsonLine(stdout = '') {
    return String(stdout || '')
        .trim()
        .split(/\r?\n/)
        .reverse()
        .find((line) => String(line).trim().startsWith('{'));
}

export async function runScenario(scriptPath, options = {}) {
    const cwd = options.cwd || process.cwd();
    const outputFile = path.join(
        os.tmpdir(),
        `nms-scenario-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );
    const env = {
        ...process.env,
        ...(options.env || {}),
        SCENARIO_OUTPUT_FILE: outputFile,
    };
    const timeoutMs = Number(options.timeoutMs || 15_000);

    return new Promise((resolve, reject) => {
        const child = spawn('node', [scriptPath], {
            cwd,
            env,
            stdio: ['ignore', 'ignore', 'pipe'],
        });

        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            finish(reject)(new Error(`Scenario timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const finish = (callback) => (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', finish(reject));
        child.on('close', finish((code) => {
            try {
                if (code !== 0) {
                    reject(new Error(stderr.trim() || `Scenario exited with code ${code}`));
                    return;
                }

                const rawOutput = fs.existsSync(outputFile)
                    ? fs.readFileSync(outputFile, 'utf8')
                    : '';
                const jsonLine = extractJsonLine(rawOutput);
                if (!jsonLine) {
                    reject(new Error(`Scenario produced no JSON output.\nFILE:\n${rawOutput}\nSTDERR:\n${stderr}`));
                    return;
                }

                resolve(JSON.parse(jsonLine));
            } finally {
                if (fs.existsSync(outputFile)) {
                    fs.rmSync(outputFile, { force: true });
                }
            }
        }));
    });
}
