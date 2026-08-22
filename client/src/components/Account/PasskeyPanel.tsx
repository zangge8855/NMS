import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { startRegistration } from '@simplewebauthn/browser';
import {
    HiOutlineKey,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlinePlusCircle,
    HiOutlineFingerPrint,
    HiOutlineShieldCheck,
    HiOutlineComputerDesktop,
    HiOutlineDevicePhoneMobile,
    HiOutlineXMark,
} from 'react-icons/hi2';
import api from '../../api/client';
import { getErrorMessage, formatDateOnly } from '../../utils/format';
import ModalShell from '../UI/ModalShell';

function getCopy(locale = 'zh-CN') {
    if (locale === 'en-US') {
        return {
            title: 'Passkeys (FIDO2 / WebAuthn)',
            subtitle: 'Sign in effortlessly using Face ID, Touch ID, Windows Hello, or hardware security keys without typing a password.',
            addPasskey: 'Add Passkey',
            noPasskeysTitle: 'No Passkeys Added Yet',
            noPasskeysSubtitle: 'Add your first passkey to experience fast, biometric, phishing-resistant sign in.',
            createdOn: 'Added on',
            lastUsed: 'Last used',
            neverUsed: 'Never used yet',
            rename: 'Rename',
            delete: 'Delete',
            renameTitle: 'Rename Passkey',
            deleteTitle: 'Remove Passkey',
            deleteConfirm: 'Are you sure you want to remove this passkey? You will no longer be able to use this device to sign in.',
            deviceNameLabel: 'Device / Passkey Name',
            deviceNamePlaceholder: 'e.g. MacBook Pro Touch ID, iPhone Face ID',
            save: 'Save',
            cancel: 'Cancel',
            confirmDelete: 'Confirm Delete',
            registeredSuccess: 'Passkey added successfully!',
            registerFailed: 'Failed to add passkey',
            deletedSuccess: 'Passkey removed',
            deleteFailed: 'Failed to remove passkey',
            updatedSuccess: 'Passkey name updated',
            updateFailed: 'Failed to update passkey name',
            promptNameTitle: 'Name this Passkey',
            promptNameSubtitle: 'Give this passkey a friendly name to identify which device it belongs to.',
        };
    }
    return {
        title: '通行密钥 (Passkey / WebAuthn)',
        subtitle: '使用面容 (Face ID)、指纹 (Touch ID)、Windows Hello 或硬件安全密钥实现免密极速安全登录。',
        addPasskey: '添加通行密钥',
        noPasskeysTitle: '暂未绑定通行密钥',
        noPasskeysSubtitle: '添加您的首个通行密钥，体验免输入密码的生物识别与高强度抗钓鱼登录。',
        createdOn: '添加时间',
        lastUsed: '上次使用',
        neverUsed: '尚未用于登录',
        rename: '重命名',
        delete: '解绑',
        renameTitle: '修改通行密钥备注',
        deleteTitle: '解绑通行密钥',
        deleteConfirm: '确定要解绑此通行密钥吗？解绑后将无法使用该设备直接免密登录。',
        deviceNameLabel: '设备 / 密钥备注名称',
        deviceNamePlaceholder: '例如: MacBook Pro 指纹, iPhone 面容',
        save: '保存',
        cancel: '取消',
        confirmDelete: '确认解绑',
        registeredSuccess: '通行密钥添加成功！',
        registerFailed: '添加通行密钥失败',
        deletedSuccess: '通行密钥已成功解绑',
        deleteFailed: '解绑通行密钥失败',
        updatedSuccess: '通行密钥备注已更新',
        updateFailed: '更新通行密钥备注失败',
        promptNameTitle: '命名此通行密钥',
        promptNameSubtitle: '为该密钥设置一个便于识别的设备名称。',
    };
}

export interface PasskeyItem {
    id: string;
    deviceName: string;
    aaguid?: string;
    createdAt: string;
    lastUsedAt?: string;
    transports?: string[];
}

export interface PasskeyPanelProps {
    locale?: string;
}

