import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    HiOutlineChevronDown,
    HiOutlineChevronUp,
    HiOutlineArrowPath,
    HiOutlineCheckCircle,
    HiOutlineExclamationTriangle,
    HiOutlineXMark,
} from 'react-icons/hi2';

function resolveDetailLines(report) {
    return Array.isArray(report?.failureItems) ? report.failureItems : [];
}

export function showAggregateToast(config = {}) {
    const duration = config?.report?.failureCount > 0 ? 12000 : 7000;
    return toast.custom((instance) => (
        <AggregateToast
            {...config}
            toastId={instance.id}
            visible={instance.visible}
        />
    ), {
        duration,
        position: 'top-right',
    });
}

export default function AggregateToast({
    toastId,
    visible = true,
    title = '',
    report = null,
    successLabel = '',
    failureLabel = '',
    detailsLabel = '',
    retryLabel = '',
    closeLabel = '',
    onRetry = null,
}) {
    const [expanded, setExpanded] = useState(false);
    const failures = useMemo(() => resolveDetailLines(report), [report]);
    const successCount = Number(report?.successCount || 0);
    const failureCount = Number(report?.failureCount || 0);
    const total = Number(report?.total || 0);

    return (
        <div className={`aggregate-toast${visible ? ' is-visible' : ''}`}>
            <div className="aggregate-toast-head">
                <div className="aggregate-toast-copy">
                    <div className="aggregate-toast-title">{title}</div>
                    <div className="aggregate-toast-summary">
                        <span className="aggregate-toast-pill is-success">
                            <HiOutlineCheckCircle />
                            {successLabel} {successCount}
                        </span>
                        <span className={`aggregate-toast-pill${failureCount > 0 ? ' is-danger' : ''}`}>
                            <HiOutlineExclamationTriangle />
                            {failureLabel} {failureCount}
                        </span>
                        <span className="aggregate-toast-pill">{total}</span>
                    </div>
                </div>
                <button
                    type="button"
                    className="aggregate-toast-close"
                    onClick={() => toast.dismiss(toastId)}
                    aria-label={closeLabel}
                    title={closeLabel}
                >
                    <HiOutlineXMark />
                </button>
            </div>

            {failureCount > 0 ? (
                <>
                    <div className="aggregate-toast-actions">
                        <button
                            type="button"
                            className="aggregate-toast-link"
                            onClick={() => setExpanded((value) => !value)}
                        >
                            {expanded ? <HiOutlineChevronUp /> : <HiOutlineChevronDown />}
                            {detailsLabel}
                        </button>
                        {typeof onRetry === 'function' ? (
                            <button
                                type="button"
                                className="aggregate-toast-retry"
                                onClick={() => {
                                    onRetry();
                                    toast.dismiss(toastId);
                                }}
                            >
                                <HiOutlineArrowPath />
                                {retryLabel}
                            </button>
                        ) : null}
                    </div>
                    {expanded ? (
                        <div className="aggregate-toast-detail-list">
                            {failures.map((item) => (
                                <div key={`${item.id}-${item.message}`} className="aggregate-toast-detail-row">
                                    <span className="aggregate-toast-detail-name">{item.label || item.id}</span>
                                    <span className="aggregate-toast-detail-message">{item.message || '-'}</span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
