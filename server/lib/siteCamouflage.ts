import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
    CAMOUFLAGE_CONTENT,
    type ArtSpec,
    type Bilingual,
    type CamouflageArticle,
    type CamouflageSiteContent,
} from './camouflageContent.js';

/**
 * Public "camouflage" website rendered for every request outside the real
 * access path. It behaves like a small, static editorial site: home page,
 * article pages, archive, about, section listings, RSS feed, sitemap, favicon
 * and a themed 404 for everything else.
 */

const DEFAULT_TEMPLATE = 'corporate';
const DEFAULT_TITLE = 'City Field Notes';
const CLASS_SUFFIX = crypto.randomBytes(5).toString('hex');
const LANGUAGE_STORAGE_KEY = 'city_lang_pref';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FORBIDDEN_TECH_TITLE_PATTERN = /(?:edge\s+precision\s+systems|edge\s+precision|precision\s+systems|\bnms\b|\bv2ray\b|\bxray\b|\btrojan\b|\bshadowsocks\b|\bvmess\b|\bvless\b|\bclash\b|\bsing-box\b|\bgost\b|\bproxy\b|\bvpn\b|\bagent\b|\btunnel\b|\bgateway\b|\bdns\b|\bnode\b|\bserver\b|\bops\b|\bsupport\b|\bnetwork\b|\bpanel\b|\bsystem\b|\badmin\b|\bconsole\b|\bdashboard\b|\bsub\b|\bsubscription\b|\bsubscribe\b|订阅|节点|面板|代理|审计|后台|运维)/i;

export const CAMOUFLAGE_TEMPLATE_IDS = Object.freeze(['corporate', 'nginx', 'blog'] as const);
export const CAMOUFLAGE_RESPONSE_CACHE_CONTROL = 'public, max-age=86400';
const CAMOUFLAGE_PAGE_CACHE_CONTROL = 'public, max-age=600';
const CAMOUFLAGE_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// ── small utilities ─────────────────────────────────────────

function cx(names: string): string {
    return names.split(/\s+/).filter(Boolean).map((name) => `${name}-${CLASS_SUFFIX}`).join(' ');
}

