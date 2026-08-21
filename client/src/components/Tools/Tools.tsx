import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServer } from '../../contexts/ServerContext';
import { useI18n } from '../../contexts/LanguageContext';
import Header from '../Layout/Header';
import { copyToClipboard, getErrorMessage } from '../../utils/format';
import toast from 'react-hot-toast';
import api from '../../api/client';
import {
    HiOutlineClipboard,
    HiOutlineArrowPath,
    HiOutlineWrench,
} from 'react-icons/hi2';
import EmptyState from '../UI/EmptyState';
import PageToolbar from '../UI/PageToolbar';
import PageServerSelector from '../UI/PageServerSelector';
import SectionHeader from '../UI/SectionHeader';
import usePageServerTarget from '../../hooks/usePageServerTarget';
import { readSessionSnapshot, writeSessionSnapshot } from '../../utils/sessionSnapshot';

const TOOLS_SNAPSHOT_TTL_MS = 2 * 60_000;

function buildToolsSnapshotKey(serverId: string | number) {
    return `tools_view_v1:${String(serverId || '').trim()}`;
}

function readToolsSnapshot(serverId: string | number) {
    const normalizedServerId = String(serverId || '').trim();
    if (!normalizedServerId) return null;

    const snapshot = readSessionSnapshot<any>(buildToolsSnapshotKey(normalizedServerId), {
        maxAgeMs: TOOLS_SNAPSHOT_TTL_MS,
        fallback: null,
    });
    if (!snapshot || typeof snapshot !== 'object') return null;

    return {
        tools: Array.isArray(snapshot?.tools) ? snapshot.tools : [],
        results: snapshot?.results && typeof snapshot.results === 'object' ? snapshot.results : {},
    };
}

function formatToolValue(value: any): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}

export interface ToolItem {
    key: string;
    label?: string;
    description?: string;
    uiAction?: string;
    supportedByNms?: boolean;
    available?: boolean;
    path?: string;
    method?: string;
    [key: string]: any;
}

