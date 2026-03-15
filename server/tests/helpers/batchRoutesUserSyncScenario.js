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
    const headers = {
        authorization: `Bearer ${token}`,
    };

    const retryResponse = await invokeApp(app, {
        method: 'POST',
        url: '/api/jobs/00000000-0000-4000-8000-000000000123/retry',
        headers,
        body: {
            failedOnly: true,
        },
    });
    const historyResponse = await invokeApp(app, {
        method: 'GET',
        url: '/api/jobs?page=1&pageSize=10&includeResults=true',
        headers,
    });

    await writeResult({
        retryResponse: {
            statusCode: retryResponse.statusCode,
            body: retryResponse.json,
        },
        historyResponse: {
            statusCode: historyResponse.statusCode,
            body: historyResponse.json,
        },
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