function scopeCss(css: string): string {
    return css.replace(/\.@([a-zA-Z][\w-]*)/g, (_match, name) => `.${name}-${CLASS_SUFFIX}`);
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function hashString(value: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

interface BiOptions {
    tag?: string;
    className?: string;
}

function bi(text: Bilingual, { tag = 'span', className = '' }: BiOptions = {}): string {
    const classAttr = className ? ` class="${cx(className)}"` : '';
    return `<${tag} data-lang="zh-CN"${classAttr}>${escapeHtml(text.zh)}</${tag}>`
        + `<${tag} data-lang="en-US"${classAttr} hidden>${escapeHtml(text.en)}</${tag}>`;
}

const t = (zh: string, en: string): Bilingual => ({ zh, en });

function formatDate(date: Date): Bilingual {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    return t(`${year}年${month + 1}月${day}日`, `${MONTHS_EN[month]} ${day}, ${year}`);
}

function formatShortDate(date: Date): Bilingual {
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    return t(`${month + 1}月${day}日`, `${MONTHS_EN[month].slice(0, 3)} ${day}`);
}

function formatMonth(date: Date): Bilingual {
    return t(`${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`, `${MONTHS_EN[date.getUTCMonth()]} ${date.getUTCFullYear()}`);
}

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function slugify(value: string): string {
    return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── site model ──────────────────────────────────────────────

function normalizeTemplate(value: unknown, fallback: string = DEFAULT_TEMPLATE): string {
    const candidate = String(value || '').trim().toLowerCase();
    return (CAMOUFLAGE_TEMPLATE_IDS as readonly string[]).includes(candidate) ? candidate : fallback;
}

function normalizeTitle(value: unknown, fallback: string = DEFAULT_TITLE): string {
    const collapsed = String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!collapsed) return fallback;
    if (FORBIDDEN_TECH_TITLE_PATTERN.test(collapsed)) return DEFAULT_TITLE;
    return collapsed.slice(0, 96);
}

interface DatedArticle extends CamouflageArticle {
    date: Date;
    url: string;
    image: string;
    sectionSlug: string;
}

interface SiteModel {
    templateName: string;
    title: string;
    content: CamouflageSiteContent;
    articles: DatedArticle[];
    latest: Date;
    now: Date;
    origin: string;
    contactEmail: string;
    issueNumber: number;
    firstYear: number;
    seed: number;
}

function startOfUtcWeek(date: Date): number {
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
    return midnight - weekday * DAY_MS;
}

function buildSiteModel(siteConfig: any, options: { origin?: string; contactEmail?: string; now?: Date } = {}): SiteModel {
    const templateName = normalizeTemplate(siteConfig?.camouflageTemplate);
    const title = normalizeTitle(siteConfig?.camouflageTitle);
    const content = CAMOUFLAGE_CONTENT[templateName];
    const now = options.now instanceof Date ? options.now : new Date();
    const seed = hashString(`${templateName}:${title}`);

    // Publish on a stable weekday/hour for this site so dates only move once a week.
    const publishWeekday = 1 + (seed % 3);
    const publishHour = 7 + (seed % 4);
    let latestMs = startOfUtcWeek(now) + publishWeekday * DAY_MS + publishHour * HOUR_MS + ((seed >>> 8) % 50) * 60_000;
    if (latestMs > now.getTime()) latestMs -= 7 * DAY_MS;

    let cursor = latestMs;
    const articles = content.articles.map((article, index) => {
        cursor -= (content.cadence[index] ?? 7) * DAY_MS;
        return {
            ...article,
            date: new Date(cursor),
            url: `${content.articleBase}/${article.slug}`,
            image: `/media/${article.slug}.svg`,
            sectionSlug: slugify(article.section.en),
        };
    });
    const latest = articles[0]?.date || new Date(latestMs);
    const issueEpoch = Date.UTC(2018, 2, 5);

    return {
        templateName,
        title,
        content,
        articles,
        latest,
        now,
        origin: options.origin || '',
        contactEmail: options.contactEmail || '',
        issueNumber: Math.max(1, Math.floor((latest.getTime() - issueEpoch) / (7 * DAY_MS)) - (seed % 90)),
        firstYear: latest.getUTCFullYear() - (3 + (seed % 5)),
        seed,
    };
}

// ── artwork ─────────────────────────────────────────────────

const ART_CACHE = new Map<string, string>();

function createArtworkSvg(art: ArtSpec, seedKey: string): string {
    const cacheKey = `${seedKey}:${art.variant}:${art.palette.join(',')}`;
    const cached = ART_CACHE.get(cacheKey);
    if (cached) return cached;

    const rand = createRandom(hashString(seedKey));
    const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
    const [a, b, c, d] = art.palette;
    const W = 1600;
    const H = 1000;
    const shapes: string[] = [];
    let background = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d}"/><stop offset="0.55" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

    switch (art.variant) {
        case 'dusk': {
            const sunX = between(880, 1280);
            const sunY = between(250, 380);
            shapes.push(`<circle cx="${sunX}" cy="${sunY}" r="420" fill="${d}" opacity="0.45" filter="url(#haze)"/>`);
            shapes.push(`<circle cx="${sunX}" cy="${sunY}" r="120" fill="${d}" opacity="0.92" filter="url(#soft)"/>`);
            const layers: Array<[number, string, number, string]> = [[600, b, 0.5, 'url(#soft)'], [700, c, 0.68, 'url(#mid)'], [820, c, 0.95, '']];
            for (const [base, color, opacity, filter] of layers) {
                const p1 = base - between(20, 90);
                const p2 = base + between(-40, 50);
                const p3 = base - between(10, 70);
                shapes.push(`<path d="M0 ${base} C ${W * 0.2} ${p1}, ${W * 0.38} ${p2}, ${W * 0.55} ${base - 20} S ${W * 0.85} ${p3}, ${W} ${base + 10} V ${H} H 0 Z" fill="${color}" opacity="${opacity}"${filter ? ` filter="${filter}"` : ''}/>`);
            }
            break;
        }
        case 'window': {
            background = `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
            const wx = between(240, 560);
            const wy = between(110, 170);
            const ww = between(500, 600);
            const wh = between(520, 600);
            shapes.push(`<circle cx="${wx + ww / 2}" cy="${wy + wh / 2}" r="520" fill="${d}" opacity="0.28" filter="url(#haze)"/>`);
            shapes.push(`<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="${d}" opacity="0.94" filter="url(#mid)"/>`);
            shapes.push(`<rect x="${wx + ww / 2 - 9}" y="${wy}" width="18" height="${wh}" fill="${c}" opacity="0.85" filter="url(#fine)"/>`);
            shapes.push(`<rect x="${wx}" y="${wy + wh * 0.42}" width="${ww}" height="16" fill="${c}" opacity="0.85" filter="url(#fine)"/>`);
            shapes.push(`<path d="M${wx} ${wy + wh + 40} L${wx + ww} ${wy + wh + 40} L${W} ${H} L${wx + 120} ${H} Z" fill="${d}" opacity="0.32" filter="url(#soft)"/>`);
            shapes.push(`<rect x="0" y="${wy + wh + 24}" width="${W}" height="22" fill="${c}" opacity="0.6" filter="url(#fine)"/>`);
            shapes.push(`<ellipse cx="${wx + ww + 150}" cy="${wy + wh - 20}" rx="120" ry="160" fill="${a}" opacity="0.5" filter="url(#soft)"/>`);
            break;
        }
        case 'street': {
            background = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d}"/><stop offset="0.45" stop-color="${a}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
            let x = -40;
            while (x < W) {
                const width = between(150, 290);
                const top = between(150, 420);
                const color = rand() > 0.5 ? b : c;
                shapes.push(`<rect x="${x}" y="${top}" width="${width}" height="${680 - top}" fill="${color}" opacity="${(0.55 + rand() * 0.35).toFixed(2)}" filter="url(#mid)"/>`);
                shapes.push(`<rect x="${x}" y="690" width="${width}" height="${between(160, 280)}" fill="${color}" opacity="0.22" filter="url(#soft)"/>`);
                x += width + between(-20, 30);
            }
            for (let i = 0; i < 14; i += 1) {
                const radius = between(10, 46);
                shapes.push(`<circle cx="${between(40, W - 40)}" cy="${between(380, 900)}" r="${radius}" fill="${rand() > 0.4 ? d : a}" opacity="${(0.25 + rand() * 0.45).toFixed(2)}" filter="url(#${radius > 30 ? 'mid' : 'fine'})"/>`);
            }
            break;
        }
        case 'still': {
            background = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d}"/><stop offset="1" stop-color="${a}"/></linearGradient>`;
            shapes.push(`<rect x="0" y="640" width="${W}" height="${H - 640}" fill="${a}" opacity="0.9"/>`);
            shapes.push(`<rect x="0" y="628" width="${W}" height="24" fill="${c}" opacity="0.18" filter="url(#fine)"/>`);
            const objects = [between(300, 420), between(700, 860), between(1100, 1250)];
            objects.forEach((cx, index) => {
                const radius = [150, 115, 90][index];
                const color = [c, b, d][index];
                shapes.push(`<ellipse cx="${cx + 40}" cy="${720}" rx="${radius * 1.2}" ry="${radius * 0.28}" fill="#000" opacity="0.22" filter="url(#soft)"/>`);
                if (index === 0) {
                    shapes.push(`<path d="M${cx - radius} 600 A ${radius} ${radius * 0.9} 0 0 0 ${cx + radius} 600 Z" fill="${color}" opacity="0.92" filter="url(#fine)"/>`);
                    shapes.push(`<ellipse cx="${cx}" cy="600" rx="${radius}" ry="${radius * 0.22}" fill="${d}" opacity="0.5" filter="url(#fine)"/>`);
                } else {
                    shapes.push(`<circle cx="${cx}" cy="${700 - radius}" r="${radius}" fill="${color}" opacity="0.95" filter="url(#fine)"/>`);
                    shapes.push(`<circle cx="${cx - radius * 0.35}" cy="${700 - radius * 1.35}" r="${radius * 0.3}" fill="#fff" opacity="0.28" filter="url(#mid)"/>`);
                }
            });
            shapes.push(`<circle cx="160" cy="80" r="520" fill="#fff" opacity="0.32" filter="url(#haze)"/>`);
            break;
        }
        case 'garden': {
            shapes.push(`<circle cx="${between(500, 1100)}" cy="${between(180, 320)}" r="460" fill="${d}" opacity="0.6" filter="url(#haze)"/>`);
            for (let i = 0; i < 30; i += 1) {
                const edge = rand();
                const cxPos = edge < 0.35 ? between(-80, 420) : edge < 0.7 ? between(1180, 1680) : between(0, W);
                const cyPos = edge < 0.7 ? between(-60, 900) : between(-120, 200);
                shapes.push(`<circle cx="${cxPos}" cy="${cyPos}" r="${between(70, 200)}" fill="${rand() > 0.45 ? b : c}" opacity="${(0.45 + rand() * 0.45).toFixed(2)}" filter="url(#soft)"/>`);
            }
            shapes.push(`<rect x="0" y="${between(800, 860)}" width="${W}" height="220" fill="${c}" opacity="0.45" filter="url(#soft)"/>`);
            break;
        }
        case 'night':
        default: {
            background = `<radialGradient id="bg" cx="0.5" cy="0.6" r="0.8"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${a}"/></radialGradient>`;
            shapes.push(`<circle cx="${between(500, 1100)}" cy="${between(400, 640)}" r="520" fill="${b}" opacity="0.22" filter="url(#haze)"/>`);
            for (let i = 0; i < 30; i += 1) {
                const radius = between(14, 92);
                const palette = [b, d, c, b];
                shapes.push(`<circle cx="${between(0, W)}" cy="${between(120, 920)}" r="${radius}" fill="${palette[i % palette.length]}" opacity="${(0.2 + rand() * 0.6).toFixed(2)}" filter="url(#${radius > 50 ? 'soft' : 'mid'})"/>`);
            }
            break;
        }
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`,
        '<defs>',
        background,
        '<filter id="fine" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter>',
        '<filter id="mid" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter>',
        '<filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="34"/></filter>',
        '<filter id="haze" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="90"/></filter>',
        `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${hashString(seedKey) % 997}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.16"/></feComponentTransfer></filter>`,
        '<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.32"/></radialGradient>',
        '</defs>',
        `<rect width="${W}" height="${H}" fill="url(#bg)"/>`,
        ...shapes,
        `<rect width="${W}" height="${H}" fill="url(#vignette)"/>`,
        `<rect width="${W}" height="${H}" filter="url(#grain)"/>`,
        '</svg>',
    ].join('');

    ART_CACHE.set(cacheKey, svg);
    return svg;
}

const THEME_COLORS: Record<string, { light: string; dark: string; mark: string; markInk: string }> = {
    corporate: { light: '#f6f1e8', dark: '#151311', mark: '#a23b2a', markInk: '#fbf6ee' },
    blog: { light: '#fbfbf9', dark: '#111314', mark: '#1f2328', markInk: '#fbfbf9' },
    nginx: { light: '#f4f3ee', dark: '#0f1411', mark: '#2f6b4f', markInk: '#f4f3ee' },
};

function createFaviconSvg(templateName: string, title: string): string {
    const colors = THEME_COLORS[templateName] || THEME_COLORS.corporate;
    const letter = escapeHtml((title.match(/[A-Za-z0-9一-鿿]/)?.[0] || 'C').toUpperCase());
    const font = templateName === 'corporate' ? 'Georgia, \'Times New Roman\', serif' : '-apple-system, \'Segoe UI\', Arial, sans-serif';
    const radius = templateName === 'blog' ? 32 : 14;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="${radius}" fill="${colors.mark}"/><text x="32" y="44" text-anchor="middle" font-family="${font}" font-size="36" font-weight="700" fill="${colors.markInk}">${letter}</text></svg>`;
}

// ── styles ──────────────────────────────────────────────────

const BASE_CSS = `
:root { color-scheme: light dark; --image-scrim: linear-gradient(180deg, transparent 62%, rgba(0, 0, 0, 0.08)); --radius: 4px; --max: 1160px;
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; scroll-behavior: smooth; }
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); color: var(--ink); font: 16px/1.7 var(--font-body); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
[data-lang][hidden] { display: none !important; }
a { color: inherit; text-decoration: none; transition: color 0.15s ease; }
a:hover { color: var(--accent); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
img { display: block; max-width: 100%; height: auto; }
h1, h2, h3, h4 { margin: 0; font-family: var(--font-display); color: var(--ink); font-weight: 700; line-height: 1.25; letter-spacing: -0.01em; }
p { margin: 0; }
.@main { flex: 1; padding-bottom: 72px; }
.@wrap { width: min(100% - 40px, var(--max)); margin-inline: auto; }
.@lang { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 999px; }
.@lang button { appearance: none; border: 0; background: transparent; color: var(--muted); font: 500 12px/1 var(--font-ui); padding: 6px 10px; border-radius: 999px; cursor: pointer; }
.@lang button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }
.@media { position: relative; display: block; overflow: hidden; border-radius: var(--radius); background: var(--line); }
.@media img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; transition: transform 0.6s ease; }
.@media::after { content: ""; position: absolute; inset: 0; background: var(--image-scrim); pointer-events: none; }
a.@media:hover img { transform: scale(1.025); }
.@kicker { display: inline-block; margin-bottom: 10px; font: 600 12px/1.2 var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.@byline { font: 13px/1.6 var(--font-ui); color: var(--muted); }
.@byline > span + span::before { content: "·"; margin: 0 8px; opacity: 0.6; }
.@dek { color: var(--muted); }
.@section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 0 0 22px; padding-bottom: 12px; border-bottom: 1px solid var(--ink); font: 700 13px/1.2 var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; }
.@section-title a { font-weight: 500; color: var(--muted); letter-spacing: 0.02em; text-transform: none; }
.@rows { list-style: none; margin: 0; padding: 0; }
.@rows li { display: grid; grid-template-columns: 112px 1fr auto; gap: 18px; align-items: baseline; padding: 14px 0; border-bottom: 1px solid var(--line); }
.@rows time { font: 13px/1.4 var(--font-mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.@rows a { font-family: var(--font-display); font-size: 18px; font-weight: 600; }
.@rows .@tag { font: 12px/1.4 var(--font-ui); color: var(--muted); }
.@article { max-width: 760px; margin-top: 56px; }
.@article-head { margin-bottom: 32px; }
.@article-title { font-size: clamp(32px, 5vw, 48px); line-height: 1.15; margin-bottom: 18px; }
.@article .@dek { font-size: 20px; line-height: 1.6; margin-bottom: 20px; }
.@figure { margin: 0 0 40px; }
.@figure .@media img { aspect-ratio: 16 / 10; }
.@figure figcaption { margin-top: 10px; font: 13px/1.6 var(--font-ui); color: var(--muted); }
.@prose { font-family: var(--font-prose, var(--font-body)); font-size: 18px; line-height: 1.85; }
.@prose p + p { margin-top: 1.2em; }
.@facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 0 0 36px; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--line); }
.@facts div { padding: 14px 16px; background: var(--surface); }
.@facts dt { font: 600 11px/1.3 var(--font-ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
.@facts dd { margin: 0; font: 600 15px/1.5 var(--font-ui); }
.@tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 40px; }
.@tags span { padding: 4px 12px; border: 1px solid var(--line); border-radius: 999px; font: 13px/1.5 var(--font-ui); color: var(--muted); }
.@pager { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); }
.@pager a { display: block; }
.@pager small { display: block; margin-bottom: 4px; font: 12px/1.4 var(--font-ui); color: var(--muted); letter-spacing: 0.04em; }
.@pager strong { font-family: var(--font-display); font-size: 17px; line-height: 1.4; }
.@pager .@next { text-align: right; }
.@related { margin-top: 72px; }
.@cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 32px; }
.@card h3 { font-size: 20px; line-height: 1.35; margin: 14px 0 8px; }
.@card .@dek { font-size: 15px; line-height: 1.6; margin-bottom: 10px; }
.@page-head { margin: 56px auto 36px; max-width: 760px; }
.@page-head h1 { font-size: clamp(30px, 4.5vw, 42px); margin-bottom: 12px; }
.@page-head p { color: var(--muted); font-size: 17px; }
.@narrow { max-width: 760px; }
.@archive-month { margin-top: 40px; }
.@archive-month h2 { font: 600 14px/1.3 var(--font-ui); color: var(--muted); letter-spacing: 0.04em; margin-bottom: 4px; }
.@missing { max-width: 640px; margin: 96px auto 64px; text-align: center; }
.@missing .@code { font: 600 13px/1 var(--font-mono); letter-spacing: 0.3em; color: var(--accent); margin-bottom: 18px; }
.@missing h1 { font-size: clamp(30px, 5vw, 44px); margin-bottom: 14px; }
.@missing p { color: var(--muted); font-size: 17px; }
.@actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 28px; }
.@button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 20px; border-radius: 999px; border: 1px solid var(--ink); font: 600 14px/1 var(--font-ui); }
.@button-solid { background: var(--ink); color: var(--bg); }
.@button-solid:hover { color: var(--bg); opacity: 0.88; }
.@foot { margin-top: auto; border-top: 1px solid var(--line); padding: 40px 0 48px; font: 14px/1.7 var(--font-ui); color: var(--muted); }
.@foot-inner { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px 48px; }
.@foot strong { display: block; color: var(--ink); font-family: var(--font-display); font-size: 18px; margin-bottom: 6px; }
.@foot nav { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px 22px; align-self: start; }
.@fine { grid-column: 1 / -1; padding-top: 20px; border-top: 1px solid var(--line); font-size: 13px; }
@media (max-width: 860px) {
  .@cards { grid-template-columns: 1fr 1fr; gap: 28px 20px; }
  .@foot-inner { grid-template-columns: 1fr; }
  .@foot nav { justify-content: flex-start; }
}
@media (max-width: 768px) {
  .@lang button { display: inline-flex; align-items: center; min-height: 36px; padding: 8px 12px; }
}
@media (max-width: 600px) {
  .@cards { grid-template-columns: 1fr; }
  .@rows li { grid-template-columns: 1fr; gap: 2px; }
  .@rows .@tag { display: none; }
  .@facts { grid-template-columns: 1fr; }
  .@pager { grid-template-columns: 1fr; }
  .@pager .@next { text-align: left; }
  .@article { margin-top: 36px; }
  .@prose { font-size: 17px; }
}
`;

const THEME_CSS: Record<string, string> = {
    corporate: `
