const GIGABYTE_BYTES = 1024 * 1024 * 1024;
const KILOBYTE_BYTES = 1024;

export function normalizeLimitIp(value: number | string | null | undefined): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
}

export function gigabytesInputToBytes(value: number | string | null | undefined): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.round(parsed * GIGABYTE_BYTES);
}

export function bytesToGigabytesInput(value: number | string | null | undefined): string {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '0';
    const gigabytes = parsed / GIGABYTE_BYTES;
    const rounded = Number.isInteger(gigabytes)
        ? gigabytes
        : Number(gigabytes.toFixed(2));
    return String(rounded);
}

export function kilobytesInputToBytesPerSecond(value: number | string | null | undefined): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.round(parsed * KILOBYTE_BYTES);
}

export function bytesPerSecondToKilobytesInput(value: number | string | null | undefined): string {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '0';
    return String(Math.round(parsed / KILOBYTE_BYTES));
}
