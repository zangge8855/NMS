export function neutralizeCsvFormula(value: unknown): string {
    const text = String(value ?? '');
    if (!text) return '';
    // Prefix leading formula triggers (=, +, -, @, tab, CR) even after spaces/NBSP
    // so spreadsheet apps treat the cell as plain text rather than evaluating expressions.
    if (/^[=+\-@\t\r]/.test(text) || /^[ \u00a0]+\s*[=+\-@]/.test(text)) {
        return `'${text}`;
    }
    return text;
}

export function buildCsvCell(value: unknown): string {
    return `"${neutralizeCsvFormula(value).replace(/"/g, '""')}"`;
}
