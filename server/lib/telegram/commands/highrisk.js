import { missingArgs, notFound, findUserByIdOrEmail } from '../commandHelpers.js';

const HIGH_RISK_TTL_SECONDS = 60;

function buildAuditRequest(actor, command) {
    return {
        user: {
            username: `telegram:${actor || 'unknown'}`,
            role: 'admin',
            userId: `telegram:${actor || 'unknown'}`,
        },
        method: 'POST',
        originalUrl: `/telegram/command${command}`,
        params: {},
    };
}

async function recordTelegramAudit(services, { event, actor, command, target, outcome, details = {} }) {
    try {
        const auditStore = await services.auditRepository();
        if (typeof auditStore.appendEvent !== 'function') return;
        auditStore.appendEvent({
            event,
            req: buildAuditRequest(actor, command),
            details: { command, actor, outcome, ...details },
            outcome,
            resourceType: 'telegram_command',
            resourceId: command,
            targetEmail: target?.email || target,
        });
    } catch {
        // best-effort
    }
}

export function registerHighRiskCommands(registry, ctx, options = {}) {
    const { helpers, services } = ctx;

    // Use the injected risk-token store if provided (tests), otherwise lazy
    // load the production one. Keeps unit tests hermetic.
    async function getRiskTokenStore() {
        if (options.riskTokenStore) return options.riskTokenStore;
        const mod = await import('../../batchRiskControl.js');
        return mod.default || mod;
    }

    function issueTokenFor(actor, operationKey) {
        return getRiskTokenStore().then((store) => store.issue({
            actor: { userId: `telegram:${actor || 'tg'}`, role: 'admin' },
            operationKey,
            ttlSeconds: HIGH_RISK_TTL_SECONDS,
        }));
    }

    function consumeToken({ token, actor, operationKey }) {
        return getRiskTokenStore().then((store) => store.consume({
            token,
            actor: { userId: `telegram:${actor || 'tg'}`, role: 'admin' },
            operationKey,
        }));
    }

    registry.register({
        name: '/client_delete',
        level: 'high-risk',
        summary: '删除客户（不可逆）',
        handler: async ({ args, ctx: invokeCtx }) => {
            const target = args?.positional?.[0];
            if (!target) {
                return {
                    text: missingArgs(helpers, '/client_delete <id 或 email>'),
                    kind: 'client_delete_missing_args',
                };
            }
            const userAdmin = await services.userAdmin();
            const user = findUserByIdOrEmail(userAdmin.listUsers(), target);
            if (!user) {
                return { text: notFound(helpers, '客户'), kind: 'client_delete_not_found' };
            }
            const operationKey = `telegram:client_delete:${user.id}`;
            const issuedToken = await issueTokenFor(invokeCtx?.actor, operationKey);
            const tokenSuffix = String(issuedToken?.token || '').slice(-4) || '****';

            const promptText = helpers.joinHtmlMessage('NMS Telegram 控制台', [
                `${helpers.sectionHeader('高风险确认')}\n• ⚠️ 即将<b>删除</b>客户 <b>${helpers.escapeTelegramHtml(user.email || user.username || user.id)}</b>\n• 此操作<b>不可逆</b>`,
                `${helpers.sectionHeader('风控令牌')}\n• 后 4 位：<code>${helpers.escapeTelegramHtml(tokenSuffix)}</code>\n• 仅本会话有效，${HIGH_RISK_TTL_SECONDS} 秒后过期`,
                `${helpers.sectionHeader('提示')}\n• 点击下方红色按钮以执行；超时请重新发起`,
            ], { subtitle: '高风险操作' });

            return {
                text: promptText,
                kind: 'client_delete_confirm',
                pending: {
                    summary: `删除客户 ${user.email || user.id}`,
                    execute: async ({ actor }) => {
                        const realActor = actor || invokeCtx?.actor;
                        const consumed = await consumeToken({
                            token: issuedToken?.token,
                            actor: realActor,
                            operationKey,
                        });
                        if (!consumed?.ok) {
                            await recordTelegramAudit(services, {
                                event: 'telegram_client_delete',
                                actor: realActor,
                                command: '/client_delete',
                                target: user,
                                outcome: 'denied',
                                details: { reason: consumed?.reason || 'unknown', userId: user.id },
                            });
                            throw new Error(`风控令牌校验失败（${consumed?.reason || 'unknown'}）`);
                        }
                        await userAdmin.deleteManagedUser(user.id);
                        await recordTelegramAudit(services, {
                            event: 'telegram_client_delete',
                            actor: realActor,
                            command: '/client_delete',
                            target: user,
                            outcome: 'success',
                            details: { userId: user.id, email: user.email },
                        });
                        return {
                            toast: '已删除',
                            text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                                `${helpers.sectionHeader('操作结果')}\n• 🔴 已删除客户 <b>${helpers.escapeTelegramHtml(user.email || user.username || user.id)}</b>`,
                            ], { subtitle: '高风险操作完成' }),
                            kind: 'client_delete_result',
                        };
                    },
                },
            };
        },
    });
}

export const __testing = { HIGH_RISK_TTL_SECONDS };
