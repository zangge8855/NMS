/**
 * NotificationBell — 通知铃铛组件
 *
 * 显示在顶部 Header 中，点击展开未读通知列表。
 */

import React, { useState, useRef, useEffect } from 'react';
import { HiOutlineBell, HiOutlineCheckCircle } from 'react-icons/hi2';
import { useNotifications } from '../../contexts/NotificationContext.jsx';

function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    return new Date(isoString).toLocaleDateString('zh-CN');
}

function severityStyle(severity) {
    if (severity === 'critical') return { color: 'var(--accent-danger)', borderLeft: '3px solid var(--accent-danger)' };
    if (severity === 'warning') return { color: 'var(--accent-warning)', borderLeft: '3px solid var(--accent-warning)' };
    return { color: 'var(--accent-info)', borderLeft: '3px solid var(--accent-info)' };
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

    // 点击外部关闭
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                className="btn btn-secondary btn-icon"
                onClick={() => setOpen(v => !v)}
                title="通知"
                style={{ position: 'relative' }}
            >
                <HiOutlineBell style={{ fontSize: '18px' }} />
                {unreadCount > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: 'var(--accent-danger)',
                        color: '#fff',
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                        fontWeight: 700,
                        boxShadow: '0 0 6px var(--accent-danger-glow)',
                    }}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    width: '360px',
                    maxHeight: '480px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-highlight)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-2xl)',
                    zIndex: 9999,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                    {/* 头部 */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 16px 10px',
                        borderBottom: '1px solid var(--border-color)',
                    }}>
                        <span style={{ fontWeight: 600, fontSize: '14px' }}>
                            通知
                            {unreadCount > 0 && (
                                <span style={{
                                    marginLeft: '8px',
                                    background: 'var(--accent-danger)',
                                    color: '#fff',
                                    borderRadius: '10px',
                                    padding: '1px 7px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                }}>
                                    {unreadCount}
                                </span>
                            )}
                        </span>
                        {unreadCount > 0 && (
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={markAllRead}
                                style={{ fontSize: '12px', gap: '4px' }}
                            >
                                <HiOutlineCheckCircle style={{ fontSize: '14px' }} />
                                全部已读
                            </button>
                        )}
                    </div>

                    {/* 通知列表 */}
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                        {notifications.length === 0 ? (
                            <div style={{
                                padding: '32px 16px',
                                textAlign: 'center',
                                color: 'var(--text-muted)',
                                fontSize: '13px',
                            }}>
                                暂无通知
                            </div>
                        ) : (
                            notifications.slice(0, 30).map(n => (
                                <div
                                    key={n.id}
                                    onClick={() => !n.readAt && markRead(n.id)}
                                    style={{
                                        padding: '12px 16px',
                                        cursor: n.readAt ? 'default' : 'pointer',
                                        opacity: n.readAt ? 0.6 : 1,
                                        borderBottom: '1px solid var(--border-color)',
                                        background: n.readAt ? 'transparent' : 'rgba(99,102,241,0.04)',
                                        transition: 'background 0.15s',
                                        ...severityStyle(n.severity),
                                        paddingLeft: '13px',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontWeight: n.readAt ? 400 : 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                                            {n.title}
                                        </span>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: '8px' }}>
                                            {formatRelativeTime(n.createdAt)}
                                        </span>
                                    </div>
                                    {n.body && (
                                        <div style={{
                                            fontSize: '12px',
                                            color: 'var(--text-muted)',
                                            lineHeight: 1.5,
                                            overflow: 'hidden',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical',
                                        }}>
                                            {n.body}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