:root { --bg: #f6f1e8; --surface: #fffdf8; --ink: #1d1a16; --muted: #6b6258; --line: rgba(29, 26, 22, 0.14); --accent: #a23b2a;
  --font-body: var(--font-serif); --font-display: var(--font-serif); --font-prose: var(--font-serif); --radius: 2px; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #151311; --surface: #1c1a17; --ink: #ece6dc; --muted: #a49b8f; --line: rgba(236, 230, 220, 0.14); --accent: #e07a5f;
    --image-scrim: linear-gradient(180deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.18)); }
}
.@mast-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--line); font: 12px/1.4 var(--font-ui); color: var(--muted); letter-spacing: 0.04em; }
.@mast-brand { padding: 34px 0 26px; text-align: center; }
.@brand { display: inline-block; font-family: var(--font-serif); font-size: clamp(38px, 7vw, 72px); font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
.@tagline { margin-top: 12px; font-style: italic; color: var(--muted); font-size: 16px; }
.@nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 28px; padding: 12px 0; border-top: 3px double var(--ink); border-bottom: 1px solid var(--ink); font: 600 13px/1.6 var(--font-ui); letter-spacing: 0.06em; }
.@lead { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 40px; align-items: center; padding: 44px 0; border-bottom: 1px solid var(--line); }
.@lead-title { font-size: clamp(32px, 4.4vw, 50px); line-height: 1.12; margin-bottom: 18px; }
.@lead .@dek { font-size: 19px; line-height: 1.6; margin-bottom: 18px; }
.@grid { padding: 40px 0; border-bottom: 1px solid var(--line); }
.@split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 56px; padding-top: 44px; }
.@stream article { display: grid; grid-template-columns: 220px 1fr; gap: 24px; padding: 22px 0; border-bottom: 1px solid var(--line); }
.@stream article:first-of-type { padding-top: 0; }
.@stream h3 { font-size: 22px; margin-bottom: 8px; }
.@stream .@dek { font-size: 15px; margin-bottom: 8px; }
.@picks { list-style: none; margin: 0; padding: 0; counter-reset: pick; }
.@picks li { counter-increment: pick; display: grid; grid-template-columns: 36px 1fr; gap: 8px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.@picks li::before { content: counter(pick); font: italic 700 26px/1 var(--font-serif); color: var(--accent); }
.@picks a { font-weight: 600; font-size: 17px; line-height: 1.4; }
.@note { margin-top: 36px; padding: 22px; background: var(--surface); border: 1px solid var(--line); }
.@note p { font-size: 15px; color: var(--muted); margin: 8px 0 14px; }
.@note a { font: 600 13px/1 var(--font-ui); color: var(--accent); }
@media (max-width: 860px) {
  .@lead, .@split { grid-template-columns: 1fr; gap: 28px; }
  .@stream article { grid-template-columns: 140px 1fr; gap: 16px; }
}
@media (max-width: 600px) {
  .@mast-top > span { font-size: 11px; }
  .@nav { justify-content: flex-start; overflow-x: auto; flex-wrap: nowrap; white-space: nowrap; gap: 22px; scrollbar-width: none; }
  .@stream article { grid-template-columns: 1fr; }
}
`,
    blog: `
:root { --bg: #fbfbf9; --surface: #ffffff; --ink: #1f2328; --muted: #59636e; --line: #e6e6e1; --accent: #2f6f62; --max: 880px; --radius: 6px;
  --font-body: var(--font-ui); --font-display: var(--font-ui); --font-prose: var(--font-ui); }
@media (prefers-color-scheme: dark) {
  :root { --bg: #111314; --surface: #181b1c; --ink: #e6e8e6; --muted: #9aa3a0; --line: #262a2b; --accent: #7cc4b2;
    --image-scrim: linear-gradient(180deg, rgba(0, 0, 0, 0.02), rgba(0, 0, 0, 0.16)); }
}
.@bar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 28px 0; border-bottom: 1px solid var(--line); }
.@brand { display: inline-flex; align-items: center; gap: 14px; }
.@avatar { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--ink); color: var(--bg); font: 600 18px/1 var(--font-ui); }
.@brand strong { display: block; font-size: 17px; font-weight: 650; line-height: 1.2; }
.@brand small { display: block; font-size: 13px; color: var(--muted); }
.@nav { display: flex; align-items: center; gap: 22px; font-size: 14px; color: var(--muted); }
.@nav a:hover { color: var(--ink); }
.@intro { padding: 56px 0 24px; }
.@intro p { font-size: clamp(22px, 3.2vw, 28px); line-height: 1.5; font-weight: 500; letter-spacing: -0.01em; max-width: 680px; }
.@posts { margin-top: 16px; }
.@post { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 32px; align-items: center; padding: 30px 0; border-top: 1px solid var(--line); }
.@post .@meta { font: 13px/1.5 var(--font-mono); color: var(--muted); margin-bottom: 8px; }
.@post h2 { font-size: 24px; font-weight: 650; margin-bottom: 8px; }
.@post .@dek { font-size: 16px; }
.@article-title { font-weight: 700; letter-spacing: -0.02em; }
.@kicker { color: var(--muted); }
@media (max-width: 680px) {
  .@bar { flex-wrap: wrap; padding: 20px 0; }
  .@nav { gap: 16px; }
  .@post { grid-template-columns: 1fr; gap: 16px; }
  .@post .@media { order: -1; }
}
`,
    nginx: `
