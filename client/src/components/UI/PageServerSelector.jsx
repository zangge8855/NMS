import React from 'react';

function getServerLabel(server) {
    return String(server?.name || server?.url || server?.id || '').trim();
}

export default function PageServerSelector({
    servers = [],
    value = '',
    onChange,
    label,
    placeholder,
    disabled = false,
    className = '',
}) {
    const serverList = (Array.isArray(servers) ? servers : [])
        .map((server) => ({
            ...server,
            id: String(server?.id || '').trim(),
        }))
        .filter((server) => server.id);

    return (
        <label className={['page-server-selector', className].filter(Boolean).join(' ')}>
            {label ? <span className="page-server-selector-label">{label}</span> : null}
            <select
                className="form-select page-server-selector-control"
                value={value || ''}
                onChange={(event) => onChange?.(event.target.value)}
                disabled={disabled || serverList.length === 0}
            >
                <option value="">{placeholder || 'Select server'}</option>
                {serverList.map((server) => (
                    <option key={server.id} value={server.id}>
                        {getServerLabel(server)}
                    </option>
                ))}
            </select>
        </label>
    );
}
