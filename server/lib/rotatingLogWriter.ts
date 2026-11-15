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
    private bytes = 0;
    private readonly options: RotatingLineWriterOptions;

    constructor(options: RotatingLineWriterOptions) {
        this.options = {
            ...options,
            maxBytes: Math.max(0, Math.floor(Number(options.maxBytes) || 0)),
            maxFiles: Math.max(1, Math.floor(Number(options.maxFiles) || 1)),
        };
    }

    write(line: string): void {
        const size = Buffer.byteLength(line);
        this.ensureStream();
        const { maxBytes } = this.options;
        if (maxBytes > 0 && this.bytes > 0 && this.bytes + size > maxBytes) {
            this.rotate();
            this.ensureStream();
        }
        this.bytes += size;
        this.stream?.write(line);
    }

    /** Ends the active stream and resolves once buffered lines are on disk. */
    close(): Promise<void> {
        const current = this.stream;
        this.stream = null;
        this.bytes = 0;
        if (!current) return Promise.resolve();
        return new Promise((resolve) => {
            current.end(() => resolve());
            current.once('error', () => resolve());
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
        // Open synchronously: an async open would race with a rotation in the same
        // burst (the rename would miss the not-yet-created file and the late open
        // would then append to the new active file).
        const stream = fs.createWriteStream(file, { fd: fs.openSync(file, 'a') });
        stream.on('error', (err) => {
            this.options.onError?.(err);
            // Discard a broken stream so the next write opens a fresh one.
            if (this.stream === stream) {
                this.stream = null;
                this.bytes = 0;
            }
        });
        this.stream = stream;
    }

    private rotate(): void {
        const { file, maxFiles } = this.options;
        const previous = this.stream;
        this.stream = null;
        this.bytes = 0;
        previous?.end();
        try {
            const oldest = `${file}.${maxFiles}`;
            if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
            for (let index = maxFiles - 1; index >= 1; index -= 1) {
                const source = `${file}.${index}`;
                if (fs.existsSync(source)) fs.renameSync(source, `${file}.${index + 1}`);
            }
            if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`);
        } catch (err) {
            // Keep appending to the current file rather than losing audit lines.
            this.options.onError?.(err);
        }
    }
}
