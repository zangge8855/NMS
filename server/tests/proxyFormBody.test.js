import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { encodePanelFormBody } = await import('../routes/proxy.js');

function parseLikeExpress(raw) {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    return new Promise((resolve, reject) => {
        app.post('/', (req, res) => { resolve(req.body); res.end(); });
        const server = app.listen(0, '127.0.0.1', async () => {
            try {
                const { port } = server.address();
                await fetch(`http://127.0.0.1:${port}/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: raw,
                });
            } catch (error) {
                reject(error);
            } finally {
                server.close();
            }
        });
    });
}

test('encodePanelFormBody sends repeated keys back as repeated keys', () => {
    const encoded = encodePanelFormBody({ remark: 'pool', strategy: 'random', inboundIds: ['3', '5'] });
    const params = new URLSearchParams(encoded);
    assert.deepEqual(params.getAll('inboundIds'), ['3', '5']);
    assert.equal(params.get('remark'), 'pool');
    assert.equal(params.get('strategy'), 'random');
});

test('encodePanelFormBody keeps JSON for nested objects and stringifies scalars', () => {
    const params = new URLSearchParams(encodePanelFormBody({
        settings: { clients: [{ id: 'a' }] },
        mixed: [{ a: 1 }],
        empty: [],
        enabled: true,
        port: 443,
    }));
    assert.equal(params.get('settings'), '{"clients":[{"id":"a"}]}');
    assert.equal(params.get('mixed'), '[{"a":1}]');
    assert.equal(params.get('empty'), '[]');
    assert.equal(params.get('enabled'), 'true');
    assert.equal(params.get('port'), '443');
});

test('a form with repeated keys survives the express parse and re-encode round trip', async () => {
    const parsed = await parseLikeExpress('remark=pool&inboundIds=3&inboundIds=5&memberWeights=%7B%223%22%3A0.5%7D');
    const params = new URLSearchParams(encodePanelFormBody(parsed));
    assert.deepEqual(params.getAll('inboundIds'), ['3', '5']);
    assert.equal(params.get('memberWeights'), '{"3":0.5}');
});
