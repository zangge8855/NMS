import { missingArgs, notFound, findUserByIdOrEmail, inlineCode, compactDate } from '../commandHelpers.js';

function buildAuditRequest(actor, command, extras = {}) {
    // The audit store reads `req.user` to derive actor / role. We mimic an
    // express request object just enough for it to record a usable event.
    return {
        user: {
            username: `telegram:${actor || 'unknown'}`,
            role: 'admin',
            userId: `telegram:${actor || 'unknown'}`,
        },
        method: 'POST',
        originalUrl: `/telegram/command${command}`,
        params: {},
        ...extras,
    };
}

async function recordTelegramAudit(services, { event, actor, command, target, outcome, details = {} }) {
    try {
        const auditStore = await services.auditRepository();
        const fn = typeof auditStore.appendEvent === 'function'
            ? auditStore.appendEvent.bind(auditStore)
            : null;
        if (!fn) return;
        fn({
            event,
            req: buildAuditRequest(actor, command),
            details: {
                command,
                actor,
                outcome,
                ...details,
            },
            outcome,
            resourceType: 'telegram_command',
            resourceId: command,
            targetEmail: target?.email || target,
        });
    } catch {
        // best-effort
    }
}

function summarizeClient(helpers, user) {
    return `${helpers.escapeTelegramHtml(user.email || user.username || user.id)}`;
}

