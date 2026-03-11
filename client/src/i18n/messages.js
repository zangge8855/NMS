export const DEFAULT_LOCALE = 'zh-CN';
export const VALID_LOCALES = ['zh-CN', 'en-US'];

const messages = {
  'zh-CN': {
    shell: {
      brandSubtitle: '节点管理系统',
      searchPlaceholder: '搜索页面...',
      searchAriaLabel: '全局页面搜索',
      searchEmpty: '没有匹配页面',
      scopeServerTitle: '单节点',
      scopeGlobalTitle: '控制域',
      scopeGlobalValue: '集群总览',
      scopeGlobalSubtitle: '全局视角',
      selectServer: '选择服务器',
      searchServersPlaceholder: '搜索服务器...',
      logout: '退出登录',
      roleAdmin: '管理员',
      roleUser: '用户',
      themeDark: '深色模式',
      themeLight: '浅色模式',
      themeAuto: '跟随系统',
      expandSidebar: '展开侧边栏',
      collapseSidebar: '收起侧边栏',
      langLabel: 'EN',
      switchLanguage: '切换到英文',
    },
    nav: {
      monitor: '监控',
      management: '管理',
      operations: '运维',
      system: '系统',
      account: '账户',
      dashboard: '仪表盘',
      inbounds: '入站管理',
      users: '用户管理',
      subscriptions: '订阅中心',
      serverConsole: '节点控制台',
      capabilities: '3x-ui 能力',
      tools: '节点工具',
      audit: '审计中心',
      tasks: '任务中心',
      settings: '系统设置',
      servers: '服务器管理',
    },
    pages: {
      dashboardEmpty: {
        title: '仪表盘',
        subtitle: '请先接入至少一台 3x-ui 节点后查看运行总览',
      },
      dashboardGlobal: {
        title: '集群仪表盘',
        subtitle: '跨节点观察在线态、容量与异常分布',
        eyebrow: '运行总览',
      },
      dashboardNode: {
        title: '仪表盘',
        subtitle: '当前节点运行总览',
        subtitleWithName: '当前聚焦节点 {name} 的资源、入站与在线用户',
        eyebrow: '节点总览',
      },
      usersHub: {
        title: '用户管理',
        subtitle: '统一维护账号、订阅状态、客户端与访问策略',
        eyebrow: '身份与访问',
      },
      userDetail: {
        title: '用户详情',
        titleWithName: '用户详情 · {name}',
        subtitle: '查看账号状态、客户端分布、订阅令牌与活动日志',
        eyebrow: '身份详情',
      },
      servers: {
        title: '服务器管理',
        subtitle: '管理 3x-ui 节点接入、健康检查与凭据状态',
        eyebrow: '节点注册表',
      },
      serverDetail: {
        title: '服务器详情',
        titleWithName: '服务器 · {name}',
        subtitle: '资源状态、入站配置、在线会话与节点审计',
        eyebrow: '节点详情',
      },
      subscriptions: {
        title: '订阅中心',
      },
      audit: {
        title: '审计中心',
        subtitle: '统一查看操作链路、流量走势与订阅访问记录',
        eyebrow: '审计与安全',
      },
      settings: {
        title: '系统设置',
        subtitle: '全局参数、运行诊断、存储与备份状态',
        limitedSubtitle: '仅管理员可查看和调整全局运行参数',
        eyebrow: '平台设置',
      },
      serverConsole: {
        title: '节点控制台',
        globalTitle: '节点控制台（集群）',
        subtitle: '当前节点的 Xray、数据、工具与面板能力',
        globalSubtitle: '对多节点执行统一维护动作，单节点专属能力自动禁用',
        emptySubtitle: '统一执行节点运维、工具生成与数据操作',
        eyebrow: '节点运维',
      },
      inbounds: {
        title: '入站管理',
        subtitle: '跨节点维护协议、端口、客户端和限额策略',
        eyebrow: '流量与入站',
      },
      tasks: {
        title: '任务中心',
      },
      logs: {
        clusterPrefix: '集群',
      },
      capabilities: {
        title: '3x-ui 能力',
      },
      tools: {
        title: '节点工具',
      },
      login: {
        title: '登录',
        registerTitle: '注册',
        verifyTitle: '邮箱验证',
        forgotTitle: '找回密码',
        subtitle: '统一访问节点管理后台',
        username: '用户名',
        email: '邮箱',
        password: '密码',
        confirmPassword: '确认密码',
        verifyCode: '验证码',
        newPassword: '新密码',
        usernamePlaceholder: '请输入用户名',
        passwordPlaceholder: '请输入密码',
        registerUsernamePlaceholder: '选择一个用户名',
        registerEmailPlaceholder: '你的邮箱地址',
        registerPasswordPlaceholder: '至少8位，含3类字符',
        confirmPasswordPlaceholder: '再次输入密码',
        verifyCodePlaceholder: '输入 6 位验证码',
        verifySentTo: '验证码已发送至 {email}',
        forgotSubtitle: '输入邮箱验证码并设置新密码',
        resetEmailPlaceholder: '注册邮箱',
        resetCodePlaceholder: '输入 6 位验证码',
        resetPasswordPlaceholder: '至少8位，含3类字符',
        resetConfirmPlaceholder: '再次输入新密码',
        loginButton: '登录',
        registerButton: '注册',
        verifyButton: '验证',
        sendCode: '发送验证码',
        resendCode: '重新发送验证码',
        resetButton: '重置密码',
        toRegister: '注册',
        toLogin: '返回登录',
        toForgot: '忘记密码',
      },
    },
  },
  'en-US': {
    shell: {
      brandSubtitle: 'Node Management System',
      searchPlaceholder: 'Search pages...',
      searchAriaLabel: 'Global page search',
      searchEmpty: 'No matching page',
      scopeServerTitle: 'Node',
      scopeGlobalTitle: 'Scope',
      scopeGlobalValue: 'Cluster Overview',
      scopeGlobalSubtitle: 'Global view',
      selectServer: 'Select server',
      searchServersPlaceholder: 'Search servers...',
      logout: 'Sign out',
      roleAdmin: 'Admin',
      roleUser: 'User',
      themeDark: 'Dark mode',
      themeLight: 'Light mode',
      themeAuto: 'System theme',
      expandSidebar: 'Expand sidebar',
      collapseSidebar: 'Collapse sidebar',
      langLabel: '中',
      switchLanguage: 'Switch to Chinese',
    },
    nav: {
      monitor: 'Monitor',
      management: 'Manage',
      operations: 'Operate',
      system: 'System',
      account: 'Account',
      dashboard: 'Dashboard',
      inbounds: 'Inbounds',
      users: 'Users',
      subscriptions: 'Subscriptions',
      serverConsole: 'Node Console',
      capabilities: '3x-ui Capabilities',
      tools: 'Node Tools',
      audit: 'Audit',
      tasks: 'Tasks',
      settings: 'Settings',
      servers: 'Servers',
    },
    pages: {
      dashboardEmpty: {
        title: 'Dashboard',
        subtitle: 'Connect at least one 3x-ui node before viewing runtime status',
      },
      dashboardGlobal: {
        title: 'Cluster Dashboard',
        subtitle: 'Observe sessions, capacity, and anomalies across nodes',
        eyebrow: 'Operations Overview',
      },
      dashboardNode: {
        title: 'Dashboard',
        subtitle: 'Current node runtime overview',
        subtitleWithName: 'Resource, inbound, and online-user view for {name}',
        eyebrow: 'Node Overview',
      },
      usersHub: {
        title: 'User Management',
        subtitle: 'Manage accounts, subscriptions, clients, and access policies',
        eyebrow: 'Identity & Access',
      },
      userDetail: {
        title: 'User Detail',
        titleWithName: 'User · {name}',
        subtitle: 'Account status, clients, subscription tokens, and activity',
        eyebrow: 'Identity Detail',
      },
      servers: {
        title: 'Server Management',
        subtitle: 'Manage 3x-ui nodes, health checks, and credential status',
        eyebrow: 'Server Registry',
      },
      serverDetail: {
        title: 'Server Detail',
        titleWithName: 'Server · {name}',
        subtitle: 'Resources, inbounds, sessions, and node audit',
        eyebrow: 'Server Detail',
      },
      subscriptions: {
        title: 'Subscriptions',
      },
      audit: {
        title: 'Audit Center',
        subtitle: 'Review operations, traffic trends, and subscription access',
        eyebrow: 'Audit & Security',
      },
      settings: {
        title: 'System Settings',
        subtitle: 'Global parameters, diagnostics, storage, and backups',
        limitedSubtitle: 'Only administrators can view and change global settings',
        eyebrow: 'Platform Settings',
      },
      serverConsole: {
        title: 'Node Console',
        globalTitle: 'Node Console (Cluster)',
        subtitle: 'Xray, data, tools, and panel actions for the current node',
        globalSubtitle: 'Run unified actions across nodes while node-only tools stay disabled',
        emptySubtitle: 'Node operations, tool generation, and data actions',
        eyebrow: 'Node Operations',
      },
      inbounds: {
        title: 'Inbound Management',
        subtitle: 'Manage protocols, ports, clients, and quotas across nodes',
        eyebrow: 'Traffic & Inbounds',
      },
      tasks: {
        title: 'Task Center',
      },
      logs: {
        clusterPrefix: 'Cluster ',
      },
      capabilities: {
        title: '3x-ui Capabilities',
      },
      tools: {
        title: 'Node Tools',
      },
      login: {
        title: 'Sign In',
        registerTitle: 'Register',
        verifyTitle: 'Verify Email',
        forgotTitle: 'Reset Password',
        subtitle: 'Access the node management workspace',
        username: 'Username',
        email: 'Email',
        password: 'Password',
        confirmPassword: 'Confirm password',
        verifyCode: 'Verification code',
        newPassword: 'New password',
        usernamePlaceholder: 'Enter username',
        passwordPlaceholder: 'Enter password',
        registerUsernamePlaceholder: 'Choose a username',
        registerEmailPlaceholder: 'Your email address',
        registerPasswordPlaceholder: 'At least 8 chars, 3 character groups',
        confirmPasswordPlaceholder: 'Enter the password again',
        verifyCodePlaceholder: 'Enter the 6-digit code',
        verifySentTo: 'The code was sent to {email}',
        forgotSubtitle: 'Enter the email code and set a new password',
        resetEmailPlaceholder: 'Registered email',
        resetCodePlaceholder: 'Enter the 6-digit code',
        resetPasswordPlaceholder: 'At least 8 chars, 3 character groups',
        resetConfirmPlaceholder: 'Enter the new password again',
        loginButton: 'Sign In',
        registerButton: 'Register',
        verifyButton: 'Verify',
        sendCode: 'Send code',
        resendCode: 'Resend code',
        resetButton: 'Reset password',
        toRegister: 'Register',
        toLogin: 'Back to sign in',
        toForgot: 'Forgot password',
      },
    },
  },
};

function walkMessageTree(tree, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), tree);
}

export function interpolateMessage(value, params = {}) {
  const template = String(value || '');
  return Object.entries(params).reduce(
    (output, [key, replacement]) => output.replaceAll(`{${key}}`, String(replacement ?? '')),
    template
  );
}

export function getLocaleMessage(locale, path, params = {}) {
  const language = VALID_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  const localized = walkMessageTree(messages[language], path);
  const fallback = walkMessageTree(messages[DEFAULT_LOCALE], path);
  const picked = localized ?? fallback ?? '';
  return interpolateMessage(picked, params);
}

export default messages;
