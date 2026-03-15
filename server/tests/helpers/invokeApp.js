import http from 'http';
import { Readable } from 'stream';

function normalizeHeaders(headers = {}) {
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
    );
}

function toBodyBuffer(body) {
    if (body === undefined || body === null) return null;
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === 'string') return Buffer.from(body);
    return Buffer.from(JSON.stringify(body));
}

function parseJson(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export async function invokeApp(app, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const url = String(options.url || '/');
    const bodyBuffer = toBodyBuffer(options.body);
    const headers = normalizeHeaders(options.headers);

    if (bodyBuffer && !headers['content-type']) {
        headers['content-type'] = 'application/json';
    }
    if (bodyBuffer && !headers['content-length']) {
        headers['content-length'] = String(bodyBuffer.length);
    }

    return new Promise((resolve, reject) => {
        const socket = {
            remoteAddress: '127.0.0.1',
            encrypted: false,
            writable: true,
            destroyed: false,
            address() {
                return { port: 0 };
            },
            setTimeout() {},
            setNoDelay() {},
            setKeepAlive() {},
            on() {},
            once() {},
            emit() {},
            removeListener() {},
            destroy() {
                this.destroyed = true;
            },
            destroySoon() {
                this.destroy();
            },
            cork() {},
            uncork() {},
            write() {
                return true;
            },
        };
        const req = new Readable({
            read() {},
        });
        req.url = url;
        req.method = method;
        req.headers = headers;
        req.connection = socket;
        req.socket = socket;
        req.httpVersion = '1.1';
        req.httpVersionMajor = 1;
        req.httpVersionMinor = 1;

        const res = new http.ServerResponse(req);
        const chunks = [];
        res.write = (chunk, encoding, callback) => {
            if (chunk) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
            }
            if (typeof callback === 'function') callback();
            return true;
        };
        res.end = (chunk, encoding, callback) => {
            if (chunk) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
            }
            if (typeof callback === 'function') callback();
            res.emit('finish');
            return res;
        };

        res.on('finish', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
                statusCode: res.statusCode,
                headers: res.getHeaders(),
                text,
                json: parseJson(text),
            });
        });

        try {
            app.handle(req, res, reject);
            if (bodyBuffer) {
                req.push(bodyBuffer);
            }
            req.push(null);
        } catch (error) {
            reject(error);
        }
    });
}
