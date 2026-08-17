export interface HttpErrorOptions {
    code?: string;
    details?: any;
}

class HttpError extends Error {
    status: number;
    code?: string;
    details?: any;

    constructor(status: number, message: unknown, options: HttpErrorOptions = {}) {
        super(String(message || 'Unexpected error'));
        this.name = 'HttpError';
        this.status = Number.isInteger(status) ? status : 500;
        this.code = String(options.code || '').trim() || undefined;
        this.details = options.details;
    }
}

function createHttpError(status: number, message: unknown, options: HttpErrorOptions = {}): HttpError {
    return new HttpError(status, message, options);
}

function isHttpError(error: any): error is HttpError {
    return error instanceof HttpError
        || (error && Number.isInteger(error.status) && typeof error.message === 'string');
}

function toHttpError(error: any, fallbackStatus: number = 500, fallbackMessage: string = 'Unexpected error'): HttpError {
    if (isHttpError(error)) return error;
    return createHttpError(
        fallbackStatus,
        error?.message || fallbackMessage,
        { code: error?.code, details: error?.details }
    );
}

export { HttpError, createHttpError, isHttpError, toHttpError };
