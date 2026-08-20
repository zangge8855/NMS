const fs = require('fs');
const file = '/root/NMS/client/src/components/Subscriptions/Subscriptions.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Add state for routingPolicy
const hookInsertionPoint = `const [profileKey, setProfileKey] = useState('');`;
code = code.replace(hookInsertionPoint, `${hookInsertionPoint}\n    const [routingPolicy, setRoutingPolicy] = useState('rules');`);

// 2. We need a function to append policy to URL
// let's define it outside component
const appendPolicyFn = `
function appendRoutingPolicy(url, policy) {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('policy=')) return url.replace(/policy=[^&]*/, 'policy=' + policy);
    return url.includes('?') ? url + '&policy=' + policy : url + '?policy=' + policy;
}
`;
code = code.replace(`function compactSubscriptionUrl(url) {`, `${appendPolicyFn}\nfunction compactSubscriptionUrl(url) {`);

// 3. Before rendering, we should patch the bundle or activeProfile url
// Let's modify where activeProfile is derived.
const activeProfileDerivation = `const activeProfile = availableProfiles.find((item) => item.key === profileKey) || availableProfiles[0] || null;`;
code = code.replace(activeProfileDerivation, `const activeProfileRaw = availableProfiles.find((item) => item.key === profileKey) || availableProfiles[0] || null;
    const activeProfile = activeProfileRaw ? { ...activeProfileRaw, url: appendRoutingPolicy(activeProfileRaw.url, routingPolicy) } : null;`);

// 4. And we also need to pass the patched bundle to SubscriptionClientLinks if it is used there.
const patchedBundleCreation = `const patchedBundle = useMemo(() => {
        if (!result?.bundle) return null;
        return {
            ...result.bundle,
            availableProfiles: (result.bundle.availableProfiles || []).map(p => ({ ...p, url: appendRoutingPolicy(p.url, routingPolicy) }))
        };
    }, [result?.bundle, routingPolicy]);`;
code = code.replace(`const [profileKey, setProfileKey] = useState('');`, `const [profileKey, setProfileKey] = useState('');\n    ${patchedBundleCreation}`);

// 5. Replace result.bundle with patchedBundle in <SubscriptionClientLinks bundle={result.bundle}
code = code.replace(/bundle=\{result\.bundle\}/g, `bundle={patchedBundle}`);
// and in result?.bundle?.externalConverterConfigured => patchedBundle?.externalConverterConfigured
code = code.replace(/result\.bundle\?/g, `patchedBundle?`);

// 6. UI for selecting policy. We can put it next to profile-switches.
const profileSwitches = `<div className="subscription-profile-switches">
                                                {availableProfiles.map((item) => (
                                                    <button
                                                        key={item.key}
                                                        type="button"
                                                        className={\`btn btn-sm \${profileKey === item.key ? 'btn-primary' : 'btn-secondary'}\`}
                                                        onClick={() => setProfileKey(item.key)}
                                                    >
                                                        {item.label}
                                                    </button>
                                                ))}
                                            </div>`;
const routingPolicySelect = `
                                            <div className="subscription-routing-policy" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                                                <span className="text-sm" style={{ marginRight: '0.5rem' }}>路由策略 / Policy:</span>
                                                <select className="form-select form-select-sm" style={{ width: 'auto', display: 'inline-block' }} value={routingPolicy} onChange={e => setRoutingPolicy(e.target.value)}>
                                                    <option value="rules">🚀 规则策略 (Rules)</option>
                                                    <option value="global">🎯 全局代理 (Global)</option>
                                                    <option value="auto">⚡ 自动优选 (Auto)</option>
                                                </select>
                                            </div>
`;
code = code.replace(profileSwitches, `${profileSwitches}\n${routingPolicySelect}`);

// 7. For the public view (user mode), there's a different render block:
const userProfileSwitches = `<div className="subscription-wizard-steps">
                                        <div className="subscription-wizard-step">
                                            <div className="subscription-wizard-step-kicker">{ui.userStepKicker} 1</div>
                                            <div className="subscription-wizard-step-title">{ui.userStepTitle}</div>
                                            <div className="subscription-wizard-step-text">{ui.userStepText}</div>
                                            <div className="subscription-profile-switches">
                                                {availableProfiles.map((item) => (
                                                    <button
                                                        key={item.key}
                                                        type="button"
                                                        className={\`btn \${profileKey === item.key ? 'btn-primary' : 'btn-secondary'}\`}
                                                        onClick={() => setProfileKey(item.key)}
                                                    >
                                                        {item.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>`;
code = code.replace(userProfileSwitches, `${userProfileSwitches}\n<div className="subscription-wizard-step" style={{marginTop: '1rem'}}>
                                            <div className="subscription-wizard-step-title">路由策略 / Routing Policy</div>
                                            <div className="subscription-routing-policy">
                                                <select className="form-select" value={routingPolicy} onChange={e => setRoutingPolicy(e.target.value)}>
                                                    <option value="rules">🚀 规则策略 / Rule-based (Ads, AI, Streaming, etc.)</option>
                                                    <option value="global">🎯 全局代理 / Global Proxy</option>
                                                    <option value="auto">⚡ 自动优选 / Auto Test</option>
                                                </select>
                                            </div>
                                        </div>`);

fs.writeFileSync(file, code);
console.log("Patched Subscriptions UI");
