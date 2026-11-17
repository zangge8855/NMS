import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../../contexts/LanguageContext';
import ClientGroupsPanel from './ClientGroupsPanel';
import OutboundSubsPanel from './OutboundSubsPanel';
import PanelNodesPanel from './PanelNodesPanel';
import SubBalancersPanel from './SubBalancersPanel';
import SubscriptionHostsPanel from './SubscriptionHostsPanel';
import { usePanelPermissions, type PanelInboundOption } from './panelRequest';

type SectionKey = 'groups' | 'hosts' | 'balancers' | 'outboundSubs' | 'nodes';

type SectionDef = {
    key: SectionKey;
    /** Who may open the section: auditors cannot see outbound subscription URLs, only admins see nodes. */
    audience: 'staff' | 'managers' | 'admin';
};

const SECTIONS: SectionDef[] = [
    { key: 'groups', audience: 'staff' },
    { key: 'hosts', audience: 'staff' },
    { key: 'balancers', audience: 'staff' },
    { key: 'outboundSubs', audience: 'managers' },
    { key: 'nodes', audience: 'admin' },
];

type PanelFeaturesProps = {
    serverId: string;
    inbounds: Array<Record<string, any>>;
};

/**
 * The 3x-ui v3 features that have no NMS-wide equivalent: client groups, subscription
 * hosts and balancers, outbound subscriptions and the panel's own node registry.
 * One section shows at a time so only its list is fetched.
 */
export default function PanelFeatures({ serverId, inbounds }: PanelFeaturesProps) {
    const { t } = useI18n();
    const { isAdmin, canManage } = usePanelPermissions();
    const [searchParams, setSearchParams] = useSearchParams();

    const sections = useMemo(() => SECTIONS.filter((section) => (
        section.audience === 'staff'
        || (section.audience === 'managers' && canManage)
        || (section.audience === 'admin' && isAdmin)
    )), [canManage, isAdmin]);

    const requested = String(searchParams.get('section') || '');
    const active = sections.find((section) => section.key === requested)?.key || sections[0].key;

    const inboundOptions = useMemo<PanelInboundOption[]>(() => inbounds
        .filter((item) => Number.isFinite(Number(item?.id)))
        .map((item) => ({
            id: Number(item.id),
            remark: String(item.remark || ''),
            protocol: String(item.protocol || ''),
            port: item.port,
            tag: String(item.tag || ''),
        })), [inbounds]);

    const select = (key: SectionKey) => {
        const next = new URLSearchParams(searchParams);
        next.set('section', key);
        setSearchParams(next, { replace: true });
    };

    return (
        <div className="pf-workspace">
            <nav className="pf-nav" aria-label={t('pages.panelFeatures.navLabel')}>
                <ul className="pf-nav-list">
                    {sections.map((section) => (
                        <li key={section.key}>
                            <button
                                type="button"
                                className={`pf-nav-item${active === section.key ? ' is-active' : ''}`}
                                aria-current={active === section.key ? 'page' : undefined}
                                onClick={() => select(section.key)}
                            >
                                {t(`pages.panelFeatures.tabs.${section.key}`)}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
            <div className="pf-stage">
                {active === 'groups' && <ClientGroupsPanel serverId={serverId} canManage={canManage} />}
                {active === 'hosts' && <SubscriptionHostsPanel serverId={serverId} canManage={canManage} inbounds={inboundOptions} />}
                {active === 'balancers' && <SubBalancersPanel serverId={serverId} canManage={canManage} inbounds={inboundOptions} />}
                {active === 'outboundSubs' && <OutboundSubsPanel serverId={serverId} canManage={canManage} />}
                {active === 'nodes' && <PanelNodesPanel serverId={serverId} />}
            </div>
        </div>
    );
}