export default function Tools() {
    const { activeServerId, servers = [], panelApi } = useServer();
    const { locale, t } = useI18n();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'node' | 'ssl' | 'ip'>('node');

    // Page Server Selection Target
    const {
        serverList,
        hasServers,
        targetServerId,
        hasTargetServer,
        isUsingPageServer,
        draftServerId,
        setDraftServerId,
        setPageTargetServerId,
        commitDraftServer,
    } = usePageServerTarget({ activeServerId, servers });
    const cachedState = hasTargetServer ? readToolsSnapshot(targetServerId) : null;
    const toolsCatalogRequestIdRef = useRef(0);
    const toolExecutionRequestIdRef = useRef(0);
    const [results, setResults] = useState<Record<string, string>>(() => cachedState?.results || {});
    const [loading, setLoading] = useState<Record<string, boolean>>({});
    const [catalogLoading, setCatalogLoading] = useState(() => hasTargetServer && cachedState == null);
    const [tools, setTools] = useState<ToolItem[]>(() => cachedState?.tools || []);

    // SSL Assistant States
    const [sslDomain, setSslDomain] = useState('');
    const [cfEmail, setCfEmail] = useState('');
    const [cfToken, setCfToken] = useState('');
    const [sslCertPath, setSslCertPath] = useState('/root/cert/cert.crt');
    const [sslKeyPath, setSslKeyPath] = useState('/root/cert/private.key');

    // IP Diagnostics States
    const [queryIp, setQueryIp] = useState('');
    const [ipResult, setIpResult] = useState<any>(null);
    const [ipLoading, setIpLoading] = useState(false);

    const copy = useMemo(() => (
        locale === 'en-US'
            ? {
                tabs: {
                    nodeTools: 'Node Panel Tools',
                    sslAssistant: 'SSL & ACME Assistant',
                    ipDiagnostics: 'IP & Geo Diagnostics',
                },
                catalogLoadFailed: 'Failed to load node tools',
                selectServerFirst: 'Select a server first',
                selectServerHint: 'Node tools only run against a single server. Choose a node to continue.',
                confirmServerTitle: 'Confirm target node',
                confirmServerHint: 'A node is preselected. Open it to load the available tools.',
                noServersHint: 'Add a server before running node tools.',
                goToServers: 'Open Servers',
                serverSelectorLabel: 'Target node',
                serverPlaceholder: 'Select node',
                openSelectedServer: 'Open Node',
                executeFailed: 'Run failed',
                copied: 'Copied to clipboard',
                toolbarTitle: 'Node Tooling',
                toolbarSubtitle: 'Run helper endpoints exposed by the current node and copy the result when needed.',
                refresh: 'Refresh',
                executable: 'Available',
                unavailable: 'Unavailable',
                currentTool: 'Current node tool',
                generate: 'Run',
                copy: 'Copy',
                meta: 'Available {enabled} / {total}',
                emptyTitle: 'No node tools available',
                emptySubtitle: 'Refresh once first. If it is still empty, check whether the node panel exposes any tool endpoints.',
                refreshCatalog: 'Refresh Tool Catalog',
                ssl: {
                    title: 'Cloudflare ACME Automated Certificate Generator',
                    subtitle: 'Generate standard one-click acme.sh wildcard TLS certificate deployment scripts for 3X-UI nodes.',
                    domainLabel: 'Domain Name (Root or Subdomain)',
                    domainPlaceholder: 'e.g. node.yourdomain.com or *.yourdomain.com',
                    emailLabel: 'Cloudflare Account Email (Optional)',
                    emailPlaceholder: 'e.g. your-cloudflare-account@example.com',
                    tokenLabel: 'Cloudflare API Token / Global Key',
                    tokenPlaceholder: 'Enter Cloudflare DNS API Token',
                    certPathLabel: 'Target Certificate Path on Node',
                    keyPathLabel: 'Target Private Key Path on Node',
                    scriptTitle: 'Generated One-Click Execution Script',
                    copyScript: 'Copy ACME Bash Script',
                    pathTip: 'Copy the certificate path and fill into your 3X-UI / Xray Inbound TLS configuration.',
                },
                ip: {
                    unknownCountry: 'Unknown',
                    lookupFailed: 'Lookup failed',
                    title: 'IP Geolocation & Routing Diagnostics',
                    subtitle: 'Inspect network ASN, location, carrier ISP, and reachability for any IP or server hostname.',
                    inputPlaceholder: 'Enter IP address or hostname (e.g. 1.1.1.1 or google.com)',
                    lookup: 'Query',
                    querying: 'Querying...',
                    ipLabel: 'IP Address',
                    locationLabel: 'Location & Country',
                    carrierLabel: 'Carrier / ISP',
                    asnLabel: 'ASN & Organization',
                    bogonLabel: 'Bogon / Private IP',
                }
            }
            : {
                tabs: {
                    nodeTools: '节点原生工具',
                    sslAssistant: 'SSL & ACME 证书助手',
                    ipDiagnostics: 'IP 归属地与网络诊断',
                },
                catalogLoadFailed: '加载节点工具失败',
                selectServerFirst: '请先选择一台服务器',
                selectServerHint: '节点工具仅支持单节点执行，选择一个节点后继续。',
                confirmServerTitle: '确认目标节点',
                confirmServerHint: '已预选节点，点击打开节点后加载可用工具。',
                noServersHint: '请先添加服务器，再运行节点工具。',
                goToServers: '前往服务器管理',
                serverSelectorLabel: '目标节点',
                serverPlaceholder: '选择节点',
                openSelectedServer: '打开节点',
                executeFailed: '执行失败',
                copied: '已复制到剪贴板',
                toolbarTitle: '节点工具集',
                toolbarSubtitle: '执行当前节点暴露的辅助工具接口，并支持直接复制结果。',
                refresh: '刷新',
                executable: '可执行',
                unavailable: '不可用',
                currentTool: '当前节点工具',
                generate: '生成',
                copy: '复制',
                meta: '可执行 {enabled} / {total}',
                emptyTitle: '暂无可用节点工具',
                emptySubtitle: '可以先刷新一次；如果仍为空，请检查节点面板是否暴露工具接口。',
                refreshCatalog: '刷新工具目录',
                ssl: {
                    title: 'Cloudflare ACME 证书自动化签发脚本助手',
                    subtitle: '快速生成基于 acme.sh 与 Cloudflare DNS API 的通配符证书一键申请与 3X-UI 自动配置脚本。',
                    domainLabel: '申请域名（支持通配符）',
                    domainPlaceholder: '例如 node.example.com 或 *.example.com',
                    emailLabel: 'Cloudflare 账号邮箱（可选）',
                    emailPlaceholder: '例如 your-cloudflare-account@example.com',
                    tokenLabel: 'Cloudflare DNS API Token',
                    tokenPlaceholder: '输入 Cloudflare API Token',
                    certPathLabel: '节点目标公钥路径 (Public Cert)',
                    keyPathLabel: '节点目标私钥路径 (Private Key)',
                    scriptTitle: '生成的一键执行 Shell 脚本',
                    copyScript: '复制完整 ACME 脚本',
                    pathTip: '申请成功后，请将公钥与私钥路径直接填写入站节点的 TLS 证书路径中。',
                },
                ip: {
                    unknownCountry: '未知',
                    lookupFailed: '查询失败',
                    title: 'IP 归属地与网络路由快速诊断',
                    subtitle: '查询任意 IP 或主机名的地理位置、ASN 机构、运营商网络及连通性。',
                    inputPlaceholder: '输入 IP 地址或主机名（例如 1.1.1.1 或 google.com）',
                    lookup: '诊断查询',
                    querying: '查询中...',
                    ipLabel: 'IP 地址',
                    locationLabel: '地理位置与国家',
                    carrierLabel: '网络运营商',
                    asnLabel: 'ASN 归属组织',
                    bogonLabel: '私有/保留地址',
                }
            }
    ), [locale]);

    const fetchCatalog = async (options: { preserveCurrent?: boolean } = {}) => {
        if (!hasTargetServer) {
            toolsCatalogRequestIdRef.current += 1;
            setTools([]);
            return;
        }
        const preserveCurrent = options.preserveCurrent === true;
        const requestId = toolsCatalogRequestIdRef.current + 1;
        toolsCatalogRequestIdRef.current = requestId;
        if (!preserveCurrent) {
            setCatalogLoading(true);
        }
        try {
            const res = await api.get(`/capabilities/${targetServerId}`);
            if (requestId !== toolsCatalogRequestIdRef.current) return;
            const entries = Object.values<any>(res.data?.obj?.tools || {})
                .filter((item) => item.uiAction === 'node_console' || item.uiAction === 'node_tools')
                .filter((item) => item.supportedByNms === true);
            setTools(entries);
        } catch (error) {
            if (requestId !== toolsCatalogRequestIdRef.current) return;
            const msg = getErrorMessage(error, copy.catalogLoadFailed, locale);
            toast.error(msg);
            if (!preserveCurrent) {
                setTools([]);
            }
        } finally {
            if (requestId === toolsCatalogRequestIdRef.current) {
                setCatalogLoading(false);
            }
        }
    };

    useEffect(() => {
        if (!hasTargetServer) {
            toolsCatalogRequestIdRef.current += 1;
            toolExecutionRequestIdRef.current += 1;
            setResults({});
            setTools([]);
            setCatalogLoading(false);
            return;
        }
        toolExecutionRequestIdRef.current += 1;
        const snapshot = readToolsSnapshot(targetServerId);
        setResults(snapshot?.results || {});
        setTools(snapshot?.tools || []);
        setCatalogLoading(snapshot == null);
        fetchCatalog({ preserveCurrent: snapshot != null });
    }, [targetServerId, hasTargetServer]);

    useEffect(() => {
        if (!hasTargetServer) return;
        writeSessionSnapshot(buildToolsSnapshotKey(targetServerId), {
            tools,
            results,
        });
    }, [hasTargetServer, results, targetServerId, tools]);

    const enabledTools = useMemo(
        () => tools.filter((item) => item.available !== false),
        [tools]
    );
    const toolbarMeta = copy.meta
        .replace('{enabled}', String(enabledTools.length))
        .replace('{total}', String(tools.length));
    const hasDraftServer = hasServers && Boolean(draftServerId);

    const handleGenerate = async (tool: ToolItem) => {
        if (!hasTargetServer) {
            toast.error(copy.selectServerFirst);
            return;
        }
        const requestId = toolExecutionRequestIdRef.current + 1;
        toolExecutionRequestIdRef.current = requestId;
        setLoading((prev) => ({ ...prev, [tool.key]: true }));
        try {
            const method = tool.method || 'get';
            const res = targetServerId === activeServerId && typeof panelApi === 'function'
                ? await panelApi(method, tool.path)
                : await api({ method, url: `/panel/${encodeURIComponent(targetServerId)}${tool.path}` });
            if (requestId !== toolExecutionRequestIdRef.current) return;
            setResults((prev) => ({
                ...prev,
                [tool.key]: formatToolValue(res.data?.obj),
            }));
        } catch (error) {
            if (requestId !== toolExecutionRequestIdRef.current) return;
            toast.error(getErrorMessage(error, copy.executeFailed, locale));
        }
        if (requestId === toolExecutionRequestIdRef.current) {
            setLoading((prev) => ({ ...prev, [tool.key]: false }));
        }
    };

    const handleCopy = async (text: string) => {
        await copyToClipboard(text);
        toast.success(copy.copied);
    };

    // Generated ACME script
    const generatedAcmeScript = useMemo(() => {
        const domain = sslDomain.trim() || 'yourdomain.com';
        const isWildcard = domain.startsWith('*.') || !domain.includes('.');
        const cleanDomain = domain.replace(/^\*\./, '');
        const domainsParam = isWildcard ? `-d ${cleanDomain} -d *.${cleanDomain}` : `-d ${domain}`;

        return `# ==========================================
# NMS 3X-UI Cloudflare ACME Automated Cert Issue
# ==========================================
mkdir -p /root/cert
curl https://get.acme.sh | sh -s email=${cfEmail.trim() || 'admin@example.com'}
source ~/.bashrc

export CF_Token="${cfToken.trim() || 'YOUR_CLOUDFLARE_API_TOKEN'}"
${cfEmail.trim() ? `export CF_Email="${cfEmail.trim()}"` : ''}

~/.acme.sh/acme.sh --set-default-ca --server letsencrypt
~/.acme.sh/acme.sh --issue --dns dns_cf ${domainsParam} --force

~/.acme.sh/acme.sh --install-cert ${domainsParam} \\
  --key-file "${sslKeyPath.trim() || '/root/cert/private.key'}" \\
  --fullchain-file "${sslCertPath.trim() || '/root/cert/cert.crt'}" \\
  --reloadcmd "x-ui restart || systemctl restart x-ui"

~/.acme.sh/acme.sh --upgrade --auto-upgrade
`;
    }, [cfEmail, cfToken, sslCertPath, sslDomain, sslKeyPath]);

    // Handle IP Lookup
    const handleIpLookup = async () => {
        const target = queryIp.trim();
        if (!target) return;
        setIpLoading(true);
        try {
            const res = await fetch(`https://ipwho.is/${encodeURIComponent(target)}`).then((r) => r.json());
            if (res && res.success !== false) {
                setIpResult({
                    ip: res.ip,
                    country: res.country,
                    countryCode: res.country_code,
                    flag: res.flag?.emoji || '🌐',
                    region: res.region,
                    city: res.city,
                    isp: res.connection?.isp || res.connection?.org,
                    asn: res.connection?.asn ? `AS${res.connection.asn} (${res.connection.org || ''})` : '-',
                    isBogon: res.is_bogon === true,
                });
            } else {
                setIpResult({
                    ip: target,
                    country: copy.ip.unknownCountry || '未知',
                    flag: '🌐',
                    region: '-',
                    city: '-',
                    isp: '-',
                    asn: '-',
                    isBogon: false,
                });
            }
        } catch {
            setIpResult({
                ip: target,
                country: copy.ip.lookupFailed || '查询失败',
                flag: '⚠️',
                region: '-',
                city: '-',
                isp: '-',
                asn: '-',
                isBogon: false,
            });
        } finally {
            setIpLoading(false);
        }
    };

    return (
        <>
            <Header title={t('pages.tools.title')} />
            <div className="page-content page-content--wide page-enter tools-page">
                {/* Sub-nav Tabs */}
                <div className="flex gap-2 mb-6 border-b border-stroke-soft pb-3">
                    <button
                        type="button"
                        className={`btn btn-sm ${activeTab === 'node' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setActiveTab('node')}
                    >
                        <HiOutlineWrench /> {copy.tabs.nodeTools}
                    </button>
                    <button
                        type="button"
                        className={`btn btn-sm ${activeTab === 'ssl' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setActiveTab('ssl')}
                    >
                        🔒 {copy.tabs.sslAssistant}
                    </button>
                    <button
                        type="button"
                        className={`btn btn-sm ${activeTab === 'ip' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setActiveTab('ip')}
                    >
                        🌐 {copy.tabs.ipDiagnostics}
                    </button>
                </div>

                {activeTab === 'node' && (
                    <>
                        {!hasTargetServer ? (
                            <EmptyState
                                title={hasDraftServer ? copy.confirmServerTitle : copy.selectServerFirst}
                                subtitle={hasServers ? (hasDraftServer ? copy.confirmServerHint : copy.selectServerHint) : copy.noServersHint}
                                icon={<HiOutlineWrench style={{ fontSize: '48px' }} />}
                                surface
                                action={hasServers ? (
                                    <div className="page-server-selection-action">
                                        <PageServerSelector
                                            servers={serverList}
                                            value={draftServerId}
                                            onChange={setDraftServerId}
                                            label={copy.serverSelectorLabel}
                                            placeholder={copy.serverPlaceholder}
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            onClick={commitDraftServer}
                                            disabled={!draftServerId}
                                        >
                                            {copy.openSelectedServer}
                                        </button>
                                    </div>
                                ) : (
                                    <button type="button" className="btn btn-primary" onClick={() => navigate('/servers')}>
                                        {copy.goToServers}
                                    </button>
                                )}
                            />
                        ) : (
                            <>
                                <PageToolbar
                                    className="card mb-6 tools-toolbar"
                                    compact
                                    main={(
                                        <div className="tools-toolbar-copy">
                                            <div className="tools-toolbar-title">{copy.toolbarTitle}</div>
                                            <div className="tools-toolbar-note">{copy.toolbarSubtitle}</div>
                                        </div>
                                    )}
                                    actions={(
                                        <>
                                        {isUsingPageServer && hasServers ? (
                                            <PageServerSelector
                                                servers={serverList}
                                                value={targetServerId}
                                                onChange={setPageTargetServerId}
                                                label={copy.serverSelectorLabel}
                                                placeholder={copy.serverPlaceholder}
                                            />
                                        ) : null}
                                        <button className="btn btn-secondary btn-sm" onClick={() => fetchCatalog()} disabled={catalogLoading}>
                                            <HiOutlineArrowPath className={catalogLoading ? 'spinning' : ''} /> {copy.refresh}
                                        </button>
                                        </>
                                    )}
                                    meta={<span>{toolbarMeta}</span>}
                                />
                                {tools.length === 0 && !catalogLoading ? (
                                    <EmptyState
                                        title={copy.emptyTitle}
                                        subtitle={copy.emptySubtitle}
                                        surface
                                        action={(
                                            <button type="button" className="btn btn-secondary" onClick={() => fetchCatalog()}>
                                                <HiOutlineArrowPath /> {copy.refreshCatalog}
                                            </button>
                                        )}
                                    />
                                ) : (
                                    <div className="tools-grid">
                                        {(enabledTools.length > 0 ? enabledTools : tools).map((tool) => (
                                            <div className="card tool-card" key={tool.key}>
                                                <SectionHeader
                                                    compact divider
                                                    title={tool.label || tool.key}
                                                    subtitle={tool.description || copy.currentTool}
                                                    meta={(
                                                        <span className={`badge ${tool.available === false ? 'badge-danger' : 'badge-success'}`}>
                                                            {tool.available === false ? copy.unavailable : copy.executable}
                                                        </span>
                                                    )}
                                                />

                                                {results[tool.key] && (
                                                    <div className="tool-card-result">
                                                        {results[tool.key]}
                                                    </div>
                                                )}

                                                <div className="tool-card-actions">
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => handleGenerate(tool)}
                                                        disabled={loading[tool.key] || tool.available === false}
                                                    >
                                                        {loading[tool.key] ? <span className="spinner" /> : <HiOutlineArrowPath />}
                                                        {copy.generate}
                                                    </button>
                                                    {results[tool.key] && (
                                                        <button className="btn btn-secondary btn-sm" onClick={() => handleCopy(results[tool.key])}>
                                                            <HiOutlineClipboard /> {copy.copy}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}

                {activeTab === 'ssl' && (
                    <div className="card p-6 space-y-6">
                        <SectionHeader
                            title={copy.ssl.title}
                            subtitle={copy.ssl.subtitle}
                            divider
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div className="form-group">
                                <label className="form-label font-semibold">{copy.ssl.domainLabel}</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder={copy.ssl.domainPlaceholder}
                                    value={sslDomain}
                                    onChange={(e) => setSslDomain(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label font-semibold">{copy.ssl.tokenLabel}</label>
                                <input
                                    type="password"
                                    className="form-input"
                                    placeholder={copy.ssl.tokenPlaceholder}
                                    value={cfToken}
                                    onChange={(e) => setCfToken(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label font-semibold">{copy.ssl.emailLabel}</label>
                                <input
                                    type="email"
                                    className="form-input"
                                    placeholder={copy.ssl.emailPlaceholder || 'admin@example.com'}
                                    value={cfEmail}
                                    onChange={(e) => setCfEmail(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label font-semibold">{copy.ssl.certPathLabel}</label>
                                <input
                                    type="text"
                                    className="form-input font-mono text-sm"
                                    value={sslCertPath}
                                    onChange={(e) => setSslCertPath(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label font-semibold">{copy.ssl.keyPathLabel}</label>
                                <input
                                    type="text"
                                    className="form-input font-mono text-sm"
                                    value={sslKeyPath}
                                    onChange={(e) => setSslKeyPath(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-3 pt-2">
                            <div className="flex justify-between items-center">
                                <label className="form-label font-semibold">{copy.ssl.scriptTitle}</label>
                                <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleCopy(generatedAcmeScript)}
                                >
                                    <HiOutlineClipboard /> {copy.ssl.copyScript}
                                </button>
                            </div>
                            <pre className="p-4 rounded-xl bg-surface-panel border border-stroke-soft font-mono text-xs overflow-x-auto text-text-primary leading-relaxed">
                                {generatedAcmeScript}
                            </pre>
                            <p className="text-xs text-muted">💡 {copy.ssl.pathTip}</p>
                        </div>
                    </div>
                )}

                {activeTab === 'ip' && (
                    <div className="card p-6 space-y-6">
                        <SectionHeader
                            title={copy.ip.title}
                            subtitle={copy.ip.subtitle}
                            divider
                        />

                        <div className="flex gap-3 max-w-xl">
                            <input
                                type="text"
                                className="form-input flex-1 font-mono text-sm"
                                placeholder={copy.ip.inputPlaceholder}
                                value={queryIp}
                                onChange={(e) => setQueryIp(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleIpLookup()}
                            />
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleIpLookup}
                                disabled={ipLoading || !queryIp.trim()}
                            >
                                {ipLoading ? <span className="spinner" /> : copy.ip.lookup}
                            </button>
                        </div>

                        {ipResult && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-stroke-soft animate-fade-in">
                                <div className="p-4 rounded-xl bg-surface-panel border border-stroke-soft">
                                    <div className="text-xs text-muted mb-1">{copy.ip.ipLabel}</div>
                                    <div className="text-base font-mono font-bold">{ipResult.ip}</div>
                                </div>
                                <div className="p-4 rounded-xl bg-surface-panel border border-stroke-soft">
                                    <div className="text-xs text-muted mb-1">{copy.ip.locationLabel}</div>
                                    <div className="text-base font-bold flex items-center gap-2">
                                        <span>{ipResult.flag}</span>
                                        <span>{ipResult.country} {ipResult.city ? `(${ipResult.city})` : ''}</span>
                                    </div>
                                </div>
                                <div className="p-4 rounded-xl bg-surface-panel border border-stroke-soft">
                                    <div className="text-xs text-muted mb-1">{copy.ip.carrierLabel}</div>
                                    <div className="text-sm font-semibold">{ipResult.isp || '-'}</div>
                                </div>
                                <div className="p-4 rounded-xl bg-surface-panel border border-stroke-soft">
                                    <div className="text-xs text-muted mb-1">{copy.ip.asnLabel}</div>
                                    <div className="text-xs font-mono text-muted">{ipResult.asn || '-'}</div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
