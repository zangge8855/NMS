class HttpError extends Error {
    constructor(status, message, options = {}) {
        super(String(message || 'Unexpected error'));
        this.name = 'HttpError';
        this.status = Number.isInteger(status) ? status : 500;
        this.code = String(options.code || '').trim() || undefined;
        this.details = options.details;
    }
}

function createHttpError(status, message, options = {}) {
    return new HttpError(status, message, options);
}

function isHttpError(error) {
    return error instanceof HttpError
        || (error && Number.isInteger(error.status) && typeof error.message === 'string');
}

function toHttpError(error, fallbackStatus = 500, fallbackMessage = 'Unexpected error') {
    if (isHttpError(error)) return error;
    return createHttpError(
        fallbackStatus,
        error?.message || fallbackMessage,
        { code: error?.code, details: error?.details }
    );
}

export { HttpError, createHttpError, isHttpError, toHttpError };
