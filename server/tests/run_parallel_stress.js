import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');

function runChild(command, args) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        console.log(`[Start] ${command} ${args.join(' ')}`);
        const proc = spawn(command, args, {
            cwd: SERVER_DIR,
            env: process.env,
            stdio: 'pipe'
        });

        let output = '';
        proc.stdout.on('data', d => { output += d.toString(); });
        proc.stderr.on('data', d => { output += d.toString(); });

        proc.on('close', code => {
            const duration = Date.now() - start;
            if (code === 0) {
                console.log(`[PASS] ${command} ${args.join(' ')} (${duration}ms)`);
                resolve({ success: true, duration, output });
            } else {
                console.error(`[FAIL] ${command} ${args.join(' ')} returned exit code ${code} (${duration}ms)`);
                reject(new Error(`Process ${command} ${args.join(' ')} failed with code ${code}\nLogs:\n${output}`));
            }
        });
    });
}

async function main() {
    console.log('=== STAGE 1: Parallel e2e.test.js & stress_challenger.js Execution ===');
    const p1 = runChild('node', ['--test', 'tests/e2e.test.js']);
    const p2 = runChild('node', ['--test', 'tests/e2e.test.js']);
    const p3 = runChild('node', ['--test', 'tests/stress_challenger.js']);
    const p4 = runChild('node', ['--test', 'tests/stress_challenger.js']);

    await Promise.all([p1, p2, p3, p4]);
    console.log('=== STAGE 1 PASSED: Concurrent test runners executed without conflict ===\n');

    console.log('=== STAGE 2: Repeated Full npm test Runs ===');
    await runChild('npm', ['test']);
    console.log('=== STAGE 2 PASSED: Full npm test suite passed ===\n');

    console.log('ALL EMPIRICAL CHALLENGE SUITES PASSED SUCCESSFULLY!');
}

main().catch(err => {
    console.error('Empirical Stress Harness Failed:', err);
    process.exit(1);
});
