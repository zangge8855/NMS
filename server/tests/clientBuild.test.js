import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_MISSING_CLIENT_BUILD_MESSAGE,
    createClientBuildFallbackHandler,
} from '../lib/clientBuild.js';

describe('createClientBuildFallbackHandler', () => {
    it('serves index.html when the client build exists', () => {
        const calls = [];
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: true,
        });
        const res = {
            sendFile(file, callback) {
                calls.push(file);
                callback();
            },
        };

        handler({}, res, () => {
            throw new Error('next should not be called');
        });

        assert.deepEqual(calls, ['/tmp/client/dist/index.html']);
    });

    it('returns a 503 text response when the client build is missing', () => {
        const calls = [];
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: false,
        });
        const res = {
            status(code) {
                calls.push(['status', code]);
                return this;
            },
            type(value) {
                calls.push(['type', value]);
                return this;
            },
            send(body) {
                calls.push(['send', body]);
                return this;
            },
        };

        handler({}, res, () => {
            throw new Error('next should not be called');
        });

        assert.deepEqual(calls, [
            ['status', 503],
            ['type', 'text/plain'],
            ['send', DEFAULT_MISSING_CLIENT_BUILD_MESSAGE],
        ]);
    });

    it('re-checks the client build presence when supplied as a function', () => {
        const calls = [];
        let exists = false;
        const handler = createClientBuildFallbackHandler({
            clientIndexFile: '/tmp/client/dist/index.html',
            hasClientIndex: () => exists,
        });
        const res = {
            status(code) {
                calls.push(['status', code]);
                return this;
            },
            type(value) {
                calls.push(['type', value]);
                return this;
            },
            send(body) {
                calls.push(['send', body]);
                return this;
            },
            sendFile(file, callback) {
                calls.push(['sendFile', file]);
                callback();
            },
        };

        handler({}, res, () => {
            throw new Error('next should not be called');
        });

        exists = true;
        handler({}, res, () => {
            throw new Error('next should not be called');
        });

        assert.deepEqual(calls, [
            ['status', 503],
            ['type', 'text/plain'],
            ['send', DEFAULT_MISSING_CLIENT_BUILD_MESSAGE],
            ['sendFile', '/tmp/client/dist/index.html'],
        ]);
    });
});