export function registerOpsCommands(registry, ctx) {
    const { helpers, services } = ctx;

    function makeClientStateCommand({ name, summary, enable, friendlyVerb }) {
        registry.register({
            name,
            level: 'write',
            summary,
            handler: async ({ args, ctx: invokeCtx }) => {
                const target = args?.positional?.[0];
                if (!target) {
                    return { text: missingArgs(helpers, `${name} <id 或 email>`), kind: `${name.slice(1)}_missing_args` };
                }
                const userAdmin = await services.userAdmin();
                const user = findUserByIdOrEmail(userAdmin.listUsers(), target);
                if (!user) {
                    return { text: notFound(helpers, '客户'), kind: `${name.slice(1)}_not_found` };
                }
                const promptText = helpers.joinHtmlMessage('NMS Telegram 控制台', [
                    `${helpers.sectionHeader('确认')}\n• 即将${friendlyVerb}客户 <b>${summarizeClient(helpers, user)}</b>`,
                    `${helpers.sectionHeader('提示')}\n• 60 秒内点击下方按钮以执行`,
                ], { subtitle: summary });
                return {
                    text: promptText,
                    kind: `${name.slice(1)}_confirm`,
                    pending: {
                        summary: `${friendlyVerb} ${user.email || user.id}`,
                        execute: async ({ actor }) => {
                            await userAdmin.setManagedUserEnabled(user.id, { enabled: enable }, `telegram:${actor || invokeCtx?.actor || 'tg'}`);
                            const outcome = 'success';
                            await recordTelegramAudit(services, {
                                event: enable ? 'telegram_client_unfreeze' : 'telegram_client_freeze',
                                actor: actor || invokeCtx?.actor,
                                command: name,
                                target: user,
                                outcome,
                                details: { userId: user.id, email: user.email },
                            });
                            return {
                                toast: `已${friendlyVerb}`,
                                text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                                    `${helpers.sectionHeader('操作结果')}\n• ✅ 已${friendlyVerb} <b>${summarizeClient(helpers, user)}</b>`,
                                ], { subtitle: summary }),
                                kind: `${name.slice(1)}_result`,
                            };
                        },
                    },
                };
            },
        });
    }

    makeClientStateCommand({
        name: '/client_freeze',
        summary: '停用客户',
        enable: false,
        friendlyVerb: '停用',
    });
    makeClientStateCommand({
        name: '/client_unfreeze',
        summary: '启用客户',
        enable: true,
        friendlyVerb: '启用',
    });

    registry.register({
        name: '/client_extend',
        level: 'write',
        summary: '延长客户到期 N 天',
        handler: async ({ args, ctx: invokeCtx }) => {
            const target = args?.positional?.[0];
            const days = Number(args?.positional?.[1]);
            if (!target || !Number.isFinite(days) || days <= 0) {
                return {
                    text: missingArgs(helpers, '/client_extend <id 或 email> <天数>'),
                    kind: 'client_extend_missing_args',
                };
            }
            const userAdmin = await services.userAdmin();
            const user = findUserByIdOrEmail(userAdmin.listUsers(), target);
            if (!user) {
                return { text: notFound(helpers, '客户'), kind: 'client_extend_not_found' };
            }
            const baseTs = user.expiryTime ? new Date(user.expiryTime).getTime() : Date.now();
            const startTs = Number.isFinite(baseTs) && baseTs > Date.now() ? baseTs : Date.now();
            const newExpiry = new Date(startTs + Math.floor(days) * 24 * 60 * 60 * 1000).toISOString();
            const promptText = helpers.joinHtmlMessage('NMS Telegram 控制台', [
                `${helpers.sectionHeader('确认')}\n• 即将延长 <b>${summarizeClient(helpers, user)}</b> 到期 <b>${Math.floor(days)}</b> 天`,
                `${helpers.sectionHeader('结果预览')}\n• 当前到期：${compactDate(user.expiryTime) || '永久'}\n• 新到期：${compactDate(newExpiry)}`,
                `${helpers.sectionHeader('提示')}\n• 60 秒内点击下方按钮以执行`,
            ], { subtitle: '延长到期' });
            return {
                text: promptText,
                kind: 'client_extend_confirm',
                pending: {
                    summary: `延长 ${user.email || user.id} +${Math.floor(days)} 天`,
                    execute: async ({ actor }) => {
                        await userAdmin.updateManagedUserExpiry(user.id, { expiryTime: newExpiry }, `telegram:${actor || invokeCtx?.actor || 'tg'}`);
                        await recordTelegramAudit(services, {
                            event: 'telegram_client_extend',
                            actor: actor || invokeCtx?.actor,
                            command: '/client_extend',
                            target: user,
                            outcome: 'success',
                            details: { userId: user.id, days: Math.floor(days), newExpiry },
                        });
                        return {
                            toast: '已延长',
                            text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                                `${helpers.sectionHeader('操作结果')}\n• ✅ 已延长 <b>${summarizeClient(helpers, user)}</b>`,
                                `${helpers.sectionHeader('关键信息')}\n• 新到期：${compactDate(newExpiry)}`,
                            ], { subtitle: '延长到期' }),
                            kind: 'client_extend_result',
                        };
                    },
                },
            };
        },
    });

    registry.register({
        name: '/alert_mute',
        level: 'write',
        summary: '静音 Telegram 告警 N 分钟',
        handler: async ({ args, ctx: invokeCtx }) => {
            const minutes = Number(args?.positional?.[0]);
            if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
                return {
                    text: missingArgs(helpers, '/alert_mute <1-1440 分钟>'),
                    kind: 'alert_mute_missing_args',
                };
            }
            const untilIso = new Date(Date.now() + Math.floor(minutes) * 60_000).toISOString();
            return {
                text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                    `${helpers.sectionHeader('确认')}\n• 即将静音 Telegram 告警 <b>${Math.floor(minutes)}</b> 分钟`,
                    `${helpers.sectionHeader('结果预览')}\n• 静音至 ${compactDate(untilIso)} ${untilIso.slice(11, 16)} UTC`,
                ], { subtitle: '静音告警' }),
                kind: 'alert_mute_confirm',
                pending: {
                    summary: `静音告警 ${Math.floor(minutes)} 分钟`,
                    execute: async ({ actor }) => {
                        // We persist a marker on the systemSettings.telegram
                        // section. The notifications dispatcher will consult
                        // it before sending. Future Steps may surface
                        // this state in the web UI.
                        const settingsStore = (await import('../../../store/systemSettingsStore.js')).default;
                        const current = settingsStore.snapshot();
                        const patch = {
                            telegram: {
                                ...current.telegram,
                                alertMutedUntil: untilIso,
                            },
                        };
                        settingsStore.update(patch);
                        await recordTelegramAudit(services, {
                            event: 'telegram_alert_mute',
                            actor: actor || invokeCtx?.actor,
                            command: '/alert_mute',
                            outcome: 'success',
                            details: { minutes: Math.floor(minutes), until: untilIso },
                        });
                        return {
                            toast: '已静音',
                            text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                                `${helpers.sectionHeader('操作结果')}\n• 🔕 已静音告警 ${Math.floor(minutes)} 分钟`,
                            ], { subtitle: '静音告警' }),
                            kind: 'alert_mute_result',
                        };
                    },
                },
            };
        },
    });

    registry.register({
        name: '/alert_unmute',
        level: 'write',
        summary: '解除告警静音',
        handler: async ({ ctx: invokeCtx }) => ({
            text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                `${helpers.sectionHeader('确认')}\n• 立即解除告警静音`,
            ], { subtitle: '解除静音' }),
            kind: 'alert_unmute_confirm',
            pending: {
                summary: '解除告警静音',
                execute: async ({ actor }) => {
                    const settingsStore = (await import('../../../store/systemSettingsStore.js')).default;
                    const current = settingsStore.snapshot();
                    settingsStore.update({
                        telegram: { ...current.telegram, alertMutedUntil: '' },
                    });
                    await recordTelegramAudit(services, {
                        event: 'telegram_alert_unmute',
                        actor: actor || invokeCtx?.actor,
                        command: '/alert_unmute',
                        outcome: 'success',
                    });
                    return {
                        toast: '已解除',
                        text: helpers.joinHtmlMessage('NMS Telegram 控制台', [
                            `${helpers.sectionHeader('操作结果')}\n• 🔔 已解除告警静音`,
                        ], { subtitle: '解除静音' }),
                        kind: 'alert_unmute_result',
                    };
                },
            },
        }),
    });
}

export const __testing = { recordTelegramAudit, buildAuditRequest };
