import { normalizeClientLocale, type ClientLocale } from '../utils/locale';

export interface OpsUiCopy {
    notifications: {
        filterGroupLabel: string;
        severityAll: string;
        severityCritical: string;
        severityWarning: string;
        severityInfo: string;
        unreadOnly: string;
        resetFilters: string;
        emptyTitle: string;
        emptySubtitle: string;
        filteredEmptyTitle: string;
        filteredEmptySubtitle: string;
        jumpToServer: string;
        jumpToAudit: string;
        auditorReadOnlyHint: string;
    };
    dashboard: {
        customizeButton: string;
        customizeAriaLabel: string;
        customizePanelTitle: string;
        customizePanelSubtitle: string;
        closeCustomizeLabel: string;
        closeCustomizeAriaLabel: string;
        resetDefault: string;
        exportButton: string;
        exportAriaLabel: string;
        exportSuccess: string;
        exportError: string;
        allSectionsHiddenTitle: string;
        allSectionsHiddenSubtitle: string;
        trendsTitle: string;
        trendsSubtitle: string;
        avgCpuLabel: string;
        avgMemoryLabel: string;
        liveThroughputLabel: string;
        availabilityLabel: string;
        onlineNodesSummary: string;
        sections: {
            kpis: string;
            trafficWindows: string;
            systemTrends: string;
            nodeHealth: string;
            onlineSessions: string;
        };
        csv: {
            section: string;
            metric: string;
            value: string;
            detail: string;
            generatedAt: string;
            scope: string;
            globalScope: string;
            kpiSection: string;
            trafficWindowSection: string;
            nodeHealthSection: string;
            inboundSection: string;
            onlineUsers: string;
            nodesOnline: string;
            totalTraffic: string;
            liveThroughput: string;
            todayTraffic: string;
            weekTraffic: string;
            monthTraffic: string;
            cpuUsage: string;
            memoryUsage: string;
            runtime: string;
            inbounds: string;
            onlineStatus: string;
            offlineStatus: string;
            pending: string;
            enabled: string;
            disabled: string;
        };
    };
    downloads: {
        regionLabel: string;
        filterPlaceholder: string;
        filterAriaLabel: string;
        clearFilter: string;
        emptyTitle: string;
        emptySubtitle: string;
        filteredEmptyTitle: string;
        filteredEmptySubtitle: string;
        backToSubscriptions: string;
        matchedCount: string;
    };
}

