import React from 'react';
import toast from 'react-hot-toast';
import { copyToClipboard } from '../../utils/format';
import {
    ALPHA_NUM_CHARS,
    DEFAULT_MTPROTO_FAKE_TLS_DOMAIN,
    randomMtprotoSecret,
    randomString,
    randomUuid,
    randomWireguardPrivateKey,
    retargetMtprotoSecret,
} from './inboundRandom';

type Draft = Record<string, any>;
type Updater = (fn: (draft: Draft) => void) => void;

interface ProtocolSettingsPanelProps {
    protocol: string;
    settings: Draft;
    updateSettings: Updater;
    stream: Draft;
    updateStream: Updater;
    listen: string;
    port: string | number;
    locale: string;
}

const TUIC_SERVER_DEFAULTS = {
    certificate: '',
    private_key: '',
    congestion_control: 'bbr',
    alpn: ['h3'],
    udp_relay_mode: 'native',
    zero_rtt_handshake: false,
    log_level: 'info',
    max_idle_time: 15,
    authentication_timeout: 3,
    max_udp_relay_packet_size: 1500,
    sni: '',
};

function isObject(value: unknown): value is Draft {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstClient(draft: Draft): Draft {
    if (!Array.isArray(draft.clients)) draft.clients = [];
    if (!isObject(draft.clients[0])) {
        draft.clients[0] = { email: randomString(8, 'abcdefghijklmnopqrstuvwxyz0123456789'), enable: true };
    }
    return draft.clients[0];
}

function splitList(value: string): string[] {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function randomInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="border border-stroke-soft rounded-lg p-4 mb-4">
            <h4 className="text-secondary text-sm font-bold mb-3">{title}</h4>
            {children}
        </div>
    );
}

function Hint({ children }: { children: React.ReactNode }) {
    return <div className="text-xs text-muted mt-1">{children}</div>;
}

function NumberInput({ id, value, fallback, min, max, onChange, placeholder }: {
    id: string;
    value: unknown;
    fallback?: number;
    min?: number;
    max?: number;
    placeholder?: string;
    onChange: (next: number | '') => void;
}) {
    const shown = value === undefined || value === null ? '' : String(value);
    return (
        <input
            id={id}
            name={id}
            className="form-input"
            type="number"
            min={min}
            max={max}
            value={shown}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            onBlur={(e) => {
                if (e.target.value === '' && fallback !== undefined) onChange(fallback);
            }}
        />
    );
}

function SecretInput({ id, value, onChange, onGenerate, generateLabel, placeholder }: {
    id: string;
    value: string;
    onChange: (next: string) => void;
    onGenerate: () => void;
    generateLabel: string;
    placeholder?: string;
}) {
    return (
        <div className="flex gap-2">
            <input
                id={id}
                name={id}
                className="form-input font-mono"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={onGenerate}>{generateLabel}</button>
        </div>
    );
}

function AccountsEditor({ idPrefix, accounts, onChange, labels }: {
    idPrefix: string;
    accounts: Array<{ user?: string; pass?: string }>;
    onChange: (next: Array<{ user: string; pass: string }>) => void;
    labels: { user: string; pass: string; add: string; remove: string; empty: string };
}) {
    const rows = accounts.map((row) => ({ user: String(row?.user || ''), pass: String(row?.pass || '') }));
    return (
        <div>
            {rows.length === 0 && <div className="text-xs text-muted mb-2">{labels.empty}</div>}
            {rows.map((row, index) => (
                <div key={index} className="grid grid-cols-2 gap-2 mb-2 items-end">
                    <div className="form-group">
                        <label htmlFor={`${idPrefix}-user-${index}`} className="form-label text-xs">{labels.user}</label>
                        <input
                            id={`${idPrefix}-user-${index}`}
                            name={`${idPrefix}-user-${index}`}
                            className="form-input"
                            value={row.user}
                            onChange={(e) => onChange(rows.map((item, i) => (i === index ? { ...item, user: e.target.value } : item)))}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor={`${idPrefix}-pass-${index}`} className="form-label text-xs">{labels.pass}</label>
                        <div className="flex gap-2">
                            <input
                                id={`${idPrefix}-pass-${index}`}
                                name={`${idPrefix}-pass-${index}`}
                                className="form-input font-mono"
                                value={row.pass}
                                onChange={(e) => onChange(rows.map((item, i) => (i === index ? { ...item, pass: e.target.value } : item)))}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                            >
                                {labels.remove}
                            </button>
                        </div>
                    </div>
                </div>
            ))}
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onChange([...rows, { user: randomString(8, ALPHA_NUM_CHARS), pass: randomString(12, ALPHA_NUM_CHARS) }])}
            >
                {labels.add}
            </button>
        </div>
    );
}