:root { --bg: #f4f3ee; --surface: #ffffff; --ink: #17201b; --muted: #5d6a62; --line: rgba(23, 32, 27, 0.12); --accent: #2f6b4f; --accent-soft: #e3eee6; --warm: #c8682a; --radius: 10px;
  --font-body: var(--font-ui); --font-display: var(--font-ui); --font-prose: var(--font-ui); }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1411; --surface: #161d19; --ink: #e5ece7; --muted: #9db0a5; --line: rgba(229, 236, 231, 0.12); --accent: #7fc4a0; --accent-soft: rgba(127, 196, 160, 0.14); --warm: #e9965c;
    --image-scrim: linear-gradient(180deg, rgba(0, 0, 0, 0.02), rgba(0, 0, 0, 0.2)); }
}
.@bar { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: saturate(1.4) blur(12px); -webkit-backdrop-filter: saturate(1.4) blur(12px); border-bottom: 1px solid var(--line); }
.@bar-inner { display: flex; align-items: center; gap: 28px; min-height: 64px; }
.@brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 750; font-size: 17px; letter-spacing: -0.01em; }
.@mark { width: 26px; height: 26px; border-radius: 8px; background: var(--accent); box-shadow: inset -8px -8px 0 color-mix(in srgb, var(--warm) 80%, transparent); }
.@nav { display: flex; gap: 20px; font-size: 14px; color: var(--muted); margin-right: auto; }
.@hero { padding: 64px 0 40px; }
.@eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font: 600 13px/1 var(--font-ui); margin-bottom: 18px; }
.@hero h1 { font-size: clamp(36px, 6vw, 64px); line-height: 1.05; letter-spacing: -0.03em; margin-bottom: 16px; }
.@hero p { font-size: 18px; color: var(--muted); max-width: 640px; }
.@events { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 24px; }
.@feature { display: grid; grid-template-columns: minmax(0, 6fr) minmax(0, 5fr); gap: 40px; align-items: center; }
.@feature h3 { font-size: clamp(24px, 3vw, 32px); margin: 0 0 12px; }
.@feature .@dek { font-size: 17px; margin-bottom: 14px; }
.@event { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; transition: transform 0.2s ease, box-shadow 0.2s ease; }
.@event:hover { transform: translateY(-2px); box-shadow: 0 18px 40px -24px rgba(0, 0, 0, 0.35); }
.@event .@media { border-radius: 0; }
.@event-body { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px 20px; flex: 1; }
.@event h3 { font-size: 19px; }
.@badge { align-self: flex-start; padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font: 600 12px/1.3 var(--font-ui); }
.@event dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: auto 0 0; padding-top: 12px; border-top: 1px dashed var(--line); font-size: 13px; }
.@event dt { color: var(--muted); }
.@event dd { margin: 0; font-weight: 600; }
.@block { margin-top: 56px; }
.@section-title { border-bottom-color: var(--line); }
.@facts { border-radius: var(--radius); }
.@kicker { color: var(--warm); }
@media (max-width: 640px) {
  .@events, .@feature { grid-template-columns: 1fr; gap: 20px; }
  .@nav { display: none; }
  .@bar-inner { justify-content: space-between; }
  .@hero { padding: 40px 0 28px; }
}
`,
};

// ── layout ──────────────────────────────────────────────────

const UI = {
    home: t('首页', 'Home'),
    archive: t('归档', 'Archive'),
    about: t('关于', 'About'),
    latest: t('最新文章', 'Latest'),
    picks: t('编辑推荐', 'Editors\' picks'),
    readMore: t('继续阅读', 'Keep reading'),
    allPosts: t('全部文章', 'All posts'),
    newer: t('较新的一篇', 'Newer'),
    older: t('较早的一篇', 'Older'),
    when: t('时间', 'When'),
    where: t('地点', 'Where'),
    price: t('费用', 'Price'),
    contact: t('来信', 'Write to us'),
    notFoundTitle: t('页面不存在', 'Page not found'),
    notFoundCopy: t('你要找的页面可能已经移动、更名或被删除。', 'The page you are looking for may have moved, been renamed or removed.'),
    backHome: t('返回首页', 'Back to home'),
    browseArchive: t('浏览归档', 'Browse the archive'),
    recent: t('最近更新', 'Recently published'),
    thisWeekend: t('本周末推荐', 'This weekend'),
    moreGuides: t('更多指南', 'More guides'),
};

function minutesLabel(minutes: number): Bilingual {
    return t(`${minutes} 分钟阅读`, `${minutes} min read`);
}

function langSwitch(): string {
    return `<div class="${cx('lang')}" role="group" aria-label="Language">`
        + '<button type="button" data-lang-button="zh-CN" aria-pressed="true">中文</button>'
        + '<button type="button" data-lang-button="en-US" aria-pressed="false">English</button>'
        + '</div>';
}

function navLinks(site: SiteModel, includeSections: boolean): string {
    const links = [`<a href="/">${bi(UI.home)}</a>`];
    if (includeSections) {
        for (const section of site.content.sections) {
            links.push(`<a href="/section/${slugify(section.en)}">${bi(section)}</a>`);
        }
    }
    links.push(`<a href="/archive">${bi(UI.archive)}</a>`, `<a href="/about">${bi(UI.about)}</a>`);
    return links.join('');
}

function renderHeader(site: SiteModel): string {
    const title = escapeHtml(site.title);
    if (site.templateName === 'blog') {
        return `<header class="${cx('wrap bar')}">`
            + `<a class="${cx('brand')}" href="/"><span class="${cx('avatar')}" aria-hidden="true">${escapeHtml(site.content.articles[0]?.author.en.charAt(0) || 'C')}</span><span><strong>${title}</strong><small>${bi(site.content.kicker)}</small></span></a>`
            + `<nav class="${cx('nav')}" aria-label="Main">${navLinks(site, false)}${langSwitch()}</nav>`
            + '</header>';
    }
    if (site.templateName === 'nginx') {
        return `<header class="${cx('bar')}"><div class="${cx('wrap bar-inner')}">`
            + `<a class="${cx('brand')}" href="/"><span class="${cx('mark')}" aria-hidden="true"></span>${title}</a>`
            + `<nav class="${cx('nav')}" aria-label="Main">${navLinks(site, true).replace(`<a href="/">${bi(UI.home)}</a>`, '')}</nav>`
            + langSwitch()
            + '</div></header>';
    }
    const issue = t(`第 ${site.issueNumber} 期`, `Issue ${site.issueNumber}`);
    const date = formatDate(site.now);
    return `<header>`
        + `<div class="${cx('wrap mast-top')}"><span>${bi(issue)} · ${bi(date)}</span>${langSwitch()}</div>`
        + `<div class="${cx('wrap mast-brand')}"><a class="${cx('brand')}" href="/">${title}</a><p class="${cx('tagline')}">${bi(site.content.tagline)}</p></div>`
        + `<nav class="${cx('wrap nav')}" aria-label="Main">${navLinks(site, true)}</nav>`
        + '</header>';
}

function renderFooter(site: SiteModel): string {
    const year = site.now.getUTCFullYear();
    const contact = site.contactEmail
        ? ` · ${bi(UI.contact)} <a href="mailto:${escapeHtml(site.contactEmail)}">${escapeHtml(site.contactEmail)}</a>`
        : '';
    return `<footer class="${cx('foot')}"><div class="${cx('wrap foot-inner')}">`
        + `<div><strong>${escapeHtml(site.title)}</strong>${bi(site.content.tagline, { tag: 'p' })}</div>`
        + `<nav aria-label="Footer"><a href="/archive">${bi(UI.archive)}</a><a href="/about">${bi(UI.about)}</a><a href="/feed.xml">RSS</a></nav>`
        + `<p class="${cx('fine')}">© ${site.firstYear}–${year} ${escapeHtml(site.title)} · ${bi(t(site.content.colophon.zh.replace(/[。.]$/, ''), site.content.colophon.en.replace(/[。.]$/, '')))}${contact}</p>`
        + '</div></footer>';
}

const LANGUAGE_SCRIPT = `(() => {
  const key = '${LANGUAGE_STORAGE_KEY}';
  const root = document.documentElement;
  const items = document.querySelectorAll('[data-lang]');
  const buttons = document.querySelectorAll('[data-lang-button]');
  const apply = (lang) => {
    const next = lang === 'en-US' ? 'en-US' : 'zh-CN';
    root.lang = next;
    const title = root.getAttribute(next === 'en-US' ? 'data-title-en' : 'data-title-zh');
    if (title) document.title = title;
    items.forEach((item) => { item.hidden = item.getAttribute('data-lang') !== next; });
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.getAttribute('data-lang-button') === next)));
  };
  let initial = null;
  try { initial = window.localStorage.getItem(key); } catch (error) {}
  if (!initial) initial = /^en\\b/i.test(navigator.language || '') ? 'en-US' : 'zh-CN';
  apply(initial);
  buttons.forEach((button) => button.addEventListener('click', () => {
    const lang = button.getAttribute('data-lang-button');
    apply(lang);
    try { window.localStorage.setItem(key, lang); } catch (error) {}
  }));
})();`;

interface PageSpec {
    title: Bilingual | null;
    description: Bilingual;
    path: string;
    body: string;
    type?: 'website' | 'article';
}

function renderDocument(site: SiteModel, page: PageSpec): string {
    const siteTitle = site.title;
    const fullTitle = page.title
        ? t(`${page.title.zh} | ${siteTitle}`, `${page.title.en} | ${siteTitle}`)
        : t(`${siteTitle} | ${site.content.kicker.zh}`, `${siteTitle} | ${site.content.kicker.en}`);
    const colors = THEME_COLORS[site.templateName] || THEME_COLORS.corporate;
    const canonical = site.origin && page.path ? `<link rel="canonical" href="${escapeHtml(site.origin + page.path)}" />` : '';
    const css = scopeCss(BASE_CSS + (THEME_CSS[site.templateName] || THEME_CSS.corporate));

    return `<!doctype html>
