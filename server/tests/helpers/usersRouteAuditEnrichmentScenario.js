import fs from 'fs';
import jwt from 'jsonwebtoken';
import app from '../../index.js';
import ipGeoResolver from '../../lib/ipGeoResolver.js';
import ipIspResolver from '../../lib/ipIspResolver.js';
import { invokeApp } from './invokeApp.js';

async function writeResult(payload) {
    const outputFile = String(process.env.SCENARIO_OUTPUT_FILE || '').trim();
    if (!outputFile) {
        throw new Error('SCENARIO_OUTPUT_FILE is required');
    }
    fs.writeFileSync(outputFile, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function main() {
    ipGeoResolver.lookupMany = async (values = []) => new Map(
        (Array.isArray(values) ? values : []).map((value) => [
            value,
            value === '203.0.113.8' ? '中国 浙江 杭州 电信' : '',
        ])
    );
    ipGeoResolver.pickFromMap = (map, ip) => (map instanceof Map ? (map.get(ip) || '') : '');

    ipIspResolver.lookupMany = async (values = []) => new Map(
        (Array.isArray(values) ? values : []).map((value) => [
            value,
            value === '203.0.113.8' ? '中国电信' : '',
        ])
    );
    ipIspResolver.pickFromMap = (map, ip) => (map instanceof Map ? (map.get(ip) || '') : '');

    const token = jwt.sign(
        { userId: 'admin-1', username: 'admin', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    const headers = {
        authorization: `Bearer ${token}`,
    };

    const detailResponse = await invokeApp(app, {
        method: 'GET',
        url: '/api/users/user-activity-1/detail',
        headers,
    });

    await writeResult({
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