const OPS_UI_COPY: Record<ClientLocale, OpsUiCopy> = {
    'zh-CN': {
        notifications: {
            filterGroupLabel: '按严重级别筛选通知',
            severityAll: '全部',
            severityCritical: '严重',
            severityWarning: '警告',
            severityInfo: '信息',
            unreadOnly: '仅未读',
            resetFilters: '重置筛选',
            emptyTitle: '暂无通知',
            emptySubtitle: '节点健康变化与系统安全告警会实时显示在这里。',
            filteredEmptyTitle: '没有符合筛选条件的通知',
            filteredEmptySubtitle: '当前筛选条件下没有通知记录，可重置筛选查看全部。',
            jumpToServer: '查看节点',
            jumpToAudit: '查看审计',
            auditorReadOnlyHint: '审计员只读模式：无法标记已读',
        },
        dashboard: {
            customizeButton: '视图定制',
            customizeAriaLabel: '定制仪表盘卡片',
            customizePanelTitle: '视图定制',
            customizePanelSubtitle: '按个人偏好显示或隐藏仪表盘区块，设置会自动保存。',
            closeCustomizeLabel: '完成',
            closeCustomizeAriaLabel: '完成仪表盘视图定制',
            resetDefault: '恢复默认',
            exportButton: '导出快照',
            exportAriaLabel: '导出当前仪表盘快照 CSV',
            exportSuccess: '仪表盘快照已导出为 CSV',
            exportError: '导出仪表盘快照失败',
            allSectionsHiddenTitle: '当前已隐藏所有仪表盘区块',
            allSectionsHiddenSubtitle: '可在视图定制中重新勾选需要显示的区块，或一键恢复默认。',
            trendsTitle: '系统趋势',
            trendsSubtitle: '当前集群资源水位与实时吞吐速率快照',
            avgCpuLabel: '平均 CPU',
            avgMemoryLabel: '平均内存',
            liveThroughputLabel: '实时吞吐',
            availabilityLabel: '节点可用率',
            onlineNodesSummary: '{online}/{total} 节点在线',
            sections: {
                kpis: '核心指标 KPI',
                trafficWindows: '流量周期统计',
                systemTrends: '系统资源趋势',
                nodeHealth: '节点健康状态',
                onlineSessions: '在线会话明细',
            },
            csv: {
                section: '分类',
                metric: '指标',
                value: '数值',
                detail: '详情',
                generatedAt: '导出时间',
                scope: '视图范围',
                globalScope: '全局集群',
                kpiSection: '集群核心指标',
                trafficWindowSection: '用户流量周期',
                nodeHealthSection: '节点健康与吞吐',
                inboundSection: '入站概览',
                onlineUsers: '在线用户',
                nodesOnline: '在线节点',
                totalTraffic: '总流量',
                liveThroughput: '实时吞吐',
                todayTraffic: '今日用户流量',
                weekTraffic: '本周用户流量',
                monthTraffic: '本月用户流量',
                cpuUsage: 'CPU 使用率',
                memoryUsage: '内存使用',
                runtime: '运行时间',
                inbounds: '入站规则',
                onlineStatus: '在线',
                offlineStatus: '离线',
                pending: '统计中',
                enabled: '启用',
                disabled: '禁用',
            },
        },
        downloads: {
            regionLabel: '客户端下载列表',
            filterPlaceholder: '筛选客户端或平台 (如 FlClash, iOS, sing-box)',
            filterAriaLabel: '筛选客户端或平台',
            clearFilter: '清除筛选',
            emptyTitle: '暂无可用客户端下载',
            emptySubtitle: '当前没有可展示的客户端安装包指引，请返回订阅中心继续操作。',
            filteredEmptyTitle: '未找到匹配的客户端',
            filteredEmptySubtitle: '尝试更换关键词，或清除筛选查看全部设备客户端。',
            backToSubscriptions: '前往订阅中心',
            matchedCount: '已匹配 {count} 个客户端',
        },
    },
    'en-US': {
        notifications: {
            filterGroupLabel: 'Filter notifications by severity',
            severityAll: 'All',
            severityCritical: 'Critical',
            severityWarning: 'Warning',
            severityInfo: 'Info',
            unreadOnly: 'Unread only',
            resetFilters: 'Reset filters',
            emptyTitle: 'No notifications yet',
            emptySubtitle: 'Node health updates and security alerts will appear here in real time.',
            filteredEmptyTitle: 'No notifications match the current filters',
            filteredEmptySubtitle: 'Reset filters to inspect all recent notifications.',
            jumpToServer: 'Open node',
            jumpToAudit: 'View audit',
            auditorReadOnlyHint: 'Auditor read-only mode: read status cannot be modified',
        },
        dashboard: {
            customizeButton: 'Customize',
            customizeAriaLabel: 'Customize dashboard sections',
            customizePanelTitle: 'Customize Dashboard',
            customizePanelSubtitle: 'Choose which dashboard sections are shown for your account.',
            closeCustomizeLabel: 'Done',
            closeCustomizeAriaLabel: 'Finish customizing dashboard sections',
            resetDefault: 'Reset default',
            exportButton: 'Export',
            exportAriaLabel: 'Export dashboard snapshot CSV',
            exportSuccess: 'Dashboard snapshot exported as CSV',
            exportError: 'Failed to export dashboard snapshot',
            allSectionsHiddenTitle: 'All dashboard sections are hidden',
            allSectionsHiddenSubtitle: 'Enable sections in Customize or reset to the default layout.',
            trendsTitle: 'System Trends',
            trendsSubtitle: 'Aggregated cluster resource utilization and live throughput snapshot',
            avgCpuLabel: 'Avg CPU',
            avgMemoryLabel: 'Avg Memory',
            liveThroughputLabel: 'Live Throughput',
            availabilityLabel: 'Node Availability',
            onlineNodesSummary: '{online}/{total} nodes online',
            sections: {
                kpis: 'Key Metrics (KPIs)',
                trafficWindows: 'Traffic Windows',
                systemTrends: 'System Trends',
                nodeHealth: 'Node Health',
                onlineSessions: 'Online Sessions',
            },
            csv: {
                section: 'Section',
                metric: 'Metric',
                value: 'Value',
                detail: 'Detail',
                generatedAt: 'Generated At',
                scope: 'Scope',
                globalScope: 'Global Cluster',
                kpiSection: 'Cluster KPIs',
                trafficWindowSection: 'Traffic Windows',
                nodeHealthSection: 'Node Health & Throughput',
                inboundSection: 'Inbound Summary',
                onlineUsers: 'Online Users',
                nodesOnline: 'Nodes Online',
                totalTraffic: 'Total Traffic',
                liveThroughput: 'Live Throughput',
                todayTraffic: 'Today Traffic',
                weekTraffic: 'Weekly Traffic',
                monthTraffic: 'Monthly Traffic',
                cpuUsage: 'CPU Usage',
                memoryUsage: 'Memory Usage',
                runtime: 'Runtime',
                inbounds: 'Inbounds',
                onlineStatus: 'Online',
                offlineStatus: 'Offline',
                pending: 'Pending',
                enabled: 'Enabled',
                disabled: 'Disabled',
            },
        },
        downloads: {
            regionLabel: 'Client downloads directory',
            filterPlaceholder: 'Filter clients or platforms (e.g. FlClash, iOS, sing-box)',
            filterAriaLabel: 'Filter clients or platforms',
            clearFilter: 'Clear filter',
            emptyTitle: 'No client downloads available',
            emptySubtitle: 'There are currently no client download entries to display.',
            filteredEmptyTitle: 'No matching clients found',
            filteredEmptySubtitle: 'Try another keyword or clear the filter to view all clients.',
            backToSubscriptions: 'Go to Subscriptions',
            matchedCount: '{count} clients matched',
        },
    },
};

export function getOpsUiCopy(locale?: string | null): OpsUiCopy {
    const normalized = normalizeClientLocale(locale) || 'zh-CN';
    return OPS_UI_COPY[normalized];
}
