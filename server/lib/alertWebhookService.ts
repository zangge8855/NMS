import fetch from 'node-fetch';

export async function sendWebhookAlert(config: any, payload: any) {
    const { channel, url, barkKey } = config;
    const { title, message, event, timestamp } = payload;
    try {
        let finalUrl = url;
        if (channel === 'bark') {
            finalUrl = url || barkKey;
            if (!finalUrl.startsWith('http')) {
                finalUrl = `https://api.day.app/${finalUrl}`;
            }
            finalUrl = `${finalUrl.replace(/\/+$/, '')}/${encodeURIComponent(title)}/${encodeURIComponent(message)}`;
            await fetch(finalUrl);
        } else if (channel === 'discord') {
            await fetch(finalUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    embeds: [{
                        title,
                        description: message,
                        color: 0x3b82f6
                    }]
                })
            });
        } else if (channel === 'feishu' || channel === 'lark') {
            await fetch(finalUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msg_type: "text",
                    content: { text: `${title}\n${message}` }
                })
            });
        } else if (channel === 'wechat' || channel === 'wechatwork') {
            await fetch(finalUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgtype: "text",
                    text: { content: `${title}\n${message}` }
                })
            });
        } else {
            // custom
            await fetch(finalUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event,
                    title,
                    message,
                    timestamp: timestamp || new Date().toISOString()
                })
            });
        }
        return { success: true, msg: 'Webhook sent successfully' };
    } catch (err: any) {
        throw new Error(`Webhook Error [${channel}]: ${err.message}`);
    }
}
