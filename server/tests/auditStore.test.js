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
