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

    const bulkResponse = await invokeApp(app, {
        method: 'POST',
        url: '/api/auth/users/bulk-set-enabled',
        headers,
        body: {
            userIds: ['user-activity-1'],
            enabled: false,
        },
    });
    const detailResponse = await invokeApp(app, {
        method: 'GET',
        url: '/api/users/user-activity-1/detail',
        headers,
    });

    await writeResult({
        bulkResponse: {
            statusCode: bulkResponse.statusCode,
            body: bulkResponse.json,
        },
        detailResponse: {
            statusCode: detailResponse.statusCode,
            body: detailResponse.json,
        },
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