<html lang="zh-CN" data-title-zh="${escapeHtml(fullTitle.zh)}" data-title-en="${escapeHtml(fullTitle.en)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(fullTitle.zh)}</title>
<meta name="description" content="${escapeHtml(page.description.zh)}" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${colors.light}" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${colors.dark}" />
<meta property="og:site_name" content="${escapeHtml(siteTitle)}" />
<meta property="og:title" content="${escapeHtml(page.title ? page.title.zh : siteTitle)}" />
<meta property="og:type" content="${page.type || 'website'}" />
${canonical}
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(siteTitle)}" href="/feed.xml" />
<style>${css}</style>
</head>
<body class="${cx(`page theme-${site.templateName}`)}">
${renderHeader(site)}
<main id="main" class="${cx('main')}">
${page.body}
</main>
${renderFooter(site)}
<script>${LANGUAGE_SCRIPT}</script>
</body>
</html>`;
}

// ── page fragments ──────────────────────────────────────────

function image(article: DatedArticle, { eager = false, link = true } = {}): string {
    const img = `<img src="${article.image}" alt="${escapeHtml(article.title.zh)}" width="1600" height="1000"${eager ? '' : ' loading="lazy"'} decoding="async" />`;
    return link
        ? `<a class="${cx('media')}" href="${article.url}" tabindex="-1" aria-hidden="true">${img}</a>`
        : `<div class="${cx('media')}">${img}</div>`;
}

function byline(article: DatedArticle, { author = true } = {}): string {
    const parts = [];
    if (author) parts.push(`<span>${bi(article.author)}</span>`);
    parts.push(`<span><time datetime="${isoDate(article.date)}">${bi(formatDate(article.date))}</time></span>`);
    parts.push(`<span>${bi(minutesLabel(article.minutes))}</span>`);
    return `<p class="${cx('byline')}">${parts.join('')}</p>`;
}

function card(article: DatedArticle): string {
    return `<article class="${cx('card')}">${image(article)}`
        + `<h3><a href="${article.url}">${bi(article.title)}</a></h3>`
        + `<p class="${cx('dek')}">${bi(article.dek)}</p>`
        + `${byline(article, { author: false })}</article>`;
}

function rows(articles: DatedArticle[]): string {
    return `<ul class="${cx('rows')}">${articles.map((article) => `<li>`
        + `<time datetime="${isoDate(article.date)}">${isoDate(article.date)}</time>`
        + `<a href="${article.url}">${bi(article.title)}</a>`
        + `<span class="${cx('tag')}">${bi(article.section)}</span>`
        + '</li>').join('')}</ul>`;
}

function renderMagazineHome(site: SiteModel): string {
    const [lead, ...rest] = site.articles;
    const grid = rest.slice(0, 3);
    const stream = site.articles.slice(4);
    const rand = createRandom(site.seed);
    const picks = [...site.articles].sort(() => rand() - 0.5).slice(0, 3);
    return `<section class="${cx('wrap lead')}">${image(lead, { eager: true })}`
        + `<div><a class="${cx('kicker')}" href="/section/${lead.sectionSlug}">${bi(lead.section)}</a>`
        + `<h1 class="${cx('lead-title')}"><a href="${lead.url}">${bi(lead.title)}</a></h1>`
        + `<p class="${cx('dek')}">${bi(lead.dek)}</p>${byline(lead)}</div></section>`
        + `<section class="${cx('wrap grid')}"><div class="${cx('cards')}">${grid.map(card).join('')}</div></section>`
        + `<section class="${cx('wrap split')}">`
        + `<div><h2 class="${cx('section-title')}">${bi(UI.latest)}<a href="/archive">${bi(UI.allPosts)} →</a></h2><div class="${cx('stream')}">`
        + stream.map((article) => `<article>${image(article)}<div>`
            + `<a class="${cx('kicker')}" href="/section/${article.sectionSlug}">${bi(article.section)}</a>`
            + `<h3><a href="${article.url}">${bi(article.title)}</a></h3>`
            + `<p class="${cx('dek')}">${bi(article.dek)}</p>${byline(article)}</div></article>`).join('')
        + '</div></div>'
        + `<aside><h2 class="${cx('section-title')}">${bi(UI.picks)}</h2><ol class="${cx('picks')}">`
        + picks.map((article) => `<li><div><a href="${article.url}">${bi(article.title)}</a>${byline(article, { author: false })}</div></li>`).join('')
        + `</ol><div class="${cx('note')}"><strong>${bi(site.content.kicker)}</strong>${bi(t(site.content.about.zh[0], site.content.about.en[0]), { tag: 'p' })}<a href="/about">${bi(site.content.aboutTitle)} →</a></div></aside>`
        + '</section>';
}

function renderBlogHome(site: SiteModel): string {
    return `<section class="${cx('wrap intro')}">${bi(site.content.tagline, { tag: 'p' })}</section>`
        + `<section class="${cx('wrap posts')}">`
        + site.articles.map((article, index) => `<article class="${cx('post')}"><div>`
            + `<p class="${cx('meta')}"><time datetime="${isoDate(article.date)}">${isoDate(article.date)}</time> · ${article.tags.map((tag) => `#${bi(tag)}`).join(' ')}</p>`
            + `<h2><a href="${article.url}">${bi(article.title)}</a></h2>`
            + `<p class="${cx('dek')}">${bi(article.dek)}</p></div>${image(article, { eager: index < 2 })}</article>`).join('')
        + '</section>';
}

function upcomingWeekend(now: Date): [Date, Date] {
    const weekday = now.getUTCDay();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const offset = weekday === 0 ? -1 : 6 - weekday;
    const saturday = new Date(midnight + offset * DAY_MS);
    return [saturday, new Date(saturday.getTime() + DAY_MS)];
}

function renderGuideHome(site: SiteModel): string {
    const [saturday, sunday] = upcomingWeekend(site.now);
    const sameMonth = saturday.getUTCMonth() === sunday.getUTCMonth();
    const range = t(
        `${saturday.getUTCMonth() + 1}月${saturday.getUTCDate()}日 – ${sameMonth ? '' : `${sunday.getUTCMonth() + 1}月`}${sunday.getUTCDate()}日`,
        `${MONTHS_EN[saturday.getUTCMonth()]} ${saturday.getUTCDate()} – ${sameMonth ? '' : `${MONTHS_EN[sunday.getUTCMonth()]} `}${sunday.getUTCDate()}`,
    );
    const events = site.articles.filter((article) => article.event);
    const guides = site.articles.filter((article) => !article.event);
    return `<section class="${cx('hero')}"><div class="${cx('wrap')}">`
        + `<p class="${cx('eyebrow')}">${bi(t(`第 ${site.issueNumber} 期`, `Edition ${site.issueNumber}`))} · ${bi(t('周末', 'Weekend'))}</p>`
        + `<h1>${bi(range)}</h1>${bi(site.content.tagline, { tag: 'p' })}</div></section>`
        + `<section class="${cx('wrap')}"><h2 class="${cx('section-title')}">${bi(UI.thisWeekend)}<a href="/archive">${bi(UI.archive)} →</a></h2><div class="${cx('events')}">`
        + events.map((article, index) => `<article class="${cx('event')}">${image(article, { eager: index < 3 })}<div class="${cx('event-body')}">`
            + `<span class="${cx('badge')}">${bi(article.section)}</span>`
            + `<h3><a href="${article.url}">${bi(article.title)}</a></h3>`
            + `<p class="${cx('dek')}">${bi(article.dek)}</p>`
            + `<dl><dt>${bi(UI.when)}</dt><dd>${bi(article.event!.when)}</dd><dt>${bi(UI.where)}</dt><dd>${bi(article.event!.venue)}</dd><dt>${bi(UI.price)}</dt><dd>${bi(article.event!.price)}</dd></dl>`
            + '</div></article>').join('')
        + '</div></section>'
        + (guides.length
            ? `<section class="${cx('wrap block')}"><h2 class="${cx('section-title')}">${bi(UI.moreGuides)}</h2>${guides.length >= 3
                ? `<div class="${cx('cards')}">${guides.map(card).join('')}</div>`
                : guides.map((article) => `<article class="${cx('feature')}">${image(article)}<div><span class="${cx('kicker')}">${bi(article.section)}</span><h3><a href="${article.url}">${bi(article.title)}</a></h3><p class="${cx('dek')}">${bi(article.dek)}</p>${byline(article)}</div></article>`).join('')}</section>`
            : '');
}

function renderArticle(site: SiteModel, article: DatedArticle): string {
    const index = site.articles.indexOf(article);
    const newer = site.articles[index - 1];
    const older = site.articles[index + 1];
    const related = site.articles.filter((item) => item !== article).slice(0, 3);
    const facts = article.event
        ? `<dl class="${cx('facts')}"><div><dt>${bi(UI.when)}</dt><dd>${bi(article.event.when)}</dd></div><div><dt>${bi(UI.where)}</dt><dd>${bi(article.event.venue)}</dd></div><div><dt>${bi(UI.price)}</dt><dd>${bi(article.event.price)}</dd></div></dl>`
        : '';
    return `<article class="${cx('wrap article')}">`
        + `<header class="${cx('article-head')}"><a class="${cx('kicker')}" href="/section/${article.sectionSlug}">${bi(article.section)}</a>`
        + `<h1 class="${cx('article-title')}">${bi(article.title)}</h1>`
        + `<p class="${cx('dek')}">${bi(article.dek)}</p>${byline(article)}</header>`
        + `<figure class="${cx('figure')}">${image(article, { eager: true, link: false })}<figcaption>${bi(article.caption)}</figcaption></figure>`
        + facts
        + `<div class="${cx('prose')}"><div data-lang="zh-CN">${article.body.zh.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`
        + `<div data-lang="en-US" hidden>${article.body.en.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div></div>`
        + `<div class="${cx('tags')}">${article.tags.map((tag) => `<span>${bi(tag)}</span>`).join('')}</div>`
        + `<nav class="${cx('pager')}" aria-label="Posts">`
        + (newer ? `<a href="${newer.url}"><small>← ${bi(UI.newer)}</small><strong>${bi(newer.title)}</strong></a>` : '<span></span>')
        + (older ? `<a class="${cx('next')}" href="${older.url}"><small>${bi(UI.older)} →</small><strong>${bi(older.title)}</strong></a>` : '<span></span>')
        + '</nav></article>'
        + `<section class="${cx('wrap related')}"><h2 class="${cx('section-title')}">${bi(UI.readMore)}</h2><div class="${cx('cards')}">${related.map(card).join('')}</div></section>`;
}

function renderArchive(site: SiteModel, articles: DatedArticle[], heading: Bilingual, intro: Bilingual): string {
    const groups = new Map<string, DatedArticle[]>();
    for (const article of articles) {
        const key = isoDate(article.date).slice(0, 7);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(article);
    }
    return `<section class="${cx('wrap page-head')}"><h1>${bi(heading)}</h1>${bi(intro, { tag: 'p' })}</section>`
        + `<section class="${cx('wrap narrow')}">`
        + [...groups.values()].map((items) => `<div class="${cx('archive-month')}"><h2>${bi(formatMonth(items[0].date))}</h2>${rows(items)}</div>`).join('')
        + '</section>';
}

function renderAbout(site: SiteModel): string {
    const contact = site.contactEmail
        ? `<p>${bi(UI.contact)}：<a href="mailto:${escapeHtml(site.contactEmail)}">${escapeHtml(site.contactEmail)}</a></p>`
        : '';
    return `<section class="${cx('wrap page-head')}"><h1>${bi(site.content.aboutTitle)}</h1>${bi(site.content.kicker, { tag: 'p' })}</section>`
        + `<section class="${cx('wrap narrow prose')}"><div data-lang="zh-CN">${site.content.about.zh.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>`
        + `<div data-lang="en-US" hidden>${site.content.about.en.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>${contact}</section>`;
}

function renderNotFound(site: SiteModel): string {
    return `<section class="${cx('wrap missing')}"><p class="${cx('code')}">404</p><h1>${bi(UI.notFoundTitle)}</h1>${bi(UI.notFoundCopy, { tag: 'p' })}`
        + `<div class="${cx('actions')}"><a class="${cx('button button-solid')}" href="/">${bi(UI.backHome)}</a><a class="${cx('button')}" href="/archive">${bi(UI.browseArchive)}</a></div></section>`
        + `<section class="${cx('wrap narrow')}"><h2 class="${cx('section-title')}">${bi(UI.recent)}</h2>${rows(site.articles.slice(0, 4))}</section>`;
}

// ── feeds ───────────────────────────────────────────────────

function renderFeed(site: SiteModel): string {
    const origin = site.origin || '';
    const items = site.articles.map((article) => `    <item>
      <title>${escapeHtml(article.title.zh)}</title>
      <link>${escapeHtml(origin + article.url)}</link>
      <guid isPermaLink="true">${escapeHtml(origin + article.url)}</guid>
      <pubDate>${article.date.toUTCString()}</pubDate>
      <category>${escapeHtml(article.section.zh)}</category>
      <description>${escapeHtml(article.dek.zh)}</description>
    </item>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(site.title)}</title>
    <link>${escapeHtml(origin + '/')}</link>
    <description>${escapeHtml(site.content.tagline.zh)}</description>
    <language>zh-cn</language>
    <lastBuildDate>${site.latest.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function renderSitemap(site: SiteModel): string {
    const origin = site.origin || '';
    const entries: Array<[string, Date]> = [
        ['/', site.latest],
        ['/archive', site.latest],
        ['/about', new Date(Date.UTC(site.firstYear + 1, 2, 14))],
        ...site.content.sections.map((section) => [`/section/${slugify(section.en)}`, site.latest] as [string, Date]),
        ...site.articles.map((article) => [article.url, article.date] as [string, Date]),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(([path, date]) => `  <url><loc>${escapeHtml(origin + path)}</loc><lastmod>${isoDate(date)}</lastmod></url>`).join('\n')}
</urlset>
`;
}

// ── routing ─────────────────────────────────────────────────

export interface CamouflageResponse {
    status: number;
    contentType: string;
    body: string;
    cacheControl: string;
    lastModified?: string;
}

export interface RenderModelOptions {
    siteConfig?: any;
    template?: string;
    title?: string;
    statusCode?: number;
    requestPath?: string;
    requestMethod?: string;
    origin?: string;
    contactEmail?: string;
    now?: Date;
}

function normalizeRequestPath(value: unknown): string {
    let pathname = String(value || '/').split(/[?#]/)[0].trim() || '/';
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '') || '/';
    return pathname;
}

export function renderCamouflageResponse(options: RenderModelOptions = {}): CamouflageResponse {
    const siteConfig = {
        camouflageTemplate: options.template,
        camouflageTitle: options.title,
        ...(options.siteConfig && typeof options.siteConfig === 'object' ? options.siteConfig : {}),
    };
    const site = buildSiteModel(siteConfig, options);
    const pathname = normalizeRequestPath(options.requestPath);
    const lastModified = site.latest.toUTCString();
    const html = (status: number, page: PageSpec): CamouflageResponse => ({
        status,
        contentType: 'text/html; charset=utf-8',
        body: renderDocument(site, page),
        cacheControl: CAMOUFLAGE_PAGE_CACHE_CONTROL,
        lastModified: status === 200 ? lastModified : undefined,
    });
    const tagline = site.content.tagline;

    if (pathname === '/' || pathname === '/index.html') {
        const body = site.templateName === 'blog'
            ? renderBlogHome(site)
            : site.templateName === 'nginx' ? renderGuideHome(site) : renderMagazineHome(site);
        return html(200, { title: null, description: tagline, path: '/', body });
    }

    if (pathname.startsWith(`${site.content.articleBase}/`)) {
        const slug = pathname.slice(site.content.articleBase.length + 1);
        const article = site.articles.find((item) => item.slug === slug);
        if (article) {
            return html(200, { title: article.title, description: article.dek, path: article.url, body: renderArticle(site, article), type: 'article' });
        }
    }

    if (pathname === '/archive') {
        return html(200, {
            title: UI.archive,
            description: tagline,
            path: '/archive',
            body: renderArchive(site, site.articles, UI.archive, t(`共 ${site.articles.length} 篇文章`, `${site.articles.length} posts`)),
        });
    }

    if (pathname === '/about') {
        return html(200, { title: site.content.aboutTitle, description: t(site.content.about.zh[0], site.content.about.en[0]), path: '/about', body: renderAbout(site) });
    }

    if (pathname.startsWith('/section/')) {
        const sectionSlug = pathname.slice('/section/'.length);
        const section = site.content.sections.find((item) => slugify(item.en) === sectionSlug);
        if (section) {
            const articles = site.articles.filter((article) => article.sectionSlug === sectionSlug);
            return html(200, {
                title: section,
                description: tagline,
                path: pathname,
                body: renderArchive(site, articles, section, articles.length ? t(`${articles.length} 篇文章`, `${articles.length} posts`) : t('这个栏目暂时还没有文章。', 'Nothing in this section yet.')),
            });
        }
    }

    if (pathname === '/feed.xml') {
        return { status: 200, contentType: 'application/rss+xml; charset=utf-8', body: renderFeed(site), cacheControl: CAMOUFLAGE_PAGE_CACHE_CONTROL, lastModified };
    }

    if (pathname === '/sitemap.xml') {
        return { status: 200, contentType: 'application/xml; charset=utf-8', body: renderSitemap(site), cacheControl: CAMOUFLAGE_PAGE_CACHE_CONTROL, lastModified };
    }

    return html(404, { title: UI.notFoundTitle, description: UI.notFoundCopy, path: '', body: renderNotFound(site) });
}

/** Renders an HTML page of the camouflage site (the 404 page for unknown paths). */
export function createSiteCamouflageHtml(options: RenderModelOptions = {}): string {
    const result = renderCamouflageResponse(options);
    if (result.contentType.startsWith('text/html')) return result.body;
    return renderCamouflageResponse({ ...options, requestPath: '/__missing__' }).body;
}

// ── static media ────────────────────────────────────────────

export function resolveCamouflageAsset(siteConfig: any, pathname: string): { contentType: string; body: string } | null {
    const templateName = normalizeTemplate(siteConfig?.camouflageTemplate);
    const title = normalizeTitle(siteConfig?.camouflageTitle);
    if (pathname === '/favicon.svg' || pathname === '/favicon.ico') {
        return { contentType: 'image/svg+xml', body: createFaviconSvg(templateName, title) };
    }
    const match = /^\/media\/([a-z0-9-]+)\.svg$/.exec(pathname);
    if (!match) return null;
    const article = CAMOUFLAGE_CONTENT[templateName].articles.find((item) => item.slug === match[1]);
    if (!article) return null;
    return { contentType: 'image/svg+xml', body: createArtworkSvg(article.art, `${templateName}:${article.slug}`) };
}

export function getCamouflageRuntime() {
    return {
        classSuffix: CLASS_SUFFIX,
        templates: [...CAMOUFLAGE_TEMPLATE_IDS],
    };
}

export function applyCamouflageResponseHeaders(res: Response, cacheControl: string = CAMOUFLAGE_RESPONSE_CACHE_CONTROL): Response {
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Content-Security-Policy', CAMOUFLAGE_CONTENT_SECURITY_POLICY);
    // Drop headers that would identify an application rather than a static site.
    for (const header of ['X-Powered-By', 'X-Request-Id', 'Access-Control-Allow-Credentials', 'Access-Control-Allow-Origin', 'Vary']) {
        res.removeHeader(header);
    }
    return res;
}

export interface CamouflageAssetMiddlewareOptions {
    getSiteConfig?: () => any;
}

export function createCamouflageAssetMiddleware({
    getSiteConfig = () => ({}),
}: CamouflageAssetMiddlewareOptions = {}) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const siteConfig = getSiteConfig() || {};
        if (siteConfig.camouflageEnabled !== true) {
            return next();
        }

        const method = String(req.method || 'GET').toUpperCase();
        if (!['GET', 'HEAD'].includes(method)) {
            return next();
        }

        const asset = resolveCamouflageAsset(siteConfig, String(req.path || ''));
        if (!asset) {
            return next();
        }

        applyCamouflageResponseHeaders(res);
        res.status(200).type(asset.contentType).send(asset.body);
    };
}
