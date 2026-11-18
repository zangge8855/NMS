import fs from 'fs';
import path from 'path';

export interface RotatingLineWriterOptions {
    file: string;
    /** Rotate once the active file would exceed this many bytes. 0 disables rotation. */
    maxBytes: number;
    /** Number of rotated files to keep (`file.1` … `file.N`). Minimum 1. */
    maxFiles: number;
    onError?: (err: unknown) => void;
}

/**
 * Append-only line writer with size-based rotation (`file` → `file.1` → … → `file.N`).
 * Rotation renames synchronously so no line is ever written to a file that is about to
 * be shifted; the previous stream keeps flushing into the renamed file.
 */
export class RotatingLineWriter {
    private stream: fs.WriteStream | null = null;
    private fd: number | null = null;
    private bytes = 0;
    private rotating: Promise<void> | null = null;
    private queuedLines: string[] = [];
    private closed = false;
    private readonly options: RotatingLineWriterOptions;

    constructor(options: RotatingLineWriterOptions) {
        this.options = {
            ...options,
            maxBytes: Math.max(0, Math.floor(Number(options.maxBytes) || 0)),
            maxFiles: Math.max(1, Math.floor(Number(options.maxFiles) || 1)),
        };
    }

    write(line: string): void {
        if (this.closed) return;
        if (this.rotating) {
            this.queuedLines.push(line);
            return;
        }
        const size = Buffer.byteLength(line);
        this.ensureStream();
        const { maxBytes } = this.options;
        if (maxBytes > 0 && this.bytes > 0 && this.bytes + size > maxBytes) {
            this.queuedLines.push(line);
            this.rotate();
            return;
        }
        this.bytes += size;
        this.stream?.write(line);
    }

    /** Ends the active stream and resolves once buffered lines are on disk. */
    async close(): Promise<void> {
        while (this.rotating || this.queuedLines.length > 0) {
            if (this.rotating) {
                await this.rotating;
            } else {
                const batch = this.queuedLines.splice(0);
                for (const nextLine of batch) {
                    this.write(nextLine);
                }
            }
        }
        this.closed = true;
        await this.closeCurrentStream();
    }

    private closeCurrentStream(): Promise<void> {
        const current = this.stream;
        const currentFd = this.fd;
        this.stream = null;
        this.fd = null;
        this.bytes = 0;

        const closeFdSafely = () => {
            if (currentFd === null) return;
            try {
                fs.closeSync(currentFd);
            } catch {
                // Already closed.
            }
        };

        if (!current) {
            closeFdSafely();
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                closeFdSafely();
                resolve();
            };
            current.once('error', finish);
            current.once('close', finish);
            if (current.writableFinished || current.destroyed) {
                finish();
                return;
            }
            current.end(finish);
        });
    }

    private ensureStream(): void {
        if (this.stream) return;
        const { file } = this.options;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        try {
            this.bytes = fs.statSync(file).size;
        } catch {
            this.bytes = 0;
        }
        const fd = fs.openSync(file, 'a');
        this.fd = fd;
        const stream = fs.createWriteStream(file, { fd, autoClose: false });
        stream.on('error', (err) => {
            this.options.onError?.(err);
            // Discard a broken stream so the next write opens a fresh one.
            if (this.stream === stream) {
                const brokenFd = this.fd;
                this.stream = null;
                this.fd = null;
                this.bytes = 0;
                if (brokenFd !== null) {
                    try {
                        fs.closeSync(brokenFd);
                    } catch {
                        // Already closed.
                    }
                }
            }
        });
        this.stream = stream;
    }

    private shiftRotatedFiles(): void {
        const { file, maxFiles } = this.options;
        const oldest = `${file}.${maxFiles}`;
        if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
        for (let index = maxFiles - 1; index >= 1; index -= 1) {
            const source = `${file}.${index}`;
            if (fs.existsSync(source)) fs.renameSync(source, `${file}.${index + 1}`);
        }
        if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`);
    }

    private rotate(): void {
        if (this.rotating) return;
        const closePromise = this.closeCurrentStream();
        this.rotating = (async () => {
            try {
                await closePromise;
                this.shiftRotatedFiles();
            } catch (err) {
                // Keep appending to the current file rather than losing audit lines.
                this.options.onError?.(err);
            } finally {
                this.rotating = null;
                if (!this.closed && this.queuedLines.length > 0) {
                    const batch = this.queuedLines.splice(0);
                    for (const nextLine of batch) {
                        this.write(nextLine);
                    }
                }
            }
        })();
    }
}
