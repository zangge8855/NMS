import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

test('auditStore redactSensitive prevents infinite loop on circular references', (t) => {
    t.mock.method(fs, 'writeFileSync', () => {});
    t.mock.method(fs, 'appendFileSync', () => {});
    t.mock.method(fs, 'mkdirSync', () => {});
    
    return import('../store/auditStore.js').then((module) => {
        const auditStore = module.default;
        
        t.mock.method(auditStore, '_save', () => Promise.resolve());
        
        const circularObj = {
            name: 'CircularTest',
            secret: 'my-secret',
        };
        circularObj.self = circularObj;
        
        const entry = auditStore.appendEvent({
            event: 'test_circular',
            details: circularObj,
        });
        
        assert.equal(entry.details.name, 'CircularTest');
        assert.equal(entry.details.secret, '[REDACTED]');
        assert.equal(entry.details.self, '[CIRCULAR]');
    });
});

test('auditStore queryEvents honors forExport cap above default maxPageSize', async () => {
    const auditStore = (await import('../store/auditStore.js')).default;
    const originalEvents = [...auditStore.events];
    auditStore.events = Array.from({ length: 240 }, (_, idx) => ({
        id: `exp-${idx}`,
        ts: new Date().toISOString(),
        eventType: 'test_export',
        actor: 'admin',
        ip: '203.0.113.10',
        method: 'GET',
        path: '/api/audit',
        outcome: 'success',
    }));

    try {
        const standard = auditStore.queryEvents({ page: 1, pageSize: 500 });
        assert.ok(standard.items.length <= 200);
        const exported = auditStore.queryEvents({ page: 1, pageSize: 500, forExport: true });
        assert.equal(exported.items.length, 240);
    } finally {
        auditStore.events = originalEvents;
    }
});
