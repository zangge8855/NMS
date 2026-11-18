import React, { useState, useEffect, useMemo, useRef } from 'react';
import { HiOutlineXMark, HiOutlineCheck, HiOutlineArrowPath } from 'react-icons/hi2';
import api from '../../api/client';
import { attachBatchRiskToken } from '../../utils/riskConfirm';
import {
    normalizeProtocol,
    UUID_PROTOCOLS, PASSWORD_PROTOCOLS,
} from '../../utils/protocol';
import { generateSecurePassword, generateUuidLocal, generateHexToken } from '../../utils/crypto';
import ModalShell from '../UI/ModalShell';
import toast from 'react-hot-toast';
import { useI18n } from '../../contexts/LanguageContext';
import { useOptionalServer } from '../../contexts/ServerContext';
import { PANEL_TYPE_SUI, normalizePanelType } from '../../utils/panelType';
import {
    bytesPerSecondToKilobytesInput,
    bytesToGigabytesInput,
    gigabytesInputToBytes,
    kilobytesInputToBytesPerSecond,
} from '../../utils/entitlements';

const BATCH_CLIENT_PROTOCOLS = new Set([
    'vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria', 'hysteria2', 'hy2', 'tuic',
    // s-ui inbound types
    'naive', 'anytls', 'shadowtls', 'snell', 'mixed', 'socks', 'http',
]);

function resolveResponseMsg(data, fallback = '') {
    if (!data || typeof data !== 'object') return fallback;
    const primary = String(data.msg || '').trim();
    if (primary) return primary;
    const secondary = String(data.message || '').trim();
    if (secondary) return secondary;
    return fallback;
}

function assertOperationSucceeded(response, fallbackMsg = 'Operation failed') {
    const data = response?.data;
    if (!data || typeof data !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(data, 'success') && data.success === false) {
        throw new Error(resolveResponseMsg(data, fallbackMsg));
    }
}

function resolveClientIdentifier(client: any = {}, protocol: any = '') {
    const normalizedProtocol = normalizeProtocol(protocol || client.protocol);
    if (PASSWORD_PROTOCOLS.has(normalizedProtocol)) {
        return client.auth || client.auth_str || client.password || client.id || client.uuid || client.email || '';
    }
    if (UUID_PROTOCOLS.has(normalizedProtocol)) {
        return client.uuid || client.id || client.password || client.email || '';
    }
    return client.id || client.uuid || client.password || client.auth || client.auth_str || client.email || '';
}

function generateBase64Key(byteLength: number = 32): string {
    const bytes = new Uint8Array(byteLength);
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < byteLength; i += 1) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function extractShadowsocksMethod(source: any): string {
    if (!source || typeof source !== 'object') return '';
    if (typeof source.method === 'string' && source.method.trim()) {
        return source.method.trim().toLowerCase();
    }
    const rawSettings = source.settings;
    if (rawSettings && typeof rawSettings === 'object') {
        return String(rawSettings.method || '').trim().toLowerCase();
    }
    if (typeof rawSettings === 'string' && rawSettings.trim()) {
        try {
            const parsed = JSON.parse(rawSettings);
            if (parsed && typeof parsed === 'object') {
                return String(parsed.method || '').trim().toLowerCase();
            }
        } catch {
            // ignore malformed JSON settings
        }
    }
    return '';
}

function resolveShadowsocks2022KeyLength(sources: any[] = [], fallbackProtocol: string = ''): 16 | 32 | null {
    let has16 = false;
    let has32 = false;
    for (const item of Array.isArray(sources) ? sources : []) {
        if (!item || typeof item !== 'object') continue;
        const proto = normalizeProtocol(item.protocol || fallbackProtocol);
        if (proto && proto !== 'shadowsocks') continue;
        const method = extractShadowsocksMethod(item);
        if (!method || !method.includes('2022-blake3')) continue;
        if (method === '2022-blake3-aes-128-gcm' || method.includes('128-gcm')) {
            has16 = true;
        } else {
            has32 = true;
        }
    }
    if (has32) return 32;
    if (has16) return 16;
    return null;
}

function generatePasswordForSources(sources: any[] = [], fallbackProtocol: string = ''): string {
    const keyLength = resolveShadowsocks2022KeyLength(sources, fallbackProtocol);
    if (keyLength) {
        return generateBase64Key(keyLength);
    }
    return generateSecurePassword();
}

function normalizeTimestamp(value: any) {
    const ts = Number(value);
    return Number.isFinite(ts) ? ts : 0;
}

function buildStableSubId(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return '';
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36).padEnd(16, '0').slice(0, 16);
}

