const TYPE_LABELS = {
    'zh-CN': {
        clients: '用户',
        inbounds: '入站',
        user_sync: '用户同步',
    },
    'en-US': {
        clients: 'Clients',
        inbounds: 'Inbounds',
        user_sync: 'User Sync',
    },
};

const ACTION_LABELS = {
    'zh-CN': {
        add: '新增',
        update: '更新',
        enable: '启用',
        disable: '停用',
        delete: '删除',
        resetTraffic: '重置流量',
        syncExistingUsers: '补齐现有用户',
        managed_sync: '节点同步',
        set_enabled: '同步启停状态',
        update_expiry: '同步到期时间',
        provision_subscription: '开通订阅',
        client_toggle: '启停同步',
        client_deploy: '策略下发',
    },
    'en-US': {
        add: 'Add',
        update: 'Update',
        enable: 'Enable',
        disable: 'Disable',
        delete: 'Delete',
        resetTraffic: 'Reset Traffic',
        syncExistingUsers: 'Backfill Existing Users',
        managed_sync: 'Node Sync',
        set_enabled: 'Sync Status',
        update_expiry: 'Sync Expiry',
        provision_subscription: 'Provision Subscription',
        client_toggle: 'Toggle Sync',
        client_deploy: 'Policy Deploy',
    },
};

const RETRY_GROUP_LABELS = {
    'zh-CN': {
        none: '重试策略: 全部失败项',
        server: '重试策略: 按节点分组',
        error: '重试策略: 按错误分组',
        server_error: '重试策略: 节点 + 错误分组',
    },
    'en-US': {
        none: 'Retry: all failed items',
        server: 'Retry: group by server',
        error: 'Retry: group by error',
        server_error: 'Retry: group by server + error',
    },
};

function resolveLocale(locale) {
    return locale === 'en-US' ? 'en-US' : 'zh-CN';
}

export function formatTaskTypeLabel(type, locale = 'zh-CN') {
    const normalizedLocale = resolveLocale(locale);
    const key = String(type || '').trim();
    return TYPE_LABELS[normalizedLocale][key] || key || '-';
}

export function formatTaskActionLabel(action, locale = 'zh-CN') {
    const normalizedLocale = resolveLocale(locale);
    const key = String(action || '').trim();
    return ACTION_LABELS[normalizedLocale][key] || key || '-';
}

export function formatTaskActionPair(type, action, locale = 'zh-CN') {
    return `${formatTaskTypeLabel(type, locale)} / ${formatTaskActionLabel(action, locale)}`;
}

export function formatRetryGroupLabel(mode, locale = 'zh-CN') {
    const normalizedLocale = resolveLocale(locale);
    const key = String(mode || '').trim();
    return RETRY_GROUP_LABELS[normalizedLocale][key] || key || '-';
}
