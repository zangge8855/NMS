import fs from 'fs';
import jwt from 'jsonwebtoken';
import app from '../../index.js';
import { invokeApp } from './invokeApp.js';

async function writeResult(payload) {
    const outputFile = String(process.env.SCENARIO_OUTPUT_FILE || '').trim();
    if (!outputFile) {
        throw new Error('SCENARIO_OUTPUT_FILE is required');
    }
    fs.writeFileSync(outputFile, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function main() {
    const token = jwt.sign(
        { userId: 'admin-1', username: 'admin', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    const query = new URLSearchParams({
        q: 'settings',
        actor: 'admin',
        serverId: 'server-a',
        targetEmail: 'alice@example.com',
        outcome: 'success',
        from: '2026-03-01T00:00:00.000Z',
        to: '2026-03-31T23:59:59.999Z',
    });
    const response = await invokeApp(app, {
        method: 'GET',
        url: `/api/audit/events/export?${query.toString()}`,
        headers: {
            authorization: `Bearer ${token}`,
        },
    });

    await writeResult({
        statusCode: response.statusCode,
        headers: response.headers,
        text: response.text,
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