export default function PasskeyPanel({ locale = 'zh-CN' }: PasskeyPanelProps) {
    const copy = useMemo(() => getCopy(locale), [locale]);
    const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [registering, setRegistering] = useState(false);

    // Modal state for naming / renaming
    const [nameModalOpen, setNameModalOpen] = useState(false);
    const [activePasskey, setActivePasskey] = useState<PasskeyItem | null>(null);
    const [editName, setEditName] = useState('');

    // Modal state for delete confirm
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deletingPasskey, setDeletingPasskey] = useState<PasskeyItem | null>(null);

    const loadPasskeys = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/auth/passkey/list');
            if (res.data?.success && Array.isArray(res.data?.obj)) {
                setPasskeys(res.data.obj);
            }
        } catch {
            setPasskeys([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPasskeys();
    }, [loadPasskeys]);

    const [savingName, setSavingName] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Guess a default device name based on user-agent
    const getDefaultDeviceName = () => {
        let defaultName = locale === 'en-US' ? 'Passkey' : '通行密钥';
        if (typeof navigator !== 'undefined') {
            const ua = navigator.userAgent || '';
            if (/iPhone|iPad/i.test(ua)) defaultName = locale === 'en-US' ? 'Apple Device (Face/Touch ID)' : 'Apple 设备 (面容/指纹)';
            else if (/Macintosh|Mac OS/i.test(ua)) defaultName = locale === 'en-US' ? 'MacBook / Mac Passkey' : 'Mac 设备 (指纹/面容)';
            else if (/Windows/i.test(ua)) defaultName = 'Windows Hello';
            else if (/Android/i.test(ua)) defaultName = locale === 'en-US' ? 'Android Passkey' : 'Android 设备';
            else if (/Linux/i.test(ua)) defaultName = locale === 'en-US' ? 'Security Key' : '安全密钥';
        }
        return defaultName;
    };

    // Handle Add Passkey (Registration)
    const handleAddPasskey = async () => {
        if (registering) return;
        setRegistering(true);
        try {
            // 1. Get registration options from server
            const optRes = await api.post('/auth/passkey/register-options');
            if (!optRes.data?.success || !optRes.data?.obj) {
                throw new Error(optRes.data?.msg || copy.registerFailed);
            }

            const defaultName = getDefaultDeviceName();

            // 2. Prompt browser WebAuthn registration
            const attResp = await startRegistration({ optionsJSON: optRes.data.obj });

            // 3. Send verification with friendly device name
            const verifyRes = await api.post('/auth/passkey/register-verify', {
                ...attResp,
                deviceName: defaultName,
            });

            if (verifyRes.data?.success) {
                toast.success(copy.registeredSuccess);
                await loadPasskeys();
            } else {
                throw new Error(verifyRes.data?.msg || copy.registerFailed);
            }
        } catch (err: any) {
            if (err.name === 'NotAllowedError') {
                toast.error(locale === 'en-US' ? 'Passkey setup cancelled' : '已取消通行密钥设置');
            } else {
                toast.error(getErrorMessage(err, copy.registerFailed, locale));
            }
        } finally {
            setRegistering(false);
        }
    };

    // Handle Rename
    const handleSaveName = async () => {
        if (!activePasskey || !editName.trim() || savingName) return;
        setSavingName(true);
        try {
            const res = await api.patch(`/auth/passkey/${encodeURIComponent(activePasskey.id)}`, {
                deviceName: editName.trim(),
            });
            if (res.data?.success) {
                toast.success(copy.updatedSuccess);
                setNameModalOpen(false);
                await loadPasskeys();
            } else {
                throw new Error(res.data?.msg || copy.updateFailed);
            }
        } catch (err) {
            toast.error(getErrorMessage(err, copy.updateFailed, locale));
        } finally {
            setSavingName(false);
        }
    };

    // Handle Delete
    const handleConfirmDelete = async () => {
        if (!deletingPasskey || deleting) return;
        setDeleting(true);
        try {
            const res = await api.delete(`/auth/passkey/${encodeURIComponent(deletingPasskey.id)}`);
            if (res.data?.success) {
                toast.success(copy.deletedSuccess);
                setDeleteModalOpen(false);
                await loadPasskeys();
            } else {
                throw new Error(res.data?.msg || copy.deleteFailed);
            }
        } catch (err) {
            toast.error(getErrorMessage(err, copy.deleteFailed, locale));
        } finally {
            setDeleting(false);
        }
    };

    const getDeviceIcon = (name = '') => {
        const lower = name.toLowerCase();
        if (lower.includes('iphone') || lower.includes('android') || lower.includes('phone') || lower.includes('ipad')) {
            return <HiOutlineDevicePhoneMobile className="w-5 h-5 text-primary" />;
        }
        if (lower.includes('mac') || lower.includes('windows') || lower.includes('desktop') || lower.includes('linux')) {
            return <HiOutlineComputerDesktop className="w-5 h-5 text-primary" />;
        }
        return <HiOutlineFingerPrint className="w-5 h-5 text-primary" />;
    };

    return (
        <div className="card p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stroke-soft pb-4">
                <div>
                    <h2 className="text-lg font-bold flex items-center gap-2 text-primary">
                        <HiOutlineKey className="text-primary w-5 h-5" />
                        {copy.title}
                    </h2>
                    <p className="text-xs text-muted mt-1 max-w-xl">
                        {copy.subtitle}
                    </p>
                </div>
                <button
                    type="button"
                    className="btn btn-primary btn-sm flex items-center gap-1.5 self-start sm:self-auto"
                    onClick={handleAddPasskey}
                    disabled={registering}
                >
                    {registering ? <span className="spinner" /> : <HiOutlinePlusCircle className="w-4 h-4" />}
                    {copy.addPasskey}
                </button>
            </div>

            {loading ? (
                <div className="py-8 text-center text-muted text-sm">
                    <span className="spinner mr-2" />
                    {locale === 'en-US' ? 'Loading...' : '正在加载...'}
                </div>
            ) : passkeys.length === 0 ? (
                <div className="py-8 text-center border border-dashed border-stroke-soft rounded-xl bg-surface-panel/40">
                    <HiOutlineFingerPrint className="w-10 h-10 text-muted mx-auto mb-2 opacity-60" />
                    <div className="text-sm font-semibold text-primary">{copy.noPasskeysTitle}</div>
                    <div className="text-xs text-muted mt-1 max-w-md mx-auto">{copy.noPasskeysSubtitle}</div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {passkeys.map((pk) => (
                        <div
                            key={pk.id}
                            className="p-4 rounded-xl border border-stroke-soft bg-surface-panel hover:border-primary/40 transition-colors flex items-start justify-between gap-3 group"
                        >
                            <div className="flex items-start gap-3 min-w-0">
                                <div className="p-2.5 rounded-lg bg-surface-input border border-stroke-soft shrink-0">
                                    {getDeviceIcon(pk.deviceName)}
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <div className="text-sm font-bold text-primary truncate" title={pk.deviceName}>
                                        {pk.deviceName || 'Passkey'}
                                    </div>
                                    <div className="text-xs text-muted flex items-center gap-1.5">
                                        <span>{copy.createdOn}: {formatDateOnly(pk.createdAt)}</span>
                                    </div>
                                    <div className="text-xs text-muted">
                                        {pk.lastUsedAt ? `${copy.lastUsed}: ${formatDateOnly(pk.lastUsedAt)}` : copy.neverUsed}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-1 opacity-90 group-hover:opacity-100 shrink-0">
                                <button
                                    type="button"
                                    className="p-1.5 rounded-lg hover:bg-surface-input text-muted hover:text-primary transition-colors"
                                    title={copy.rename}
                                    aria-label={copy.rename}
                                    onClick={() => {
                                        setActivePasskey(pk);
                                        setEditName(pk.deviceName || '');
                                        setNameModalOpen(true);
                                    }}
                                >
                                    <HiOutlinePencilSquare className="w-4 h-4" />
                                </button>
                                <button
                                    type="button"
                                    className="p-1.5 rounded-lg hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                                    title={copy.delete}
                                    aria-label={copy.delete}
                                    onClick={() => {
                                        setDeletingPasskey(pk);
                                        setDeleteModalOpen(true);
                                    }}
                                >
                                    <HiOutlineTrash className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal: Rename Passkey */}
            {nameModalOpen && (
                <ModalShell
                    isOpen={nameModalOpen}
                    onClose={() => !savingName && setNameModalOpen(false)}
                    ariaLabel={copy.renameTitle}
                >
                    <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title flex items-center gap-2">
                                <HiOutlinePencilSquare className="w-5 h-5 text-primary" />
                                {copy.renameTitle}
                            </h3>
                            <button
                                type="button"
                                className="modal-close"
                                onClick={() => !savingName && setNameModalOpen(false)}
                                aria-label={copy.cancel}
                                title={copy.cancel}
                                disabled={savingName}
                            >
                                <HiOutlineXMark />
                            </button>
                        </div>
                        <form onSubmit={(e) => {
                            e.preventDefault();
                            if (editName.trim() && !savingName) handleSaveName();
                        }}>
                            <div className="modal-body space-y-4 pt-2">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="passkey-rename-input">{copy.deviceNameLabel}</label>
                                    <input
                                        id="passkey-rename-input"
                                        type="text"
                                        className="form-input"
                                        value={editName}
                                        placeholder={copy.deviceNamePlaceholder}
                                        aria-label={copy.deviceNameLabel}
                                        onChange={(e) => setEditName(e.target.value)}
                                        maxLength={50}
                                        disabled={savingName}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setNameModalOpen(false)} disabled={savingName}>
                                    {copy.cancel}
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={!editName.trim() || savingName}>
                                    {savingName ? <span className="spinner" /> : copy.save}
                                </button>
                            </div>
                        </form>
                    </div>
                </ModalShell>
            )}

            {/* Modal: Confirm Delete */}
            {deleteModalOpen && (
                <ModalShell
                    isOpen={deleteModalOpen}
                    onClose={() => !deleting && setDeleteModalOpen(false)}
                    ariaLabel={copy.deleteTitle}
                >
                    <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title flex items-center gap-2">
                                <HiOutlineTrash className="w-5 h-5 text-danger" />
                                {copy.deleteTitle}
                            </h3>
                            <button
                                type="button"
                                className="modal-close"
                                onClick={() => !deleting && setDeleteModalOpen(false)}
                                aria-label={copy.cancel}
                                title={copy.cancel}
                                disabled={deleting}
                            >
                                <HiOutlineXMark />
                            </button>
                        </div>
                        <div className="modal-body py-2 text-sm text-secondary leading-relaxed">
                            {copy.deleteConfirm}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
                                {copy.cancel}
                            </button>
                            <button type="button" className="btn btn-danger" onClick={handleConfirmDelete} disabled={deleting}>
                                {deleting ? <span className="spinner" /> : copy.confirmDelete}
                            </button>
                        </div>
                    </div>
                </ModalShell>
            )}
        </div>
    );
}
