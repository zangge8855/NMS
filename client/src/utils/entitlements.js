const GIGABYTE_BYTES = 1024 * 1024 * 1024;

export function normalizeLimitIp(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
}

export function gigabytesInputToBytes(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.round(parsed * GIGABYTE_BYTES);
}

export function bytesToGigabytesInput(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '0';
    const gigabytes = parsed / GIGABYTE_BYTES;
    const rounded = Number.isInteger(gigabytes)
        ? gigabytes
        : Number(gigabytes.toFixed(2));
    return String(rounded);
}
