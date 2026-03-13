import {
    formatRetryGroupLabel,
    formatTaskActionLabel,
    formatTaskActionPair,
    formatTaskTypeLabel,
} from './taskLabels.js';

describe('task label helpers', () => {
    it('formats task types and actions for the Chinese UI', () => {
        expect(formatTaskTypeLabel('clients', 'zh-CN')).toBe('用户');
        expect(formatTaskActionLabel('disable', 'zh-CN')).toBe('停用');
        expect(formatTaskActionPair('clients', 'disable', 'zh-CN')).toBe('用户 / 停用');
        expect(formatRetryGroupLabel('server_error', 'zh-CN')).toBe('重试策略: 节点 + 错误分组');
    });

    it('falls back to the raw code for unknown values', () => {
        expect(formatTaskTypeLabel('custom_type', 'zh-CN')).toBe('custom_type');
        expect(formatTaskActionLabel('custom_action', 'zh-CN')).toBe('custom_action');
    });
});
