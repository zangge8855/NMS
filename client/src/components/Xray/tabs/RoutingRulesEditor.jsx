import React, { useState, useEffect } from 'react';
import XrayJsonEditor from '../XrayJsonEditor.jsx';
import { HiOutlineCodeBracket, HiOutlineSquares2X2, HiOutlinePlus, HiOutlineTrash, HiOutlineArrowUp, HiOutlineArrowDown } from 'react-icons/hi2';

export default function RoutingRulesEditor({ locale = 'zh-CN', value, onSave, saving = false }) {
    const [mode, setMode] = useState('visual'); // 'visual' or 'json'
    const [config, setConfig] = useState(() => {
        try {
            return typeof value === 'object' && value !== null ? JSON.parse(JSON.stringify(value)) : { domainStrategy: 'AsIs', rules: [] };
        } catch {
            return { domainStrategy: 'AsIs', rules: [] };
        }
    });

    useEffect(() => {
        try {
            if (value && typeof value === 'object') {
                setConfig(JSON.parse(JSON.stringify(value)));
            }
        } catch (e) {
            // ignore
        }
    }, [value]);

    const handleVisualSave = () => {
        onSave(config);
    };

    const addRule = () => {
        const newRules = [...(config.rules || [])];
        newRules.push({ type: 'field', outboundTag: 'direct', domain: [], ip: [] });
        setConfig({ ...config, rules: newRules });
    };

    const removeRule = (index) => {
        const newRules = [...(config.rules || [])];
        newRules.splice(index, 1);
        setConfig({ ...config, rules: newRules });
    };

    const moveRule = (index, direction) => {
        const newRules = [...(config.rules || [])];
        if (direction === -1 && index > 0) {
            const temp = newRules[index];
            newRules[index] = newRules[index - 1];
            newRules[index - 1] = temp;
        } else if (direction === 1 && index < newRules.length - 1) {
            const temp = newRules[index];
            newRules[index] = newRules[index + 1];
            newRules[index + 1] = temp;
        }
        setConfig({ ...config, rules: newRules });
    };

    const updateRule = (index, field, val) => {
        const newRules = [...(config.rules || [])];
        if (field === 'domain' || field === 'ip') {
            const arr = val.split(',').map(s => s.trim()).filter(Boolean);
            if (arr.length > 0) {
                newRules[index][field] = arr;
            } else {
                delete newRules[index][field];
            }
        } else {
            newRules[index][field] = val;
        }
        setConfig({ ...config, rules: newRules });
    };

    return (
        <div className="xray-routing-editor">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-white">{locale === 'en-US' ? 'Routing Rules' : '路由规则'}</h3>
                <div className="btn-group">
                    <button
                        className={`btn btn-sm ${mode === 'visual' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setMode('visual')}
                    >
                        <HiOutlineSquares2X2 className="mr-1" /> {locale === 'en-US' ? 'Visual' : '可视化'}
                    </button>
                    <button
                        className={`btn btn-sm ${mode === 'json' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setMode('json')}
                    >
                        <HiOutlineCodeBracket className="mr-1" /> {locale === 'en-US' ? 'JSON' : '代码'}
                    </button>
                </div>
            </div>

            {mode === 'json' ? (
                <XrayJsonEditor
                    locale={locale}
                    label=""
                    description={
                        locale === 'en-US'
                            ? 'Update the routing block (rules, domainStrategy, balancers). The api rule is automatically kept first by the server.'
                            : '更新 routing 段（rules、domainStrategy、balancers）。服务端会确保 api 规则保持在第一条。'
                    }
                    initialValue={value}
                    onSave={onSave}
                    saving={saving}
                    hint="Schema: { domainStrategy?, rules: [...], balancers: [...] }"
                />
            ) : (
                <div className="visual-routing-container">
                    <div className="form-group mb-6">
                        <label className="form-label">{locale === 'en-US' ? 'Domain Strategy' : '域名解析策略 (domainStrategy)'}</label>
                        <select
                            className="form-input"
                            value={config.domainStrategy || 'AsIs'}
                            onChange={(e) => setConfig({ ...config, domainStrategy: e.target.value })}
                        >
                            <option value="AsIs">AsIs</option>
                            <option value="IPIfNonMatch">IPIfNonMatch</option>
                            <option value="IPOnDemand">IPOnDemand</option>
                        </select>
                    </div>

                    <div className="rules-list mb-6">
                        <div className="flex items-center justify-between mb-3">
                            <label className="form-label mb-0">{locale === 'en-US' ? 'Rules' : '路由规则列表'}</label>
                            <button className="btn btn-sm btn-secondary" onClick={addRule}>
                                <HiOutlinePlus className="mr-1" /> {locale === 'en-US' ? 'Add Rule' : '添加规则'}
                            </button>
                        </div>

                        {(!config.rules || config.rules.length === 0) ? (
                            <div className="p-8 text-center text-muted border border-dashed border-[var(--border)] rounded-lg">
                                {locale === 'en-US' ? 'No rules defined' : '暂无路由规则'}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {config.rules.map((rule, index) => (
                                    <div key={index} className="p-4 bg-[var(--bg-popover)] border border-[var(--border)] rounded-lg relative">
                                        <div className="flex gap-4 mb-3">
                                            <div className="flex-1">
                                                <label className="block text-xs text-muted mb-1">{locale === 'en-US' ? 'Outbound Tag' : '目标出站 (outboundTag)'}</label>
                                                <input
                                                    type="text"
                                                    className="form-input form-input-sm"
                                                    value={rule.outboundTag || ''}
                                                    onChange={(e) => updateRule(index, 'outboundTag', e.target.value)}
                                                    placeholder="e.g. block, direct, proxy"
                                                />
                                            </div>
                                            <div className="flex-none pt-5">
                                                <div className="flex items-center gap-1">
                                                    <button className="btn btn-sm btn-icon btn-secondary" onClick={() => moveRule(index, -1)} disabled={index === 0} title={locale === 'en-US' ? 'Move Up' : '上移'}>
                                                        <HiOutlineArrowUp />
                                                    </button>
                                                    <button className="btn btn-sm btn-icon btn-secondary" onClick={() => moveRule(index, 1)} disabled={index === config.rules.length - 1} title={locale === 'en-US' ? 'Move Down' : '下移'}>
                                                        <HiOutlineArrowDown />
                                                    </button>
                                                    <button className="btn btn-sm btn-icon btn-danger ml-2" onClick={() => removeRule(index)} title={locale === 'en-US' ? 'Remove' : '删除'}>
                                                        <HiOutlineTrash />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-4">
                                            <div className="flex-1">
                                                <label className="block text-xs text-muted mb-1">{locale === 'en-US' ? 'Domains (Comma separated)' : '域名匹配 (domain) - 逗号分隔'}</label>
                                                <input
                                                    type="text"
                                                    className="form-input form-input-sm"
                                                    value={(rule.domain || []).join(', ')}
                                                    onChange={(e) => updateRule(index, 'domain', e.target.value)}
                                                    placeholder="e.g. geosite:google, domain:example.com"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <label className="block text-xs text-muted mb-1">{locale === 'en-US' ? 'IPs (Comma separated)' : 'IP匹配 (ip) - 逗号分隔'}</label>
                                                <input
                                                    type="text"
                                                    className="form-input form-input-sm"
                                                    value={(rule.ip || []).join(', ')}
                                                    onChange={(e) => updateRule(index, 'ip', e.target.value)}
                                                    placeholder="e.g. geoip:cn, 8.8.8.8"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end pt-4 border-t border-[var(--border)]">
                        <button className="btn btn-primary" onClick={handleVisualSave} disabled={saving}>
                            {saving ? (locale === 'en-US' ? 'Saving...' : '保存中...') : (locale === 'en-US' ? 'Save Changes' : '保存设置')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