function salamanderPassword(stream: Draft, settings: Draft): string {
    const masks = Array.isArray(stream?.finalmask?.udp) ? stream.finalmask.udp : [];
    const mask = masks.find((item: any) => item?.type === 'salamander');
    if (mask) return String(mask?.settings?.password || '');
    const obfs = settings?.obfs;
    if (isObject(obfs) && obfs.type === 'salamander') return String(obfs.password || '');
    return '';
}

export default function ProtocolSettingsPanel({
    protocol,
    settings,
    updateSettings,
    stream,
    updateStream,
    listen,
    port,
    locale,
}: ProtocolSettingsPanelProps) {
    const en = locale === 'en-US';
    const L = (zh: string, english: string) => (en ? english : zh);
    const generate = L('随机生成', 'Generate');
    const client = Array.isArray(settings?.clients) && isObject(settings.clients[0]) ? settings.clients[0] : null;
    const certHint = L(
        '需要 TLS：在下方“安全”中填写证书路径；留空时自动使用该节点面板自身的 HTTPS 证书。',
        'Needs TLS. Enter certificate paths under Security below, or leave them empty to use the node panel\'s own HTTPS certificate.'
    );
    const clientHint = L(
        '这里只设置第一个用户，其余用户在“用户”页面管理。',
        'This sets the first user only. Manage other users on the Users page.'
    );

    if (protocol === 'hysteria' || protocol === 'hysteria2' || protocol === 'hy2') {
        const secret = String(client?.auth || client?.password || client?.auth_str || '');
        const setSecret = (next: string) => updateSettings((draft) => {
            const target = firstClient(draft);
            target.auth = next;
            target.password = next;
            if (Object.prototype.hasOwnProperty.call(target, 'auth_str')) target.auth_str = next;
        });
        const obfsPassword = salamanderPassword(stream, settings);
        const setObfsPassword = (next: string) => {
            updateStream((draft) => {
                const finalmask = isObject(draft.finalmask) ? draft.finalmask : {};
                const udp = (Array.isArray(finalmask.udp) ? finalmask.udp : []).filter((item: any) => item?.type !== 'salamander');
                if (next) udp.push({ type: 'salamander', settings: { password: next } });
                draft.finalmask = { ...finalmask, udp, tcp: Array.isArray(finalmask.tcp) ? finalmask.tcp : [] };
                if (draft.finalmask.udp.length === 0 && draft.finalmask.tcp.length === 0) delete draft.finalmask;
            });
            if (settings?.obfs !== undefined) updateSettings((draft) => { delete draft.obfs; });
        };
        const hy = isObject(stream?.hysteriaSettings) ? stream.hysteriaSettings : {};
        const masquerade = isObject(hy.masquerade) ? hy.masquerade : {};
        const masqueradeType = String(masquerade.type || '');
        const setMasquerade = (patch: Draft) => updateStream((draft) => {
            const current = isObject(draft.hysteriaSettings) ? draft.hysteriaSettings : { version: 2, udpIdleTimeout: 60 };
            const nextMasquerade = { ...(isObject(current.masquerade) ? current.masquerade : {}), ...patch };
            draft.hysteriaSettings = { ...current, version: 2 };
            if (!nextMasquerade.type) delete draft.hysteriaSettings.masquerade;
            else draft.hysteriaSettings.masquerade = nextMasquerade;
        });
        return (
            <Section title={L('Hysteria2 设置', 'Hysteria2 settings')}>
                <div className="form-group mb-3">
                    <label htmlFor="inbound-modal-client-password" className="form-label">{L('客户端密码', 'Client password')}</label>
                    <SecretInput
                        id="inbound-modal-client-password"
                        value={secret}
                        onChange={setSecret}
                        onGenerate={() => setSecret(randomString(16, ALPHA_NUM_CHARS))}
                        generateLabel={generate}
                    />
                    <Hint>{clientHint}</Hint>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-3">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-hy-obfs" className="form-label">{L('Salamander 混淆密码', 'Salamander obfuscation password')}</label>
                        <SecretInput
                            id="inbound-modal-hy-obfs"
                            value={obfsPassword}
                            onChange={setObfsPassword}
                            onGenerate={() => setObfsPassword(randomString(16, ALPHA_NUM_CHARS))}
                            generateLabel={generate}
                            placeholder={L('留空 = 不混淆', 'Empty = off')}
                        />
                        <Hint>{L('客户端需填写相同的混淆密码。', 'Clients must use the same password.')}</Hint>
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-hy-idle" className="form-label">{L('UDP 空闲超时（秒）', 'UDP idle timeout (seconds)')}</label>
                        <NumberInput
                            id="inbound-modal-hy-idle"
                            value={hy.udpIdleTimeout ?? 60}
                            fallback={60}
                            min={2}
                            max={600}
                            onChange={(next) => updateStream((draft) => {
                                const current = isObject(draft.hysteriaSettings) ? draft.hysteriaSettings : {};
                                draft.hysteriaSettings = { ...current, version: 2, udpIdleTimeout: next };
                            })}
                        />
                        <Hint>{L('2–600，默认 60', '2–600, default 60')}</Hint>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-hy-masquerade" className="form-label">{L('伪装（非代理访问时的响应）', 'Masquerade (reply to non-proxy visitors)')}</label>
                        <select
                            id="inbound-modal-hy-masquerade"
                            name="inbound-modal-hy-masquerade"
                            className="form-select"
                            value={masqueradeType}
                            onChange={(e) => setMasquerade({ type: e.target.value })}
                        >
                            <option value="">{L('默认 404 页面', 'Default 404 page')}</option>
                            <option value="proxy">{L('反向代理一个网站', 'Reverse-proxy a website')}</option>
                            <option value="string">{L('固定文本', 'Fixed text')}</option>
                            <option value="file">{L('静态文件目录', 'Static file directory')}</option>
                        </select>
                    </div>
                    {masqueradeType === 'proxy' && (
                        <div className="form-group">
                            <label htmlFor="inbound-modal-hy-masquerade-url" className="form-label">{L('网站地址', 'Website URL')}</label>
                            <input
                                id="inbound-modal-hy-masquerade-url"
                                name="inbound-modal-hy-masquerade-url"
                                className="form-input"
                                value={String(masquerade.url || '')}
                                placeholder="https://www.bing.com"
                                onChange={(e) => setMasquerade({ url: e.target.value, rewriteHost: true })}
                            />
                        </div>
                    )}
                    {masqueradeType === 'string' && (
                        <div className="form-group">
                            <label htmlFor="inbound-modal-hy-masquerade-content" className="form-label">{L('返回内容', 'Response text')}</label>
                            <input
                                id="inbound-modal-hy-masquerade-content"
                                name="inbound-modal-hy-masquerade-content"
                                className="form-input"
                                value={String(masquerade.content || '')}
                                onChange={(e) => setMasquerade({ content: e.target.value, statusCode: Number(masquerade.statusCode) || 200 })}
                            />
                        </div>
                    )}
                    {masqueradeType === 'file' && (
                        <div className="form-group">
                            <label htmlFor="inbound-modal-hy-masquerade-dir" className="form-label">{L('节点上的目录', 'Directory on the node')}</label>
                            <input
                                id="inbound-modal-hy-masquerade-dir"
                                name="inbound-modal-hy-masquerade-dir"
                                className="form-input"
                                value={String(masquerade.dir || '')}
                                placeholder="/var/www/html"
                                onChange={(e) => setMasquerade({ dir: e.target.value })}
                            />
                        </div>
                    )}
                </div>
                <Hint>{certHint}</Hint>
            </Section>
        );
    }

    if (protocol === 'tuic') {
        const server = isObject(settings?.server) ? settings.server : {};
        const setServer = (patch: Draft) => updateSettings((draft) => {
            draft.server = { ...TUIC_SERVER_DEFAULTS, ...(isObject(draft.server) ? draft.server : {}), ...patch };
        });
        const uuid = String(client?.uuid || client?.id || '');
        const setUuid = (next: string) => updateSettings((draft) => {
            const target = firstClient(draft);
            target.uuid = next;
            target.id = next;
        });
        const password = String(client?.password || '');
        const setPassword = (next: string) => updateSettings((draft) => { firstClient(draft).password = next; });
        return (
            <Section title={L('TUIC 设置', 'TUIC settings')}>
                <div className="grid grid-cols-2 gap-4 mb-3">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-tuic-uuid" className="form-label">UUID</label>
                        <SecretInput id="inbound-modal-tuic-uuid" value={uuid} onChange={setUuid} onGenerate={() => setUuid(randomUuid())} generateLabel={generate} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-tuic-password" className="form-label">{L('客户端密码', 'Client password')}</label>
                        <SecretInput
                            id="inbound-modal-tuic-password"
                            value={password}
                            onChange={setPassword}
                            onGenerate={() => setPassword(randomString(16, ALPHA_NUM_CHARS))}
                            generateLabel={generate}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-4 mb-1">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-tuic-cc" className="form-label">{L('拥塞控制', 'Congestion control')}</label>
                        <select
                            id="inbound-modal-tuic-cc"
                            name="inbound-modal-tuic-cc"
                            className="form-select"
                            value={String(server.congestion_control || 'bbr')}
                            onChange={(e) => setServer({ congestion_control: e.target.value })}
                        >
                            <option value="bbr">bbr</option>
                            <option value="cubic">cubic</option>
                            <option value="new_reno">new_reno</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-tuic-udp" className="form-label">{L('UDP 转发模式', 'UDP relay mode')}</label>
                        <select
                            id="inbound-modal-tuic-udp"
                            name="inbound-modal-tuic-udp"
                            className="form-select"
                            value={String(server.udp_relay_mode || 'native')}
                            onChange={(e) => setServer({ udp_relay_mode: e.target.value })}
                        >
                            <option value="native">native</option>
                            <option value="quic">quic</option>
                        </select>
                    </div>
                    <div className="form-group inbound-inline-checkbox-group">
                        <label className="inbound-inline-checkbox-label">
                            <input
                                name="inbound-modal-tuic-zero-rtt"
                                type="checkbox"
                                checked={Boolean(server.zero_rtt_handshake)}
                                onChange={(e) => setServer({ zero_rtt_handshake: e.target.checked })}
                            />
                            {L('0-RTT 握手', '0-RTT handshake')}
                        </label>
                    </div>
                </div>
                <Hint>{clientHint} {certHint}</Hint>
            </Section>
        );
    }

    if (protocol === 'masque') {
        const password = String(client?.password || '');
        const setPassword = (next: string) => updateSettings((draft) => { firstClient(draft).password = next; });
        const address = Array.isArray(settings?.address) ? settings.address.join(', ') : '';
        return (
            <Section title={L('MASQUE 设置', 'MASQUE settings')}>
                <div className="form-group mb-3">
                    <label htmlFor="inbound-modal-masque-password" className="form-label">{L('客户端密码', 'Client password')}</label>
                    <SecretInput
                        id="inbound-modal-masque-password"
                        value={password}
                        onChange={setPassword}
                        onGenerate={() => setPassword(randomString(16, ALPHA_NUM_CHARS))}
                        generateLabel={generate}
                    />
                    <Hint>{clientHint}</Hint>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-masque-address" className="form-label">{L('客户端地址池', 'Client address pool')}</label>
                        <input
                            id="inbound-modal-masque-address"
                            name="inbound-modal-masque-address"
                            className="form-input font-mono"
                            value={address}
                            placeholder="10.14.0.1/24, fd14::1/64"
                            onChange={(e) => updateSettings((draft) => { draft.address = splitList(e.target.value); })}
                        />
                        <Hint>{L('逗号分隔，留空使用默认地址池。', 'Comma-separated. Leave empty for the default pool.')}</Hint>
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-masque-mtu" className="form-label">MTU</label>
                        <NumberInput
                            id="inbound-modal-masque-mtu"
                            value={settings?.mtu}
                            min={1280}
                            max={65535}
                            placeholder={L('默认', 'Default')}
                            onChange={(next) => updateSettings((draft) => {
                                if (next === '') delete draft.mtu;
                                else draft.mtu = next;
                            })}
                        />
                    </div>
                </div>
                <Hint>{certHint}</Hint>
            </Section>
        );
    }

    if (protocol === 'wireguard') {
        const legacyPeers = Array.isArray(settings?.peers) ? settings.peers.length : 0;
        return (
            <Section title={L('WireGuard 设置', 'WireGuard settings')}>
                <div className="form-group mb-3">
                    <label htmlFor="inbound-modal-wg-secret" className="form-label">{L('服务端私钥', 'Server private key')}</label>
                    <SecretInput
                        id="inbound-modal-wg-secret"
                        value={String(settings?.secretKey || '')}
                        onChange={(next) => updateSettings((draft) => { draft.secretKey = next; })}
                        onGenerate={() => updateSettings((draft) => { draft.secretKey = randomWireguardPrivateKey(); })}
                        generateLabel={generate}
                    />
                    <Hint>{L('客户端的密钥和内网地址由面板自动分配，无需手动填写。', 'Each client gets its keys and tunnel address from the panel automatically.')}</Hint>
                </div>
                <div className="grid grid-cols-3 gap-4 mb-3">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-wg-subnet" className="form-label">{L('客户端网段', 'Client subnet')}</label>
                        <input
                            id="inbound-modal-wg-subnet"
                            name="inbound-modal-wg-subnet"
                            className="form-input font-mono"
                            value={String(settings?.subnetIp ?? '10.0.0.0')}
                            onChange={(e) => updateSettings((draft) => { draft.subnetIp = e.target.value.trim(); })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-wg-cidr" className="form-label">{L('网段前缀长度', 'Subnet prefix length')}</label>
                        <NumberInput
                            id="inbound-modal-wg-cidr"
                            value={settings?.subnetCidr ?? 24}
                            fallback={24}
                            min={1}
                            max={32}
                            onChange={(next) => updateSettings((draft) => { draft.subnetCidr = next; })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-mtu" className="form-label">MTU</label>
                        <NumberInput
                            id="inbound-modal-mtu"
                            value={settings?.mtu ?? 1420}
                            fallback={1420}
                            min={576}
                            onChange={(next) => updateSettings((draft) => { draft.mtu = next; })}
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-wg-dns" className="form-label">{L('客户端 DNS', 'Client DNS')}</label>
                        <input
                            id="inbound-modal-wg-dns"
                            name="inbound-modal-wg-dns"
                            className="form-input font-mono"
                            value={String(settings?.dns || '')}
                            placeholder="1.1.1.1, 8.8.8.8"
                            onChange={(e) => updateSettings((draft) => {
                                if (e.target.value.trim()) draft.dns = e.target.value;
                                else delete draft.dns;
                            })}
                        />
                    </div>
                    <div className="form-group inbound-inline-checkbox-group">
                        <label className="inbound-inline-checkbox-label">
                            <input
                                name="inbound-modal-wg-no-kernel-tun"
                                type="checkbox"
                                checked={Boolean(settings?.noKernelTun)}
                                onChange={(e) => updateSettings((draft) => { draft.noKernelTun = e.target.checked; })}
                            />
                            {L('不使用内核 TUN', 'Do not use kernel TUN')}
                        </label>
                    </div>
                </div>
                {legacyPeers > 0 && (
                    <Hint>
                        {L(
                            `另有 ${legacyPeers} 个手动配置的对端（peers）会原样保留，可在专家模式中编辑。`,
                            `${legacyPeers} manually configured peer(s) are kept as they are. Edit them in Expert mode.`
                        )}
                    </Hint>
                )}
            </Section>
        );
    }

    if (protocol === 'amneziawg') {
        const server = isObject(settings?.server) ? settings.server : {};
        const setServer = (patch: Draft) => updateSettings((draft) => {
            draft.server = { ...(isObject(draft.server) ? draft.server : {}), ...patch };
        });
        const randomizeObfuscation = () => {
            const jmin = randomInt(20, 60);
            const s1 = randomInt(15, 150);
            let s2 = randomInt(15, 150);
            if (s1 + 56 === s2) s2 += 1;
            setServer({
                jc: randomInt(3, 10),
                jmin,
                jmax: jmin + randomInt(20, 120),
                s1,
                s2,
                s3: randomInt(5, 64),
                s4: randomInt(0, 32),
            });
        };
        const knobs: Array<[string, string, number, number]> = [
            ['jc', 'Jc', 0, 128],
            ['jmin', 'Jmin', 0, 65535],
            ['jmax', 'Jmax', 0, 65535],
            ['s1', 'S1', 0, 1552],
            ['s2', 'S2', 0, 1608],
            ['s3', 'S3', 0, 1636],
            ['s4', 'S4', 0, 32],
        ];
        return (
            <Section title={L('AmneziaWG 设置', 'AmneziaWG settings')}>
                <div className="grid grid-cols-2 gap-4 mb-3">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-awg-subnet" className="form-label">{L('客户端网段', 'Client subnet')}</label>
                        <input
                            id="inbound-modal-awg-subnet"
                            name="inbound-modal-awg-subnet"
                            className="form-input font-mono"
                            value={String(server.subnetIp ?? '10.8.1.0')}
                            onChange={(e) => setServer({ subnetIp: e.target.value.trim() })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-awg-cidr" className="form-label">{L('网段前缀长度', 'Subnet prefix length')}</label>
                        <NumberInput
                            id="inbound-modal-awg-cidr"
                            value={server.subnetCidr ?? 24}
                            fallback={24}
                            min={1}
                            max={32}
                            onChange={(next) => setServer({ subnetCidr: next })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-awg-dns1" className="form-label">{L('首选 DNS', 'Primary DNS')}</label>
                        <input
                            id="inbound-modal-awg-dns1"
                            name="inbound-modal-awg-dns1"
                            className="form-input font-mono"
                            value={String(server.primaryDns ?? '')}
                            onChange={(e) => setServer({ primaryDns: e.target.value.trim() })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-awg-dns2" className="form-label">{L('备用 DNS', 'Secondary DNS')}</label>
                        <input
                            id="inbound-modal-awg-dns2"
                            name="inbound-modal-awg-dns2"
                            className="form-input font-mono"
                            value={String(server.secondaryDns ?? '')}
                            onChange={(e) => setServer({ secondaryDns: e.target.value.trim() })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-awg-iface" className="form-label">{L('出口网卡', 'Outgoing interface')}</label>
                        <input
                            id="inbound-modal-awg-iface"
                            name="inbound-modal-awg-iface"
                            className="form-input font-mono"
                            value={String(server.externalInterface ?? '')}
                            placeholder={L('留空自动选择', 'Empty = automatic')}
                            onChange={(e) => setServer({ externalInterface: e.target.value.trim() })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-awg-mtu" className="form-label">MTU</label>
                        <NumberInput
                            id="inbound-modal-awg-mtu"
                            value={server.mtu}
                            min={576}
                            max={65535}
                            placeholder={L('默认', 'Default')}
                            onChange={(next) => setServer({ mtu: next === '' ? undefined : next })}
                        />
                    </div>
                </div>
                <div className="flex items-center justify-between mb-2">
                    <span className="form-label mb-0">{L('抗检测混淆参数', 'Anti-detection obfuscation')}</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={randomizeObfuscation}>
                        {L('随机生成', 'Randomize')}
                    </button>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-1">
                    {knobs.map(([key, label, min, max]) => (
                        <div className="form-group" key={key}>
                            <label htmlFor={`inbound-modal-awg-${key}`} className="form-label text-xs">{label}</label>
                            <NumberInput
                                id={`inbound-modal-awg-${key}`}
                                value={server[key]}
                                min={min}
                                max={max}
                                onChange={(next) => setServer({ [key]: next })}
                            />
                        </div>
                    ))}
                </div>
                <Hint>
                    {L(
                        '客户端的密钥和内网地址由面板自动分配。导出的客户端配置已包含这些混淆参数。',
                        'Clients get their keys and tunnel address from the panel. Exported client configs already include these values.'
                    )}
                </Hint>
            </Section>
        );
    }

    if (protocol === 'mtproto') {
        const domain = String(settings?.fakeTlsDomain || DEFAULT_MTPROTO_FAKE_TLS_DOMAIN);
        const secret = String(client?.secret || '');
        const host = (!listen || listen === '0.0.0.0' || listen === '::') ? L('节点IP', 'NODE_IP') : listen.replace(/^\[(.*)\]$/, '$1');
        const link = secret ? `tg://proxy?server=${host}&port=${port || 'PORT'}&secret=${secret}` : '';
        return (
            <Section title={L('MTProto（Telegram 代理）设置', 'MTProto (Telegram proxy) settings')}>
                <div className="form-group mb-3">
                    <label htmlFor="inbound-modal-fake-tls-domain" className="form-label">{L('伪装域名', 'Camouflage domain')}</label>
                    <input
                        id="inbound-modal-fake-tls-domain"
                        name="inbound-modal-fake-tls-domain"
                        className="form-input"
                        value={String(settings?.fakeTlsDomain ?? DEFAULT_MTPROTO_FAKE_TLS_DOMAIN)}
                        onChange={(e) => updateSettings((draft) => {
                            const nextDomain = e.target.value.trim();
                            draft.fakeTlsDomain = nextDomain;
                            if (nextDomain && Array.isArray(draft.clients)) {
                                draft.clients = draft.clients.map((item: any) => (
                                    isObject(item) ? { ...item, secret: retargetMtprotoSecret(item.secret, nextDomain) } : item
                                ));
                            }
                        })}
                    />
                    <Hint>{L('选一个可以访问的大型 HTTPS 网站；修改后用户密钥会自动更新。', 'Pick a large, reachable HTTPS site. User secrets update automatically when this changes.')}</Hint>
                </div>
                <div className="form-group mb-3">
                    <label htmlFor="inbound-modal-mtproto-secret" className="form-label">{L('第一个用户的密钥', 'First user\'s secret')}</label>
                    <SecretInput
                        id="inbound-modal-mtproto-secret"
                        value={secret}
                        onChange={(next) => updateSettings((draft) => { firstClient(draft).secret = next.trim(); })}
                        onGenerate={() => updateSettings((draft) => { firstClient(draft).secret = randomMtprotoSecret(domain); })}
                        generateLabel={generate}
                    />
                </div>
                {link && (
                    <div className="form-group">
                        <span className="form-label">{L('Telegram 连接链接', 'Telegram link')}</span>
                        <div className="flex gap-2 items-center">
                            <code className="text-xs font-mono break-all flex-1">{link}</code>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={async () => {
                                    await copyToClipboard(link);
                                    toast.success(L('链接已复制', 'Link copied'));
                                }}
                            >
                                {L('复制', 'Copy')}
                            </button>
                        </div>
                    </div>
                )}
            </Section>
        );
    }

    if (protocol === 'tunnel' || protocol === 'dokodemo-door') {
        const address = String(settings?.rewriteAddress ?? settings?.address ?? '');
        const targetPort = settings?.rewritePort ?? settings?.port;
        const network = String(settings?.allowedNetwork ?? settings?.network ?? 'tcp,udp');
        const portMap = isObject(settings?.portMap) ? settings.portMap : {};
        const portRows = Object.entries(portMap).map(([from, to]) => ({ from, to: String(to ?? '') }));
        const migrate = (draft: Draft) => {
            if (draft.address !== undefined) {
                if (draft.rewriteAddress === undefined) draft.rewriteAddress = draft.address;
                delete draft.address;
            }
            if (draft.port !== undefined) {
                if (draft.rewritePort === undefined && draft.port !== '' && Number(draft.port) > 0) draft.rewritePort = Number(draft.port);
                delete draft.port;
            }
            if (draft.network !== undefined) {
                if (draft.allowedNetwork === undefined) draft.allowedNetwork = draft.network;
                delete draft.network;
            }
            if (Array.isArray(draft.portMap)) draft.portMap = {};
        };
        const writePortMap = (rows: Array<{ from: string; to: string }>) => updateSettings((draft) => {
            migrate(draft);
            const next: Record<string, string> = {};
            rows.forEach((row, index) => {
                next[row.from || `__new${index}`] = row.to;
            });
            draft.portMap = next;
        });
        return (
            <Section title={L('Tunnel（端口转发）设置', 'Tunnel (port forwarding) settings')}>
                <div className="grid grid-cols-3 gap-4 mb-3">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-target-address" className="form-label">{L('转发到地址', 'Forward to address')}</label>
                        <input
                            id="inbound-modal-target-address"
                            name="inbound-modal-target-address"
                            className="form-input"
                            value={address}
                            placeholder={L('如 1.1.1.1 或 example.com', 'e.g. 1.1.1.1 or example.com')}
                            onChange={(e) => updateSettings((draft) => {
                                migrate(draft);
                                draft.rewriteAddress = e.target.value.trim();
                            })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-target-port" className="form-label">{L('转发到端口', 'Forward to port')}</label>
                        <NumberInput
                            id="inbound-modal-target-port"
                            value={targetPort === 0 ? '' : targetPort}
                            min={1}
                            max={65535}
                            placeholder={L('留空 = 原端口', 'Empty = same port')}
                            onChange={(next) => updateSettings((draft) => {
                                migrate(draft);
                                if (next === '' || next === 0) delete draft.rewritePort;
                                else draft.rewritePort = next;
                            })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-network" className="form-label">{L('允许的网络', 'Allowed network')}</label>
                        <select
                            id="inbound-modal-network"
                            name="inbound-modal-network"
                            className="form-select"
                            value={network}
                            onChange={(e) => updateSettings((draft) => {
                                migrate(draft);
                                draft.allowedNetwork = e.target.value;
                            })}
                        >
                            <option value="tcp,udp">TCP + UDP</option>
                            <option value="tcp">TCP</option>
                            <option value="udp">UDP</option>
                        </select>
                    </div>
                </div>
                <div className="form-group mb-3">
                    <label className="inbound-inline-checkbox-label">
                        <input
                            name="inbound-modal-tunnel-follow-redirect"
                            type="checkbox"
                            checked={Boolean(settings?.followRedirect)}
                            onChange={(e) => updateSettings((draft) => {
                                migrate(draft);
                                draft.followRedirect = e.target.checked;
                            })}
                        />
                        {L('透明代理模式（使用连接的原始目标）', 'Transparent proxy (use each connection\'s original destination)')}
                    </label>
                    <Hint>{L('开启后可不填转发地址，需要在节点上配置 iptables 重定向。', 'With this on, the forward address can stay empty. Requires iptables redirection on the node.')}</Hint>
                </div>
                <div className="form-group">
                    <span className="form-label">{L('按端口转发（可选）', 'Per-port forwarding (optional)')}</span>
                    {portRows.map((row, index) => (
                        <div className="grid grid-cols-2 gap-2 mb-2" key={index}>
                            <input
                                aria-label={L('入站端口', 'Incoming port')}
                                name={`inbound-modal-portmap-from-${index}`}
                                className="form-input font-mono"
                                value={row.from.startsWith('__new') ? '' : row.from}
                                placeholder={L('入站端口，如 5555', 'Incoming port, e.g. 5555')}
                                onChange={(e) => writePortMap(portRows.map((item, i) => (i === index ? { ...item, from: e.target.value.trim() } : item)))}
                            />
                            <div className="flex gap-2">
                                <input
                                    aria-label={L('转发目标', 'Forward target')}
                                    name={`inbound-modal-portmap-to-${index}`}
                                    className="form-input font-mono"
                                    value={row.to}
                                    placeholder="1.1.1.1:7777"
                                    onChange={(e) => writePortMap(portRows.map((item, i) => (i === index ? { ...item, to: e.target.value.trim() } : item)))}
                                />
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => writePortMap(portRows.filter((_, i) => i !== index))}>
                                    {L('删除', 'Remove')}
                                </button>
                            </div>
                        </div>
                    ))}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => writePortMap([...portRows, { from: '', to: '' }])}>
                        {L('添加端口转发', 'Add port forward')}
                    </button>
                </div>
            </Section>
        );
    }

    if (protocol === 'mixed' || protocol === 'socks') {
        const auth = String(settings?.auth || 'password');
        const accounts = Array.isArray(settings?.accounts) ? settings.accounts : [];
        return (
            <Section title={L('Mixed（SOCKS5 + HTTP）设置', 'Mixed (SOCKS5 + HTTP) settings')}>
                <div className="grid grid-cols-2 gap-4 mb-3">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-mixed-auth" className="form-label">{L('认证方式', 'Authentication')}</label>
                        <select
                            id="inbound-modal-mixed-auth"
                            name="inbound-modal-mixed-auth"
                            className="form-select"
                            value={auth}
                            onChange={(e) => updateSettings((draft) => {
                                draft.auth = e.target.value;
                                if (e.target.value === 'password' && (!Array.isArray(draft.accounts) || draft.accounts.length === 0)) {
                                    draft.accounts = [{ user: randomString(8, ALPHA_NUM_CHARS), pass: randomString(12, ALPHA_NUM_CHARS) }];
                                }
                            })}
                        >
                            <option value="password">{L('用户名和密码', 'Username and password')}</option>
                            <option value="noauth">{L('无需认证', 'No authentication')}</option>
                        </select>
                        {auth === 'noauth' && (
                            <Hint>{L('无需认证时任何人都能使用，请只监听 127.0.0.1 或内网地址。', 'Anyone can use it without authentication. Listen on 127.0.0.1 or a private address only.')}</Hint>
                        )}
                    </div>
                    <div className="form-group inbound-inline-checkbox-group">
                        <label className="inbound-inline-checkbox-label">
                            <input
                                name="inbound-modal-mixed-udp"
                                type="checkbox"
                                checked={Boolean(settings?.udp)}
                                onChange={(e) => updateSettings((draft) => { draft.udp = e.target.checked; })}
                            />
                            {L('允许 UDP', 'Allow UDP')}
                        </label>
                    </div>
                </div>
                {Boolean(settings?.udp) && (
                    <div className="form-group mb-3">
                        <label htmlFor="inbound-modal-mixed-ip" className="form-label">{L('UDP 回复地址', 'UDP reply address')}</label>
                        <input
                            id="inbound-modal-mixed-ip"
                            name="inbound-modal-mixed-ip"
                            className="form-input font-mono"
                            value={String(settings?.ip ?? '127.0.0.1')}
                            onChange={(e) => updateSettings((draft) => { draft.ip = e.target.value.trim(); })}
                        />
                        <Hint>{L('远程客户端要用 UDP 时，填写该节点的公网 IP。', 'Set this to the node\'s public IP if remote clients use UDP.')}</Hint>
                    </div>
                )}
                {auth === 'password' && (
                    <AccountsEditor
                        idPrefix="inbound-modal-mixed-account"
                        accounts={accounts}
                        onChange={(next) => updateSettings((draft) => { draft.accounts = next; })}
                        labels={{
                            user: L('用户名', 'Username'),
                            pass: L('密码', 'Password'),
                            add: L('添加账号', 'Add account'),
                            remove: L('删除', 'Remove'),
                            empty: L('至少需要一个账号。', 'Add at least one account.'),
                        }}
                    />
                )}
            </Section>
        );
    }

    if (protocol === 'http') {
        const accounts = Array.isArray(settings?.accounts) ? settings.accounts : [];
        return (
            <Section title={L('HTTP 代理设置', 'HTTP proxy settings')}>
                <AccountsEditor
                    idPrefix="inbound-modal-http-account"
                    accounts={accounts}
                    onChange={(next) => updateSettings((draft) => { draft.accounts = next; })}
                    labels={{
                        user: L('用户名', 'Username'),
                        pass: L('密码', 'Password'),
                        add: L('添加账号', 'Add account'),
                        remove: L('删除', 'Remove'),
                        empty: L('没有账号时任何人都能使用，请只监听 127.0.0.1 或内网地址。', 'Without accounts anyone can use it. Listen on 127.0.0.1 or a private address only.'),
                    }}
                />
                <div className="form-group mt-3">
                    <label className="inbound-inline-checkbox-label">
                        <input
                            name="inbound-modal-http-transparent"
                            type="checkbox"
                            checked={Boolean(settings?.allowTransparent)}
                            onChange={(e) => updateSettings((draft) => { draft.allowTransparent = e.target.checked; })}
                        />
                        {L('转发所有 HTTP 请求（不只是代理请求）', 'Forward all HTTP requests, not only proxy requests')}
                    </label>
                </div>
            </Section>
        );
    }

    if (protocol === 'tun') {
        return (
            <Section title={L('TUN（虚拟网卡）设置', 'TUN (virtual network adapter) settings')}>
                <div className="grid grid-cols-2 gap-4">
                    <div className="form-group">
                        <label htmlFor="inbound-modal-tun-name" className="form-label">{L('网卡名称', 'Adapter name')}</label>
                        <input
                            id="inbound-modal-tun-name"
                            name="inbound-modal-tun-name"
                            className="form-input font-mono"
                            value={String(settings?.name ?? 'xray0')}
                            onChange={(e) => updateSettings((draft) => { draft.name = e.target.value.trim(); })}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="inbound-modal-tun-mtu" className="form-label">MTU</label>
                        <NumberInput
                            id="inbound-modal-tun-mtu"
                            value={settings?.mtu ?? 1500}
                            fallback={1500}
                            min={576}
                            onChange={(next) => updateSettings((draft) => { draft.mtu = next; })}
                        />
                    </div>
                </div>
                <Hint>
                    {L(
                        '在节点上创建虚拟网卡，供节点本机流量使用；需要以 root/管理员身份运行，不产生用户和订阅。端口填任意未占用端口即可。',
                        'Creates a virtual adapter on the node for its own traffic. Needs root/administrator, and has no users or subscriptions. Any free port works.'
                    )}
                </Hint>
            </Section>
        );
    }

    return null;
}
