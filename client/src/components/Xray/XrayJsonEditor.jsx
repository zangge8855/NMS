import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineXMark, HiOutlineCheckCircle, HiOutlineCloudArrowUp } from 'react-icons/hi2';

function tryFormat(value) {
    if (value === null || value === undefined) return '';
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export default function XrayJsonEditor({
    locale = 'zh-CN',
    label,
    description = '',
    initialValue,
    expectArray = false,
    allowNull = false,
    onSave,
    saving = false,
    hint = '',
}) {
    const initialText = useMemo(() => tryFormat(initialValue), [initialValue]);
    const [text, setText] = useState(initialText);
    const [error, setError] = useState('');

    useEffect(() => {
        setText(initialText);
        setError('');
    }, [initialText]);

    const dirty = text !== initialText;

    const handleSubmit = () => {
        let parsed;
        const trimmed = text.trim();
        if (trimmed === '' || trimmed === 'null') {
            if (!allowNull) {
                setError(locale === 'en-US' ? 'Empty value is not allowed.' : '此区段不允许为空。');
                return;
            }
            parsed = null;
        } else {
            try {
                parsed = JSON.parse(trimmed);
            } catch (err) {
                setError(locale === 'en-US' ? `Invalid JSON: ${err.message}` : `JSON 无效: ${err.message}`);
                return;
            }
            if (expectArray && !Array.isArray(parsed)) {
                setError(locale === 'en-US' ? 'Expected a JSON array.' : '需要 JSON 数组。');
                return;
            }
            if (!expectArray && parsed !== null && typeof parsed !== 'object') {
                setError(locale === 'en-US' ? 'Expected a JSON object.' : '需要 JSON 对象。');
                return;
            }
        }
        setError('');
        onSave?.(parsed);
    };

    const handleReset = () => {
        setText(initialText);
        setError('');
    };

    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-base font-bold text-primary">{label}</h3>
                    {description ? (
                        <p className="text-sm text-secondary mt-1">{description}</p>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    {dirty ? (
                        <button type="button" className="btn btn-secondary btn-sm rounded-md flex items-center gap-1" onClick={handleReset}>
                            <HiOutlineXMark /> {locale === 'en-US' ? 'Reset' : '撤销'}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="btn btn-primary btn-sm rounded-md flex items-center gap-1"
                        onClick={handleSubmit}
                        disabled={saving || !dirty}
                    >
                        <HiOutlineCloudArrowUp /> {locale === 'en-US' ? 'Save' : '保存'}
                    </button>
                </div>
            </div>

            {hint ? (
                <div className="text-xs text-tertiary">{hint}</div>
            ) : null}

            <textarea
                className="form-textarea font-mono text-sm w-full"
                rows={20}
                spellCheck={false}
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError('');
                }}
            />

            {error ? (
                <div className="text-sm text-error">{error}</div>
            ) : (
                dirty ? (
                    <div className="text-xs text-warning">
                        {locale === 'en-US' ? 'Unsaved changes' : '存在未保存的修改'}
                    </div>
                ) : (
                    <div className="text-xs text-success flex items-center gap-1">
                        <HiOutlineCheckCircle /> {locale === 'en-US' ? 'In sync with the node' : '与节点一致'}
                    </div>
                )
            )}
        </div>
    );
}