function toLocalDateTimeInput(timestampMs) {
    const value = Number(timestampMs || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(input) {
    const text = String(input || '').trim();
    if (!text) return 0;
    const parsed = new Date(text);
    const ts = parsed.getTime();
    return Number.isFinite(ts) ? ts : 0;
}

const CLIENT_TRAFFIC_RESET_CYCLES = ['never', 'hourly', 'daily', 'weekly', 'monthly'];
const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function clampIntInput(value: any, min: number, max: number) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeTrafficResetCycle(value: any) {
    const cycle = String(value || '').trim().toLowerCase();
    return CLIENT_TRAFFIC_RESET_CYCLES.includes(cycle) ? cycle : 'never';
}

function getTargetKey(target: any = {}) {
    const server = String(target.serverId || '').trim();
    const inbound = String(target.id || target.inboundId || '').trim();
    if (!server || !inbound) return '';
    return `${server}::${inbound}`;
}

export default function ClientModal({
    isOpen,
    onClose,
    inboundId = undefined,
    serverId = undefined,
    inboundProtocol = '',
    targets = [],
    editingClient = null,
    onSuccess,
    onBatchResult,
}: any) {
    const { locale, t } = useI18n();
    const [loading, setLoading] = useState(false);

    const [email, setEmail] = useState('');
    const [uuid, setUuid] = useState('');
    const [password, setPassword] = useState('');
    const [subId, setSubId] = useState('');
    const [totalGB, setTotalGB] = useState<string | number>(0);
    const [_expiryTime, setExpiryTime] = useState(0);
    const [expiryMode, setExpiryMode] = useState('never');
    const [expiryDateTime, setExpiryDateTime] = useState('');
    const [expiryAfterDays, setExpiryAfterDays] = useState('');
    const [enable, setEnable] = useState(true);
    const [limitIp, setLimitIp] = useState<string | number>(0);
    const [speedLimitUp, setSpeedLimitUp] = useState<string | number>(0);
    const [speedLimitDown, setSpeedLimitDown] = useState<string | number>(0);
    const [tgId, setTgId] = useState('');
    const [comment, setComment] = useState('');
    const [reset, setReset] = useState(0);
    const [group, setGroup] = useState('');
    const [resetDay, setResetDay] = useState(0);
    const [resetWeekday, setResetWeekday] = useState(0);
    const [resetMax, setResetMax] = useState<string | number>(0);
    const [clientTrafficReset, setClientTrafficReset] = useState('never');
    const [clientTrafficResetDay, setClientTrafficResetDay] = useState<string | number>(1);
    const [flow, setFlow] = useState('');
    const [editTargets, setEditTargets] = useState<any[]>([]);
    const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
    const [selectedInboundKeys, setSelectedInboundKeys] = useState<string[]>([]);
    const [baseFlowOptions, setBaseFlowOptions] = useState(['', 'xtls-rprx-vision']);
    const [flowProtocols, setFlowProtocols] = useState(['vless']);
    const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
    const initializedKeyRef = useRef('');
    const latestEditingClientRef = useRef(editingClient);
    latestEditingClientRef.current = editingClient;
    const latestTargetsRef = useRef(targets);
    latestTargetsRef.current = targets;
    const latestInboundProtocolRef = useRef(inboundProtocol);
    latestInboundProtocolRef.current = inboundProtocol;
    const prevRequiresUuidRef = useRef(false);
    const prevRequiresPasswordRef = useRef(false);
    const prevSs2022KeyLengthRef = useRef<16 | 32 | null>(null);
    const lastAutoPasswordRef = useRef('');
    const initialEditCredsRef = useRef({ email: '', uuid: '', password: '' });
    const initialAfterFirstUseRef = useRef<{ rawExpiry: number; daysStr: string } | null>(null);

    const sessionInitKey = useMemo(() => {
        if (!isOpen) return '';
        if (editingClient) {
            return `edit:${String(editingClient.serverId || serverId || '')}:${String(editingClient.inboundId || inboundId || '')}:${String(editingClient.id || editingClient.uuid || editingClient.password || editingClient.auth || editingClient.auth_str || editingClient.email || '')}`;
        }
        const targetKeys = (Array.isArray(targets) ? targets : [])
            .map((item) => getTargetKey(item))
            .filter(Boolean)
            .join(',');
        return `add:${String(serverId || '')}:${String(inboundId || '')}:${normalizeProtocol(inboundProtocol)}:${targetKeys}`;
    }, [editingClient, inboundId, inboundProtocol, isOpen, serverId, targets]);
    const flowOptions = useMemo(() => {
        if (flow && !baseFlowOptions.includes(flow)) {
            return [...baseFlowOptions, flow];
        }
        return baseFlowOptions;
    }, [flow, baseFlowOptions]);

    useEffect(() => {
        if (!isOpen) {
            initializedKeyRef.current = '';
            prevRequiresUuidRef.current = false;
            prevRequiresPasswordRef.current = false;
            prevSs2022KeyLengthRef.current = null;
            lastAutoPasswordRef.current = '';
            initialEditCredsRef.current = { email: '', uuid: '', password: '' };
            initialAfterFirstUseRef.current = null;
            setAdvancedPanelOpen(false);
            return;
        }
        if (initializedKeyRef.current === sessionInitKey) {
            return;
        }
        initializedKeyRef.current = sessionInitKey;

        const currentEditing = latestEditingClientRef.current;
        const currentTargets = latestTargetsRef.current;
        const currentInboundProtocol = latestInboundProtocolRef.current;

        if (currentEditing) {
            const editScopeTargets = Array.isArray(currentEditing.editTargets) && currentEditing.editTargets.length > 0
                ? currentEditing.editTargets
                : [currentEditing];
            const protocolSet = new Set<string>(
                editScopeTargets.map((item: any) => normalizeProtocol(item?.protocol)).filter(Boolean)
            );
            const needsUuid = protocolSet.size === 0 || Array.from(protocolSet).some((item) => UUID_PROTOCOLS.has(item));
            const needsPassword = Array.from(protocolSet).some((item) => PASSWORD_PROTOCOLS.has(item));
            const currentId = String(currentEditing.id || currentEditing.uuid || '').trim();
            const currentPassword = String(currentEditing.password || currentEditing.auth || currentEditing.auth_str || '').trim();
            const initEmail = String(currentEditing.email || '');
            const initUuid = currentId || (needsUuid ? currentPassword : '');
            const initPassword = currentPassword || (needsPassword ? currentId : '');

            initialEditCredsRef.current = {
                email: initEmail,
                uuid: initUuid,
                password: initPassword,
            };
            lastAutoPasswordRef.current = '';
            prevSs2022KeyLengthRef.current = resolveShadowsocks2022KeyLength(
                editScopeTargets,
                currentEditing.protocol || currentInboundProtocol
            );

            setEmail(initEmail);
            setUuid(initUuid);
            setPassword(initPassword);
            setSubId(currentEditing.subId || '');
            setTotalGB(bytesToGigabytesInput(currentEditing.totalGB));
            {
                const rawExpiry = Number(currentEditing.expiryTime || 0);
                setExpiryTime(rawExpiry);
                if (rawExpiry > 0) {
                    setExpiryMode('datetime');
                    setExpiryDateTime(toLocalDateTimeInput(rawExpiry));
                    setExpiryAfterDays('');
                    initialAfterFirstUseRef.current = null;
                } else if (rawExpiry < 0) {
                    const afterDays = Math.max(1, Math.round(Math.abs(rawExpiry) / 86400000));
                    const daysStr = String(afterDays);
                    setExpiryMode('after_first_use');
                    setExpiryDateTime('');
                    setExpiryAfterDays(daysStr);
                    initialAfterFirstUseRef.current = { rawExpiry, daysStr };
                } else {
                    setExpiryMode('never');
                    setExpiryDateTime('');
                    setExpiryAfterDays('');
                    initialAfterFirstUseRef.current = null;
                }
            }
            setEnable(currentEditing.enable !== false);
            setLimitIp(currentEditing.limitIp || 0);
            setSpeedLimitUp(bytesPerSecondToKilobytesInput(currentEditing.speedLimitUp));
            setSpeedLimitDown(bytesPerSecondToKilobytesInput(currentEditing.speedLimitDown));
            setTgId(String(currentEditing.tgId || ''));
            setComment(String(currentEditing.comment || ''));
            setReset(Number(currentEditing.reset || 0));
            setGroup(String(currentEditing.group || ''));
            const initResetDay = clampIntInput(currentEditing.resetDay, 0, 31);
            const initResetWeekday = clampIntInput(currentEditing.resetWeekday, 0, 7);
            const initResetMax = clampIntInput(currentEditing.resetMax, 0, Number.MAX_SAFE_INTEGER);
            const initTrafficReset = normalizeTrafficResetCycle(currentEditing.trafficReset);
            setResetDay(initResetDay);
            setResetWeekday(initResetWeekday);
            setResetMax(initResetMax);
            setClientTrafficReset(initTrafficReset);
            setClientTrafficResetDay(clampIntInput(currentEditing.trafficResetDay, 1, 31));
            setAdvancedPanelOpen(
                initResetDay > 0
                || initResetWeekday > 0
                || initResetMax > 0
                || initTrafficReset !== 'never'
            );
            setFlow(currentEditing.flow || '');
            setEditTargets(Array.isArray(currentEditing.editTargets) ? currentEditing.editTargets : []);
            setSelectedServerIds([]);
            setSelectedInboundKeys([]);
            prevRequiresUuidRef.current = needsUuid;
            prevRequiresPasswordRef.current = needsPassword;
        } else {
            const addProtocolSet = new Set<string>((currentTargets || []).map((item: any) => normalizeProtocol(item?.protocol)).filter(Boolean));
            const normalizedInboundProtocol = normalizeProtocol(currentInboundProtocol);
            if (addProtocolSet.size === 0 && normalizedInboundProtocol) {
                addProtocolSet.add(normalizedInboundProtocol);
            }
            const needsUuid = addProtocolSet.size === 0 || Array.from(addProtocolSet).some((item: string) => UUID_PROTOCOLS.has(item));
            const needsPassword = Array.from(addProtocolSet).some((item: string) => PASSWORD_PROTOCOLS.has(item));
            const ssKeyLength = resolveShadowsocks2022KeyLength(currentTargets || [], currentInboundProtocol);
            const generatedPassword = needsPassword
                ? generatePasswordForSources(currentTargets || [], currentInboundProtocol)
                : '';

            initialEditCredsRef.current = { email: '', uuid: '', password: '' };
            initialAfterFirstUseRef.current = null;
            lastAutoPasswordRef.current = generatedPassword;
            prevSs2022KeyLengthRef.current = ssKeyLength;

            setEmail('user_' + Math.random().toString(36).substring(7));
            setUuid(needsUuid ? generateUuidLocal() : '');
            setPassword(generatedPassword);
            setSubId('');
            setTotalGB(0);
            setExpiryTime(0);
            setExpiryMode('never');
            setExpiryDateTime('');
            setExpiryAfterDays('');
            setEnable(true);
            setLimitIp(0);
            setSpeedLimitUp(0);
            setSpeedLimitDown(0);
            setTgId('');
            setComment('');
            setReset(0);
            setGroup('');
            setResetDay(0);
            setResetWeekday(0);
            setResetMax(0);
            setClientTrafficReset('never');
            setClientTrafficResetDay(1);
            setAdvancedPanelOpen(false);
            setFlow('');
            setEditTargets([]);
            const uniqueServerIds = Array.from(new Set<string>((currentTargets || []).map((t: any) => String(t.serverId || '')).filter(Boolean)));
            setSelectedServerIds(uniqueServerIds);
            setSelectedInboundKeys((currentTargets || []).map((item) => getTargetKey(item)).filter(Boolean));
            prevRequiresUuidRef.current = needsUuid;
            prevRequiresPasswordRef.current = needsPassword;
        }
    }, [isOpen, sessionInitKey]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const loadFlowOptions = async () => {
            try {
                const res = await api.get('/protocol-schemas');
                const options = Array.isArray(res.data?.obj?.clientFlowOptions)
                    ? res.data.obj.clientFlowOptions
                    : [];
                const normalized = options.map((item) => String(item));
                if (!cancelled && normalized.length > 0) {
                    setBaseFlowOptions(normalized);
                }
                const protocolList = Array.isArray(res.data?.obj?.clientFlowProtocols)
                    ? res.data.obj.clientFlowProtocols.map((item) => String(item))
                    : [];
                if (!cancelled && protocolList.length > 0) {
                    setFlowProtocols(protocolList);
                }
            } catch {
                if (!cancelled) {
                    setBaseFlowOptions(['', 'xtls-rprx-vision']);
                    setFlowProtocols(['vless']);
                }
            }
        };
        loadFlowOptions();
        return () => { cancelled = true; };
    }, [isOpen]);

    const generateUUID = async () => {
        if (serverId) {
            try {
                const res = await api.get(`/panel/${serverId}/panel/api/server/getNewUUID`);
                if (res.data?.obj) {
                    setUuid(res.data.obj);
                    return;
                }
            } catch { }
        }
        setUuid(generateUuidLocal());
    };

    const availableServers = useMemo(() => {
        const map = new Map();
        (targets || []).forEach((item) => {
            if (!item?.serverId) return;
            if (!map.has(item.serverId)) {
                map.set(item.serverId, item.serverName || String(item.serverId));
            }
        });
        return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    }, [targets]);

    const targetKeysByServer = useMemo(() => {
        const map = new Map();
        (targets || []).forEach((item) => {
            const server = String(item?.serverId || '').trim();
            const key = getTargetKey(item);
            if (!server || !key) return;
            if (!map.has(server)) map.set(server, []);
            map.get(server).push(key);
        });
        return map;
    }, [targets]);

    const visibleTargets = useMemo(() => {
        if (!Array.isArray(targets) || targets.length === 0) return [];
        if (selectedServerIds.length === 0) return [];
        const selectedSet = new Set(selectedServerIds);
        return targets.filter((item) => selectedSet.has(item.serverId));
    }, [targets, selectedServerIds]);

    const visibleTargetKeys = useMemo(
        () => visibleTargets.map((item) => getTargetKey(item)).filter(Boolean),
        [visibleTargets]
    );

    const filteredTargets = useMemo(() => {
        if (visibleTargets.length === 0) return [];
        if (selectedInboundKeys.length === 0) return [];
        const selectedSet = new Set(selectedInboundKeys);
        return visibleTargets.filter((item) => selectedSet.has(getTargetKey(item)));
    }, [selectedInboundKeys, visibleTargets]);

    const activeProtocols = useMemo(() => {
        const protocols = [];
        if (editingClient && editTargets.length > 0) {
            protocols.push(...editTargets.map((item) => item?.protocol));
        } else if (!editingClient && filteredTargets.length > 0) {
            protocols.push(...filteredTargets.map((item) => item?.protocol));
        } else if (editingClient?.protocol) {
            protocols.push(editingClient.protocol);
        } else if (inboundProtocol) {
            protocols.push(inboundProtocol);
        }

        return Array.from(new Set(protocols.map((item) => normalizeProtocol(item)).filter(Boolean)));
    }, [editingClient, editTargets, filteredTargets, inboundProtocol]);

    const requiresUuidCredential = useMemo(() => {
        if (activeProtocols.length === 0) return true;
        return activeProtocols.some((item) => UUID_PROTOCOLS.has(item));
    }, [activeProtocols]);

    const requiresPasswordCredential = useMemo(
        () => activeProtocols.some((item) => PASSWORD_PROTOCOLS.has(item)),
        [activeProtocols]
    );

    const hasMixedCredentialTypes = requiresUuidCredential && requiresPasswordCredential;

    const flowProtocolSet = useMemo(
        () => new Set((flowProtocols || []).map((item) => String(item || '').toLowerCase()).filter(Boolean)),
        [flowProtocols]
    );

    const isFlowSupported = useMemo(() => {
        if (editingClient && editTargets.length > 0) {
            return editTargets.some((item) => flowProtocolSet.has(String(item.protocol || '').toLowerCase()));
        }
        if (!editingClient && filteredTargets.length > 0) {
            return filteredTargets.some((item) => flowProtocolSet.has(String(item.protocol || '').toLowerCase()));
        }
        if (editingClient && editingClient.protocol) {
            return flowProtocolSet.has(String(editingClient.protocol).toLowerCase());
        }
        if (inboundProtocol) {
            return flowProtocolSet.has(String(inboundProtocol).toLowerCase());
        }
        return false;
    }, [editingClient, editTargets, filteredTargets, flowProtocolSet, inboundProtocol]);

    useEffect(() => {
        if (!isFlowSupported && flow) {
            setFlow('');
        }
    }, [isFlowSupported, flow]);

    const serverContext = useOptionalServer();
    const knownServers = serverContext?.servers;
    // Which panel kinds this save reaches; unknown servers count as 3x-ui.
    const panelScope = useMemo(() => {
        const ids = new Set<string>();
        if (editingClient) {
            const scope = editTargets.length > 0 ? editTargets : [editingClient];
            scope.forEach((item: any) => ids.add(String(item?.serverId || serverId || '')));
        } else if (filteredTargets.length > 0) {
            filteredTargets.forEach((item: any) => ids.add(String(item?.serverId || '')));
        } else if (serverId) {
            ids.add(String(serverId));
        }
        ids.delete('');
        const servers = Array.isArray(knownServers) ? knownServers : [];
        const types = Array.from(ids).map((id) => {
            const match = servers.find((item: any) => String(item?.id) === id);
            return normalizePanelType(match?.panelType);
        });
        const allSui = types.length > 0 && types.every((type) => type === PANEL_TYPE_SUI);
        return { allSui, anyXui: !allSui };
    }, [editTargets, editingClient, filteredTargets, knownServers, serverId]);
    const showXuiOnlyFields = panelScope.anyXui;
    const weeklyRenewalConflict = resetWeekday > 0 && (Number(reset || 0) > 0 || resetDay > 0);

    const isEditingClient = Boolean(editingClient);
    const activeCredentialSources = useMemo(() => {
        if (editingClient) {
            return editTargets.length > 0 ? editTargets : [editingClient];
        }
        if (filteredTargets.length > 0) {
            return filteredTargets;
        }
        if (Array.isArray(targets) && targets.length > 0) {
            return targets;
        }
        return [{ protocol: inboundProtocol }];
    }, [editTargets, editingClient, filteredTargets, inboundProtocol, targets]);

    const currentSs2022KeyLength = useMemo(
        () => resolveShadowsocks2022KeyLength(activeCredentialSources, inboundProtocol),
        [activeCredentialSources, inboundProtocol]
    );

    useEffect(() => {
        if (!isOpen || isEditingClient) return;
        if (!prevRequiresUuidRef.current && requiresUuidCredential) {
            setUuid((prev) => prev || generateUuidLocal());
        }
        if (!prevRequiresPasswordRef.current && requiresPasswordCredential) {
            const nextPassword = generatePasswordForSources(activeCredentialSources, inboundProtocol);
            setPassword((prev) => {
                if (prev && prev !== lastAutoPasswordRef.current) return prev;
                lastAutoPasswordRef.current = nextPassword;
                return nextPassword;
            });
        } else if (
            requiresPasswordCredential
            && prevSs2022KeyLengthRef.current !== currentSs2022KeyLength
        ) {
            const nextPassword = generatePasswordForSources(activeCredentialSources, inboundProtocol);
            setPassword((prev) => {
                if (prev && prev !== lastAutoPasswordRef.current) return prev;
                lastAutoPasswordRef.current = nextPassword;
                return nextPassword;
            });
        }
        prevRequiresUuidRef.current = requiresUuidCredential;
        prevRequiresPasswordRef.current = requiresPasswordCredential;
        prevSs2022KeyLengthRef.current = currentSs2022KeyLength;
    }, [activeCredentialSources, currentSs2022KeyLength, inboundProtocol, isEditingClient, isOpen, requiresPasswordCredential, requiresUuidCredential]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        const isBatch = targets.length > 0;
        const isBatchEdit = !!editingClient && editTargets.length > 0;
        if (!isBatch && (!inboundId || !serverId)) {
            if (!isBatchEdit) {
                toast.error(t('comp.clients.missingServerOrInbound'));
                return;
            }
        }

        setLoading(true);

        try {
            if (isBatch) {
                const unsupported = filteredTargets.filter((item) => !BATCH_CLIENT_PROTOCOLS.has(String(item.protocol || '').toLowerCase()));
                if (unsupported.length > 0) {
                    toast.error(t('comp.clients.unsupportedBatchProtocol'));
                    setLoading(false);
                    return;
                }
            }

            if (isBatchEdit) {
                const unsupported = editTargets.filter((item) => !BATCH_CLIENT_PROTOCOLS.has(String(item.protocol || '').toLowerCase()));
                if (unsupported.length > 0) {
                    toast.error(t('comp.clients.unsupportedBatchEditProtocol'));
                    setLoading(false);
                    return;
                }
            }

            const normalizedUuid = String(uuid || '').trim();
            const normalizedPassword = String(password || '').trim();
            if (requiresUuidCredential && !normalizedUuid) {
                toast.error(t('comp.clients.uuidRequired'));
                setLoading(false);
                return;
            }
            if (requiresPasswordCredential && !normalizedPassword) {
                toast.error(t('comp.clients.passwordRequired'));
                setLoading(false);
                return;
            }

            let resolvedExpiryTime = 0;
            if (expiryMode === 'datetime') {
                resolvedExpiryTime = fromLocalDateTimeInput(expiryDateTime);
                if (!resolvedExpiryTime) {
                    toast.error(t('comp.clients.invalidExpiryDateTime'));
                    setLoading(false);
                    return;
                }
            } else if (expiryMode === 'days') {
                const days = Number(expiryAfterDays || 0);
                if (!Number.isFinite(days) || days <= 0) {
                    toast.error(t('comp.clients.invalidExpiryDays'));
                    setLoading(false);
                    return;
                }
                resolvedExpiryTime = Date.now() + (Math.floor(days) * 24 * 60 * 60 * 1000);
            } else if (expiryMode === 'after_first_use') {
                const days = Number(expiryAfterDays || 0);
                if (!Number.isFinite(days) || days <= 0) {
                    toast.error(t('comp.clients.invalidExpiryDays'));
                    setLoading(false);
                    return;
                }
                if (
                    initialAfterFirstUseRef.current
                    && String(Math.floor(days)) === initialAfterFirstUseRef.current.daysStr
                ) {
                    resolvedExpiryTime = initialAfterFirstUseRef.current.rawExpiry;
                } else {
                    resolvedExpiryTime = -(Math.floor(days) * 24 * 60 * 60 * 1000);
                }
            } else {
                resolvedExpiryTime = 0;
            }

            if (showXuiOnlyFields && weeklyRenewalConflict) {
                toast.error(t('comp.clients.renewWeeklyConflict'));
                setLoading(false);
                return;
            }

            // Newer-panel fields go out only when set or already present on the client,
            // so older panels keep receiving the payload they always did.
            const editingHas = (key: string) => Boolean(editingClient)
                && Object.prototype.hasOwnProperty.call(editingClient, key)
                && editingClient[key] !== undefined && editingClient[key] !== null;
            const panelExtras: Record<string, any> = {};
            const normalizedGroup = String(group || '').trim();
            if (normalizedGroup || editingHas('group')) panelExtras.group = normalizedGroup;
            if (showXuiOnlyFields) {
                const resetMaxValue = clampIntInput(resetMax, 0, Number.MAX_SAFE_INTEGER);
                if (resetDay > 0 || editingHas('resetDay')) panelExtras.resetDay = resetDay;
                if (resetWeekday > 0 || editingHas('resetWeekday')) panelExtras.resetWeekday = resetWeekday;
                if (resetMaxValue > 0 || editingHas('resetMax')) panelExtras.resetMax = resetMaxValue;
                if (clientTrafficReset !== 'never' || editingHas('trafficReset')) {
                    panelExtras.trafficReset = clientTrafficReset;
                    panelExtras.trafficResetDay = clampIntInput(clientTrafficResetDay, 1, 31);
                }
            }
            const extraDefaults: Record<string, any> = {
                group: '', resetDay: 0, resetWeekday: 0, resetMax: 0, trafficReset: 'never', trafficResetDay: 1,
            };
            const changedPanelExtras = Object.fromEntries(
                Object.entries(panelExtras).filter(([key, value]) => (
                    String(value) !== String(editingClient?.[key] ?? extraDefaults[key])
                ))
            );

            const derivedSubId = subId || buildStableSubId(email);
            const normalizedExpiryTime = resolvedExpiryTime < 0
                ? resolvedExpiryTime
                : Math.max(0, Number(resolvedExpiryTime || 0));
            const hasHysteriaTarget = activeProtocols.some((p) => p === 'hysteria' || p === 'hysteria2' || p === 'hy2');
            const hasTuicTarget = activeProtocols.includes('tuic');
            const clientData: Record<string, any> = {
                id: normalizedUuid,
                password: normalizedPassword,
                ...(hasHysteriaTarget ? { auth: normalizedPassword } : {}),
                ...(hasHysteriaTarget && editingClient && Object.prototype.hasOwnProperty.call(editingClient, 'auth_str')
                    ? { auth_str: normalizedPassword }
                    : {}),
                ...(hasTuicTarget ? { uuid: normalizedUuid } : {}),
                email,
                totalGB: gigabytesInputToBytes(totalGB),
                expiryTime: normalizedExpiryTime,
                enable,
                tgId: Number(tgId) || 0,
                subId: derivedSubId,
                comment: String(comment || '').trim(),
                reset: Math.max(0, Number(reset || 0)),
                limitIp: Number(limitIp),
                speedLimitUp: kilobytesInputToBytesPerSecond(speedLimitUp),
                speedLimitDown: kilobytesInputToBytesPerSecond(speedLimitDown),
                flow: isFlowSupported ? flow : '',
                ...panelExtras,
            };

            if (editingClient) {
                if (isBatchEdit) {
                    const isEmailChanged = String(email || '').trim() !== String(editingClient.email || '').trim();
                    const baselineUuid = String(editingClient.id || editingClient.uuid || '').trim() || initialEditCredsRef.current.uuid;
                    const baselinePassword = String(editingClient.password || editingClient.auth || editingClient.auth_str || '').trim() || initialEditCredsRef.current.password;
                    const isUuidChanged = normalizedUuid !== baselineUuid;
                    const isPasswordChanged = normalizedPassword !== baselinePassword;

                    const updateTargets = editTargets.map((item) => {
                        const isTotalGBChanged = gigabytesInputToBytes(totalGB) !== Number(editingClient.totalGB || 0);
                        const isExpiryTimeChanged = normalizedExpiryTime !== Number(editingClient.expiryTime || 0);
                        const isEnableChanged = enable !== (editingClient.enable !== false);
                        const isTgIdChanged = Number(tgId || 0) !== Number(editingClient.tgId || 0);
                        const isSubIdChanged = derivedSubId !== String(editingClient.subId || '').trim();
                        const isCommentChanged = String(comment || '').trim() !== String(editingClient.comment || '').trim();
                        const isResetChanged = Number(reset || 0) !== Number(editingClient.reset || 0);
                        const isLimitIpChanged = Number(limitIp || 0) !== Number(editingClient.limitIp || 0);
                        const isSpeedLimitUpChanged = kilobytesInputToBytesPerSecond(speedLimitUp) !== Number(editingClient.speedLimitUp || 0);
                        const isSpeedLimitDownChanged = kilobytesInputToBytesPerSecond(speedLimitDown) !== Number(editingClient.speedLimitDown || 0);
                        const isFlowChanged = flow !== (editingClient.flow || '');
                        const itemProto = normalizeProtocol(item.protocol);
                        const isItemHysteria = itemProto === 'hysteria' || itemProto === 'hysteria2' || itemProto === 'hy2';
                        const isItemTuic = itemProto === 'tuic';
                        const nextItemUuid = isUuidChanged ? normalizedUuid : (item.id || item.uuid || normalizedUuid);
                        const nextItemPassword = isPasswordChanged
                            ? normalizedPassword
                            : (item.password || item.auth || item.auth_str || normalizedPassword);

                        const mergedClient: Record<string, any> = {
                            ...item,
                            id: nextItemUuid,
                            ...(isItemTuic || Object.prototype.hasOwnProperty.call(item, 'uuid')
                                ? { uuid: isUuidChanged ? normalizedUuid : (item.uuid || item.id || normalizedUuid) }
                                : {}),
                            password: nextItemPassword,
                            ...(isItemHysteria || Object.prototype.hasOwnProperty.call(item, 'auth')
                                ? { auth: isPasswordChanged ? normalizedPassword : (item.auth || item.password || item.auth_str || normalizedPassword) }
                                : {}),
                            ...(Object.prototype.hasOwnProperty.call(item, 'auth_str')
                                ? { auth_str: isPasswordChanged ? normalizedPassword : (item.auth_str || item.password || item.auth || normalizedPassword) }
                                : {}),
                            email: isEmailChanged ? email : (item.email || email),
                            totalGB: isTotalGBChanged ? gigabytesInputToBytes(totalGB) : (item.totalGB || 0),
                            expiryTime: isExpiryTimeChanged ? normalizedExpiryTime : (item.expiryTime || 0),
                            enable: isEnableChanged ? enable : (item.enable !== false),
                            tgId: isTgIdChanged ? (Number(tgId) || 0) : (Number(item.tgId) || 0),
                            subId: isSubIdChanged ? derivedSubId : String(item.subId || '').trim(),
                            comment: isCommentChanged ? String(comment || '').trim() : String(item.comment || '').trim(),
                            reset: isResetChanged ? Number(reset || 0) : Number(item.reset || 0),
                            limitIp: isLimitIpChanged ? Number(limitIp || 0) : Number(item.limitIp || 0),
                            speedLimitUp: isSpeedLimitUpChanged ? kilobytesInputToBytesPerSecond(speedLimitUp) : (item.speedLimitUp || 0),
                            speedLimitDown: isSpeedLimitDownChanged ? kilobytesInputToBytesPerSecond(speedLimitDown) : (item.speedLimitDown || 0),
                            flow: isFlowChanged ? flow : (item.flow || ''),
                            ...changedPanelExtras,
                        };

                        if (!flowProtocolSet.has(String(item.protocol || '').toLowerCase())) {
                            mergedClient.flow = '';
                        }

                        return {
                            serverId: item.serverId,
                            serverName: item.serverName,
                            inboundId: item.inboundId,
                            protocol: item.protocol,
                            email: item.email || clientData.email,
                            clientIdentifier: item.clientIdentifier || resolveClientIdentifier(item, item.protocol),
                            client: mergedClient,
                        };
                    });

                    const batchPayload = await attachBatchRiskToken({
                        action: 'update',
                        targets: updateTargets,
                        client: clientData,
                    }, {
                        type: 'clients',
                        action: 'update',
                        targetCount: updateTargets.length,
                    });
                    const res = await api.post('/batch/clients', batchPayload);
                    assertOperationSucceeded(res, t('comp.clients.batchUpdateFailed'));

                    const output = res.data?.obj;
                    const summary = output?.summary || {
                        success: 0,
                        total: updateTargets.length,
                        failed: updateTargets.length,
                    };
                    onBatchResult?.(t('comp.clients.batchUpdateResult'), output || null);

                    const doneMsg = t('comp.clients.batchUpdateDone', {
                        success: summary.success,
                        total: summary.total,
                    });
                    if (summary.failed === 0) {
                        toast.success(doneMsg);
                    } else {
                        toast.error(doneMsg);
                    }
                    onSuccess();
                    onClose();
                    setLoading(false);
                    return;
                }

                const clientIdentifier = resolveClientIdentifier(editingClient, editingClient.protocol || inboundProtocol);
                if (!clientIdentifier) {
                    throw new Error(t('comp.clients.missingClientId'));
                }

                const params = new URLSearchParams();
                params.append('id', inboundId);
                params.append('settings', JSON.stringify({ clients: [clientData] }));

                let updateMsg = t('comp.clients.userUpdated');
                try {
                    const updateRes = await api.post(
                        `/panel/${serverId}/panel/api/inbounds/updateClient/${encodeURIComponent(clientIdentifier)}`,
                        params,
                        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                    );
                    assertOperationSucceeded(updateRes, t('comp.clients.updateFailed'));
                    updateMsg = resolveResponseMsg(updateRes.data, updateMsg);
                } catch {
                    // Backward compatibility for older/forked 3x-ui update payloads.
                    const fallbackRes = await api.post(
                        `/panel/${serverId}/panel/api/inbounds/updateClient/${encodeURIComponent(clientIdentifier)}`,
                        clientData
                    );
                    assertOperationSucceeded(fallbackRes, t('comp.clients.updateFailed'));
                    updateMsg = resolveResponseMsg(fallbackRes.data, updateMsg);
                }
                toast.success(updateMsg);
            } else {
                // Add mode
                if (isBatch) {
                    if (filteredTargets.length === 0) {
                        toast.error(t('comp.clients.selectInboundFirst'));
                        setLoading(false);
                        return;
                    }

                    const batchTargets = filteredTargets.map((target) => {
                        const targetProto = normalizeProtocol(target.protocol);
                        return {
                            serverId: target.serverId,
                            serverName: target.serverName,
                            inboundId: target.id,
                            protocol: target.protocol,
                            email: clientData.email,
                            client: {
                                ...clientData,
                                ...(targetProto === 'hysteria' || targetProto === 'hysteria2' || targetProto === 'hy2'
                                    ? { auth: normalizedPassword }
                                    : {}),
                                ...(targetProto === 'tuic' ? { uuid: normalizedUuid } : {}),
                                flow: flowProtocolSet.has(targetProto) ? clientData.flow : '',
                            },
                        };
                    });

                    const batchPayload = await attachBatchRiskToken({
                        action: 'add',
                        targets: batchTargets,
                        client: clientData,
                    }, {
                        type: 'clients',
                        action: 'add',
                        targetCount: batchTargets.length,
                    });
                    const res = await api.post('/batch/clients', batchPayload);
                    assertOperationSucceeded(res, t('comp.clients.batchAddFailed'));

                    const output = res.data?.obj;
                    const summary = output?.summary || {
                        success: 0,
                        total: filteredTargets.length,
                        failed: filteredTargets.length,
                    };
                    onBatchResult?.(t('comp.clients.batchAddResult'), output || null);

                    if (summary.failed === 0) {
                        toast.success(t('comp.clients.batchAddDone', { success: summary.success }));
                    } else {
                        toast.error(t('comp.clients.batchPartial', {
                            success: summary.success,
                            failed: summary.failed,
                        }));
                    }

                } else {
                    // Single Add
                    const settings = { clients: [clientData] };
                    const params = new URLSearchParams();
                    params.append('id', inboundId);
                    params.append('settings', JSON.stringify(settings));

                    const addRes = await api.post(`/panel/${serverId}/panel/api/inbounds/addClient`, params, {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                    assertOperationSucceeded(addRes, t('comp.clients.addFailed'));
                    toast.success(resolveResponseMsg(addRes?.data, t('comp.clients.userAdded')));
                }
            }
            onSuccess();
            onClose();
        } catch (err) {
            const msg = err.response?.data?.msg || err.message || t('comp.common.unknownError');
            toast.error(editingClient
                ? t('comp.clients.updateFailedWithMsg', { msg })
                : t('comp.clients.addFailedWithMsg', { msg }));
        }
        setLoading(false);
    };

    if (!isOpen) return null;

    return (
        <ModalShell isOpen={isOpen} onClose={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">
                        {editingClient
                            ? (editTargets.length > 0
                                ? t('comp.clients.modalBatchEditTitle', { count: editTargets.length })
                                : t('comp.clients.modalEditTitle'))
                            : (targets.length > 0
                                ? t('comp.clients.modalBatchAddTitle', {
                                    selected: filteredTargets.length,
                                    total: targets.length,
                                })
                                : t('comp.clients.modalAddTitle'))}
                    </h3>
                    <button type="button" className="modal-close" onClick={onClose} aria-label={t('comp.common.close')} title={t('comp.common.close')}><HiOutlineXMark /></button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {targets.length > 0 && !editingClient && (
                            <div className="mb-4 p-3 rounded bg-surface-soft text-xs text-secondary border border-stroke-soft">
                                <div className="mb-2">
                                    <strong>{t('comp.clients.targetNodes', {
                                        selected: selectedServerIds.length,
                                        total: availableServers.length,
                                    })}</strong>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    <label className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                        <input name="clientModalField"
                                            type="checkbox"
                                            checked={availableServers.length > 0 && selectedServerIds.length === availableServers.length}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedServerIds(availableServers.map((item) => item.id));
                                                    setSelectedInboundKeys((targets || []).map((item) => getTargetKey(item)).filter(Boolean));
                                                } else {
                                                    setSelectedServerIds([]);
                                                    setSelectedInboundKeys([]);
                                                }
                                            }}
                                        />
                                        <span>{t('comp.clients.selectAll')}</span>
                                    </label>
                                    {availableServers.map((item) => (
                                        <label key={item.id} className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                            <input name="clientModalField2"
                                                type="checkbox"
                                            checked={selectedServerIds.includes(item.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedServerIds((prev) => [...new Set([...prev, item.id])]);
                                                    setSelectedInboundKeys((prev) => {
                                                        const next = new Set(prev);
                                                        const serverKeys = targetKeysByServer.get(item.id) || [];
                                                        serverKeys.forEach((key) => next.add(key));
                                                        return Array.from(next);
                                                    });
                                                } else {
                                                    setSelectedServerIds((prev) => prev.filter((id) => id !== item.id));
                                                    setSelectedInboundKeys((prev) => {
                                                        const removeSet = new Set(targetKeysByServer.get(item.id) || []);
                                                        return prev.filter((key) => !removeSet.has(key));
                                                    });
                                                }
                                            }}
                                        />
                                        <span>{item.name}</span>
                                    </label>
                                ))}
                            </div>
                                <div className="mb-2">
                                    <strong>{t('comp.clients.targetInbounds', {
                                        selected: filteredTargets.length,
                                        total: visibleTargets.length,
                                    })}</strong>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    <label className="badge badge-neutral flex items-center gap-2 cursor-pointer">
                                        <input name="clientModalField3"
                                            type="checkbox"
                                            checked={visibleTargets.length > 0 && filteredTargets.length === visibleTargets.length}
                                            onChange={(e) => {
                                                const visibleSet = new Set(visibleTargetKeys);
                                                if (e.target.checked) {
                                                    setSelectedInboundKeys((prev) => Array.from(new Set([...prev, ...visibleTargetKeys])));
                                                } else {
                                                    setSelectedInboundKeys((prev) => prev.filter((key) => !visibleSet.has(key)));
                                                }
                                            }}
                                        />
                                        <span>{t('comp.clients.selectAllInboundsOnNode')}</span>
                                    </label>
                                </div>
                                <div className="max-h-48 overflow-y-auto border border-border-color rounded-xl p-2.5 bg-surface-subtle">
                                    {visibleTargets.length === 0 ? (
                                        <div className="text-muted">{t('comp.clients.selectNodeFirst')}</div>
                                    ) : (
                                        <div className="flex flex-col gap-1">
                                            {visibleTargets.map((target) => {
                                                const key = getTargetKey(target);
                                                const checked = selectedInboundKeys.includes(key);
                                                return (
                                                    <label
                                                        key={key}
                                                        className="flex items-center gap-2 cursor-pointer"
                                                        title={`[${target.serverName}] ${target.remark} (${target.protocol}:${target.port})`}
                                                    >
                                                        <input name="clientModalField4"
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setSelectedInboundKeys((prev) => [...new Set([...prev, key])]);
                                                                } else {
                                                                    setSelectedInboundKeys((prev) => prev.filter((item) => item !== key));
                                                                }
                                                            }}
                                                        />
                                                        <span>
                                                            [{target.serverName}] {target.remark} ({target.protocol}:{target.port})
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {editingClient && editTargets.length > 0 && (
                            <div className="mb-4 p-3 rounded bg-surface-soft text-xs text-secondary border border-stroke-soft">
                                <strong>{t('comp.clients.syncToInstances')}</strong>
                                <ul className="mt-1 list-disc list-inside">
                                    {editTargets.map((t, idx) => (
                                        <li key={`${t.serverId}-${t.inboundId}-${idx}`}>
                                            [{t.serverName}] {t.inboundRemark || t.protocol} ({t.inboundPort})
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="form-group">
                            <label htmlFor="client-modal-email" className="form-label">Email</label>
                            <input id="client-modal-email" name="clientModalEmail" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required />
                        </div>

                        {requiresUuidCredential && (
                            <div className="form-group">
                                <label htmlFor="client-modal-uuid" className="form-label">UUID</label>
                                <div className="flex gap-2">
                                    <input id="client-modal-uuid" name="clientModalUuid" className="form-input font-mono" value={uuid} onChange={e => setUuid(e.target.value)} required={requiresUuidCredential} />
                                    <button type="button" className="btn btn-secondary btn-icon" onClick={generateUUID} title={t('comp.clients.genUuidTitle')} aria-label={t('comp.clients.genUuidTitle')}>
                                        <HiOutlineArrowPath />
                                    </button>
                                </div>
                            </div>
                        )}

                        {requiresPasswordCredential && (
                            <div className="form-group">
                                <label htmlFor="client-modal-clients-password-label" className="form-label">{t('comp.clients.passwordLabel')}</label>
                                <div className="flex gap-2">
                                    <input id="client-modal-clients-password-label" name="clientModalClientsPasswordLabel" className="form-input font-mono" value={password} onChange={e => setPassword(e.target.value)} required={requiresPasswordCredential} />
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-icon"
                                        onClick={() => {
                                            const nextPassword = generatePasswordForSources(activeCredentialSources, inboundProtocol);
                                            lastAutoPasswordRef.current = nextPassword;
                                            setPassword(nextPassword);
                                        }}
                                        title={t('comp.clients.genPasswordTitle')}
                                        aria-label={t('comp.clients.genPasswordTitle')}
                                    >
                                        <HiOutlineArrowPath />
                                    </button>
                                </div>
                            </div>
                        )}

                        {hasMixedCredentialTypes && (
                            <div className="text-xs text-muted mb-4">
                                {t('comp.clients.mixedCredentialHint')}
                            </div>
                        )}

                        <div className="form-group">
                            <label htmlFor="client-modal-clients-sub-id-label" className="form-label">{t('comp.clients.subIdLabel')}</label>
                            <div className="flex gap-2">
                                <input id="client-modal-clients-sub-id-label" name="clientModalClientsSubIdLabel"
                                    className="form-input font-mono text-xs text-muted"
                                    value={subId || `(${t('comp.clients.autoGenerated')})`}
                                    readOnly
                                    title={t('comp.clients.subIdTitle')}
                                />
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-xs whitespace-nowrap"
                                    onClick={() => {
                                        setSubId(generateHexToken(8));
                                        toast.success(t('comp.clients.subIdRegenerated'));
                                    }}
                                >
                                    <HiOutlineArrowPath /> {t('comp.clients.subIdReset')}
                                </button>
                            </div>
                            <div className="text-xs text-muted mt-1">
                                {t('comp.clients.subIdResetHint')}
                            </div>
                        </div>

                        {isFlowSupported ? (
                            <div className="form-group">
                                <label htmlFor="client-modal-clients-flow-label" className="form-label">{t('comp.clients.flowLabel')}</label>
                                <select id="client-modal-clients-flow-label" name="clientModalClientsFlowLabel" className="form-select" value={flow} onChange={e => setFlow(e.target.value)}>
                                    {flowOptions.map((item) => (
                                        <option key={item || '__empty'} value={item}>
                                            {item ? item : t('comp.clients.notSet')}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="form-group">
                                <label htmlFor="client-modal-clients-flow-label-2" className="form-label">{t('comp.clients.flowLabel')}</label>
                                <input id="client-modal-clients-flow-label-2" name="clientModalClientsFlowLabel2" className="form-input" value={t('comp.clients.flowUnsupported')} disabled />
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="form-group">
                                <label htmlFor="client-modal-clients-traffic-limit-gb" className="form-label">{t('comp.clients.trafficLimitGb')}</label>
                                <input id="client-modal-clients-traffic-limit-gb" name="clientModalClientsTrafficLimitGb" className="form-input" type="number" value={totalGB} onChange={e => setTotalGB(e.target.value)} placeholder={t('comp.clients.unlimitedZero')} />
                            </div>
                            <div className="form-group">
                                <label htmlFor="client-modal-clients-expiry-policy" className="form-label">{t('comp.clients.expiryPolicy')}</label>
                                <select id="client-modal-clients-expiry-policy" name="clientModalClientsExpiryPolicy" className="form-select mb-2" value={expiryMode} onChange={(e) => setExpiryMode(e.target.value)}>
                                    <option value="never">{t('comp.clients.expiryNever')}</option>
                                    <option value="datetime">{t('comp.clients.expiryDatetime')}</option>
                                    <option value="days">{t('comp.clients.expiryDays')}</option>
                                    <option value="after_first_use">{locale === 'en-US' ? 'Expire N days after first use' : '首次使用后 N 天过期'}</option>
                                </select>
                                {expiryMode === 'datetime' && (
                                    <input name="clientModalExpiryDateTime"
                                        className="form-input"
                                        type="datetime-local"
                                        value={expiryDateTime}
                                        onChange={(e) => setExpiryDateTime(e.target.value)}
                                    />
                                )}
                                {(expiryMode === 'days' || expiryMode === 'after_first_use') && (
                                    <input name="clientModalExpiryAfterDays"
                                        className="form-input"
                                        type="number"
                                        min={1}
                                        value={expiryAfterDays}
                                        onChange={(e) => setExpiryAfterDays(e.target.value)}
                                        placeholder={t('comp.clients.expiryDaysPlaceholder')}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                            {panelScope.allSui ? (
                                <div className="form-group text-xs text-muted">{t('comp.clients.suiHiddenFieldsHint')}</div>
                            ) : (
                                <div className="form-group">
                                    <label htmlFor="client-modal-clients-ip-limit" className="form-label">{t('comp.clients.ipLimit')}</label>
                                    <input id="client-modal-clients-ip-limit" name="clientModalClientsIpLimit" className="form-input" type="number" min={0} value={limitIp} onChange={e => setLimitIp(e.target.value)} />
                                </div>
                            )}
                            <div className="form-group flex items-center pt-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input name="clientModalField5" type="checkbox" checked={enable} onChange={e => setEnable(e.target.checked)} />
                                    {t('comp.clients.enableUser')}
                                </label>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="form-group">
                                <label htmlFor="client-modal-speed-limit-up" className="form-label">{locale === 'en-US' ? 'Upload Speed Limit (KB/s)' : '上行限速 (KB/s)'}</label>
                                <input id="client-modal-speed-limit-up" name="clientModalSpeedLimitUp" className="form-input" type="number" min={0} value={speedLimitUp} onChange={e => setSpeedLimitUp(e.target.value)} />
                                <div className="text-xs text-muted mt-1">{locale === 'en-US' ? '0 = Unlimited' : '0 为不限速'}</div>
                            </div>
                            <div className="form-group">
                                <label htmlFor="client-modal-speed-limit-down" className="form-label">{locale === 'en-US' ? 'Download Speed Limit (KB/s)' : '下行限速 (KB/s)'}</label>
                                <input id="client-modal-speed-limit-down" name="clientModalSpeedLimitDown" className="form-input" type="number" min={0} value={speedLimitDown} onChange={e => setSpeedLimitDown(e.target.value)} />
                                <div className="text-xs text-muted mt-1">{locale === 'en-US' ? '0 = Unlimited' : '0 为不限速'}</div>
                            </div>
                            <div className="text-xs text-muted" style={{ gridColumn: '1 / -1', marginTop: '-0.5rem' }}>
                                {t('comp.clients.speedLimitPanelHint')}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                            {!panelScope.allSui && (
                                <div className="form-group">
                                    <label htmlFor="client-modal-clients-telegram-placeholder" className="form-label">Telegram ID</label>
                                    <input id="client-modal-clients-telegram-placeholder" name="clientModalClientsTelegramPlaceholder"
                                        className="form-input"
                                        inputMode="numeric"
                                        pattern="[0-9-]*"
                                        value={tgId}
                                        placeholder={t('comp.clients.telegramPlaceholder')}
                                        onChange={e => setTgId(e.target.value.replace(/[^0-9-]/g, ''))}
                                    />
                                    <div className="text-xs text-muted mt-1">{t('comp.clients.telegramHint')}</div>
                                </div>
                            )}
                            <div className="form-group">
                                <label htmlFor="client-modal-clients-traffic-reset-period" className="form-label">{t('comp.clients.trafficResetPeriod')}</label>
                                <select id="client-modal-clients-traffic-reset-period" name="clientModalClientsTrafficResetPeriod"
                                    className="form-select"
                                    value={reset}
                                    onChange={e => setReset(Number(e.target.value))}
                                >
                                    <option value={0}>{t('comp.clients.resetNever')}</option>
                                    <option value={1}>{t('comp.clients.resetDaily')}</option>
                                    <option value={7}>{t('comp.clients.resetWeekly')}</option>
                                    <option value={30}>{t('comp.clients.resetMonthly')}</option>
                                    <option value={90}>{t('comp.clients.resetQuarterly')}</option>
                                    {![0, 1, 7, 30, 90].includes(Number(reset || 0)) && (
                                        <option value={Number(reset || 0)}>{`${Number(reset || 0)} ${locale === 'en-US' ? 'days' : '天'}`}</option>
                                    )}
                                </select>
                                <div className="text-xs text-muted mt-1">{t('comp.clients.resetNeverHelp')}</div>
                            </div>
                        </div>

                        <div className="form-group mb-4">
                            <label htmlFor="client-modal-clients-comment-label" className="form-label">{t('comp.clients.commentLabel')}</label>
                            <textarea id="client-modal-clients-comment-label" name="clientModalClientsCommentLabel"
                                className="form-textarea"
                                rows={2}
                                value={comment}
                                placeholder={t('comp.clients.commentPlaceholder')}
                                onChange={e => setComment(e.target.value)}
                            />
                        </div>

                        <div className="form-group mb-4">
                            <label htmlFor="client-modal-clients-group" className="form-label">{t('comp.clients.groupLabel')}</label>
                            <input id="client-modal-clients-group" name="clientModalClientsGroup"
                                className="form-input"
                                maxLength={64}
                                value={group}
                                placeholder={t('comp.clients.groupPlaceholder')}
                                onChange={e => setGroup(e.target.value)}
                            />
                        </div>

                        {showXuiOnlyFields && (
                            <details
                                className="mb-4"
                                open={advancedPanelOpen}
                                onToggle={(e) => setAdvancedPanelOpen(e.currentTarget.open)}
                            >
                                <summary className="form-label cursor-pointer">{t('comp.clients.panelAdvancedTitle')}</summary>
                                <div className="text-xs text-muted mb-2">{t('comp.clients.panelAdvancedHint')}</div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label htmlFor="client-modal-clients-renew-day" className="form-label">{t('comp.clients.renewDayLabel')}</label>
                                        <select id="client-modal-clients-renew-day" name="clientModalClientsRenewDay"
                                            className="form-select"
                                            value={resetDay}
                                            onChange={e => setResetDay(clampIntInput(e.target.value, 0, 31))}
                                        >
                                            <option value={0}>{t('comp.clients.renewOff')}</option>
                                            {MONTH_DAYS.map((day) => (
                                                <option key={day} value={day}>{t('comp.clients.renewDayOption', { day })}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="client-modal-clients-renew-weekday" className="form-label">{t('comp.clients.renewWeekdayLabel')}</label>
                                        <select id="client-modal-clients-renew-weekday" name="clientModalClientsRenewWeekday"
                                            className="form-select"
                                            value={resetWeekday}
                                            aria-invalid={weeklyRenewalConflict || undefined}
                                            aria-describedby={weeklyRenewalConflict ? 'client-modal-clients-renew-conflict' : undefined}
                                            onChange={e => setResetWeekday(clampIntInput(e.target.value, 0, 7))}
                                        >
                                            <option value={0}>{t('comp.clients.renewOff')}</option>
                                            {WEEKDAYS.map((day) => (
                                                <option key={day} value={day}>{t(`comp.clients.weekday${day}`)}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                {weeklyRenewalConflict && (
                                    <div id="client-modal-clients-renew-conflict" className="text-xs text-danger mb-2" role="alert">
                                        {t('comp.clients.renewWeeklyConflict')}
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label htmlFor="client-modal-clients-renew-max" className="form-label">{t('comp.clients.renewMaxLabel')}</label>
                                        <input id="client-modal-clients-renew-max" name="clientModalClientsRenewMax"
                                            className="form-input"
                                            type="number"
                                            min={0}
                                            value={resetMax}
                                            onChange={e => setResetMax(e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="client-modal-clients-own-traffic-reset" className="form-label">{t('comp.clients.clientTrafficResetLabel')}</label>
                                        <select id="client-modal-clients-own-traffic-reset" name="clientModalClientsOwnTrafficReset"
                                            className="form-select"
                                            value={clientTrafficReset}
                                            onChange={e => setClientTrafficReset(normalizeTrafficResetCycle(e.target.value))}
                                        >
                                            {CLIENT_TRAFFIC_RESET_CYCLES.map((cycle) => (
                                                <option key={cycle} value={cycle}>
                                                    {t(`comp.clients.cycle${cycle.charAt(0).toUpperCase()}${cycle.slice(1)}`)}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="text-xs text-muted mt-1">{t('comp.clients.clientTrafficResetHint')}</div>
                                    </div>
                                </div>
                                {clientTrafficReset === 'monthly' && (
                                    <div className="form-group">
                                        <label htmlFor="client-modal-clients-own-traffic-reset-day" className="form-label">{t('comp.clients.clientTrafficResetDayLabel')}</label>
                                        <select id="client-modal-clients-own-traffic-reset-day" name="clientModalClientsOwnTrafficResetDay"
                                            className="form-select"
                                            value={clampIntInput(clientTrafficResetDay, 1, 31)}
                                            onChange={e => setClientTrafficResetDay(clampIntInput(e.target.value, 1, 31))}
                                        >
                                            {MONTH_DAYS.map((day) => (
                                                <option key={day} value={day}>{t('comp.clients.renewDayOption', { day })}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </details>
                        )}
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>{t('comp.common.cancel')}</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? <span className="spinner" /> : <><HiOutlineCheck /> {t('comp.common.save')}</>}
                        </button>
                    </div>
                </form>
            </div>
        </ModalShell>
    );
}
