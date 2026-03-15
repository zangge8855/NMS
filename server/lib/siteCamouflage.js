import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMOUFLAGE_VIEW_DIR = path.resolve(__dirname, '..', 'views', 'camouflage');
const TEMPLATE_CACHE = new Map();
const DEFAULT_TEMPLATE = 'corporate';
const DEFAULT_TITLE = 'Edge Precision Systems';
const CLASS_SUFFIX = crypto.randomBytes(5).toString('hex');
const CLASS_TOKENS = [
    'page',
    'site-nav',
    'brand',
    'brand-mark',
    'brand-copy',
    'nav-links',
    'nav-link',
    'nav-chip',
    'hero',
    'hero-panel',
    'hero-copy',
    'eyebrow',
    'headline',
    'lead',
    'button-row',
    'button',
    'button-muted',
    'lang-switch',
    'lang-button',
    'meta-grid',
    'meta-card',
    'meta-label',
    'meta-value',
    'section-grid',
    'section-card',
    'card-title',
    'card-copy',
    'list',
    'status-strip',
    'status-item',
    'status-label',
    'status-value',
    'footer',
    'footer-note',
    'blog-list',
    'blog-item',
    'blog-meta',
    'terminal',
    'terminal-line',
    'notice',
    'inline-code',
    'stack',
    'grid-two',
    'image-frame',
    'hero-image',
    'muted',
];

const CLASS_MAP = Object.freeze(Object.fromEntries(
    CLASS_TOKENS.map((token) => [token, `${token}-${CLASS_SUFFIX}`])
));

export const CAMOUFLAGE_TEMPLATE_IDS = Object.freeze(['corporate', 'nginx', 'blog']);
export const CAMOUFLAGE_RESPONSE_CACHE_CONTROL = 'public, max-age=86400';

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function createSvgDataUri(svg) {
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function normalizeTemplate(value, fallback = DEFAULT_TEMPLATE) {
    const candidate = String(value || '').trim().toLowerCase();
    return CAMOUFLAGE_TEMPLATE_IDS.includes(candidate) ? candidate : fallback;
}

function normalizeTitle(value, fallback = DEFAULT_TITLE) {
    const collapsed = String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!collapsed) return fallback;
    return collapsed.slice(0, 96);
}

function loadTemplate(templateName) {
    const normalized = normalizeTemplate(templateName);
    if (TEMPLATE_CACHE.has(normalized)) {
        return TEMPLATE_CACHE.get(normalized);
    }

    const file = path.join(CAMOUFLAGE_VIEW_DIR, `${normalized}.html`);
    let source;
    try {
        source = fs.readFileSync(file, 'utf8');
    } catch (error) {
        if (normalized !== DEFAULT_TEMPLATE) {
            return loadTemplate(DEFAULT_TEMPLATE);
        }
        throw error;
    }

    TEMPLATE_CACHE.set(normalized, source);
    return source;
}

function renderTemplate(source, data) {
    return source.replace(/\{\{\s*(?:(class|asset):([a-zA-Z0-9_-]+)|([a-zA-Z0-9_-]+))\s*\}\}/g, (_match, kind, namedKey, simpleKey) => {
        if (kind === 'class') {
            return data.classes[namedKey] || namedKey;
        }
        if (kind === 'asset') {
            return data.assets[namedKey] || '';
        }
        return escapeHtml(data[simpleKey] ?? '');
    });
}

function createInlineAssets(title) {
    const safeTitle = escapeHtml(title);
    return {
        gridTexture: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
                <rect width="180" height="180" fill="#07111f"/>
                <g stroke="rgba(255,255,255,0.06)" stroke-width="1">
                    <path d="M0 30H180M0 90H180M0 150H180"/>
                    <path d="M30 0V180M90 0V180M150 0V180"/>
                </g>
            </svg>
        `),
        heroTexture: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
                <defs>
                    <linearGradient id="a" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stop-color="#071525"/>
                        <stop offset="100%" stop-color="#0d2b44"/>
                    </linearGradient>
                    <linearGradient id="b" x1="0" x2="1" y1="1" y2="0">
                        <stop offset="0%" stop-color="#16a34a" stop-opacity="0.22"/>
                        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.26"/>
                    </linearGradient>
                </defs>
                <rect width="1200" height="720" fill="url(#a)"/>
                <circle cx="220" cy="170" r="180" fill="#38bdf8" fill-opacity="0.14"/>
                <circle cx="960" cy="160" r="220" fill="#16a34a" fill-opacity="0.12"/>
                <circle cx="880" cy="540" r="280" fill="url(#b)"/>
                <g stroke="rgba(255,255,255,0.18)" stroke-width="2" fill="none">
                    <path d="M120 560C250 400 380 340 520 360S780 470 980 360"/>
                    <path d="M180 610C330 450 500 410 670 452S930 590 1080 520" stroke-opacity="0.6"/>
                </g>
                <g fill="rgba(255,255,255,0.82)" font-family="Arial, Helvetica, sans-serif">
                    <text x="96" y="112" font-size="24" letter-spacing="3">${safeTitle}</text>
                    <text x="96" y="148" font-size="13" opacity="0.72">EDGE SYSTEMS . INDUSTRIAL SIGNAL . FIELD OPERATIONS</text>
                </g>
            </svg>
        `),
        dotTexture: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
                <rect width="160" height="160" fill="none"/>
                <g fill="rgba(255,255,255,0.18)">
                    <circle cx="18" cy="18" r="2.2"/>
                    <circle cx="80" cy="18" r="2.2"/>
                    <circle cx="142" cy="18" r="2.2"/>
                    <circle cx="49" cy="80" r="2.2"/>
                    <circle cx="111" cy="80" r="2.2"/>
                    <circle cx="18" cy="142" r="2.2"/>
                    <circle cx="80" cy="142" r="2.2"/>
                    <circle cx="142" cy="142" r="2.2"/>
                </g>
            </svg>
        `),
        inspectionImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <defs>
                    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stop-color="#08111f"/>
                        <stop offset="100%" stop-color="#143454"/>
                    </linearGradient>
                    <linearGradient id="rack" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stop-color="#0f172a"/>
                        <stop offset="100%" stop-color="#1e293b"/>
                    </linearGradient>
                </defs>
                <rect width="960" height="640" rx="28" fill="url(#bg)"/>
                <circle cx="170" cy="118" r="120" fill="#38bdf8" fill-opacity="0.16"/>
                <circle cx="810" cy="110" r="126" fill="#34d399" fill-opacity="0.12"/>
                <rect x="104" y="180" width="290" height="240" rx="24" fill="url(#rack)" stroke="rgba(255,255,255,0.14)"/>
                <rect x="142" y="220" width="210" height="54" rx="12" fill="#0b1220" stroke="rgba(56,189,248,0.34)"/>
                <rect x="142" y="302" width="210" height="34" rx="10" fill="rgba(255,255,255,0.08)"/>
                <rect x="142" y="350" width="210" height="34" rx="10" fill="rgba(255,255,255,0.08)"/>
                <circle cx="470" cy="232" r="56" fill="#0f172a" stroke="rgba(255,255,255,0.14)"/>
                <circle cx="470" cy="232" r="22" fill="#38bdf8"/>
                <path d="M470 288v108" stroke="rgba(255,255,255,0.26)" stroke-width="8" stroke-linecap="round"/>
                <path d="M470 312c44 0 80 36 80 80" stroke="rgba(56,189,248,0.34)" stroke-width="8" fill="none" stroke-linecap="round"/>
                <path d="M470 312c-44 0-80 36-80 80" stroke="rgba(52,211,153,0.28)" stroke-width="8" fill="none" stroke-linecap="round"/>
                <rect x="604" y="172" width="214" height="292" rx="24" fill="url(#rack)" stroke="rgba(255,255,255,0.14)"/>
                <rect x="640" y="214" width="144" height="126" rx="18" fill="#0b1220" stroke="rgba(52,211,153,0.28)"/>
                <path d="M660 318l20-32 32 24 28-48 24 18" stroke="#7dd3fc" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <rect x="644" y="368" width="134" height="18" rx="9" fill="rgba(255,255,255,0.1)"/>
                <rect x="644" y="400" width="96" height="18" rx="9" fill="rgba(255,255,255,0.1)"/>
                <text x="106" y="530" fill="rgba(255,255,255,0.82)" font-size="24" font-family="Arial, Helvetica, sans-serif">${safeTitle}</text>
                <text x="106" y="564" fill="rgba(255,255,255,0.58)" font-size="14" font-family="Arial, Helvetica, sans-serif">machine vision inspection / edge appliance / local telemetry</text>
            </svg>
        `),
        telemetryImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <defs>
                    <linearGradient id="bg2" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stop-color="#091524"/>
                        <stop offset="100%" stop-color="#102b45"/>
                    </linearGradient>
                </defs>
                <rect width="960" height="640" rx="28" fill="url(#bg2)"/>
                <rect x="84" y="126" width="792" height="360" rx="28" fill="rgba(9,18,32,0.78)" stroke="rgba(255,255,255,0.12)"/>
                <rect x="126" y="170" width="318" height="182" rx="20" fill="#0b1220" stroke="rgba(56,189,248,0.28)"/>
                <rect x="486" y="170" width="318" height="182" rx="20" fill="#0b1220" stroke="rgba(52,211,153,0.28)"/>
                <path d="M156 312c26-58 56-88 96-88s68 26 94 74 44 58 74 58" stroke="#38bdf8" stroke-width="10" fill="none" stroke-linecap="round"/>
                <path d="M514 314c34-28 72-44 114-44 44 0 82 16 116 46" stroke="#34d399" stroke-width="10" fill="none" stroke-linecap="round"/>
                <circle cx="208" cy="252" r="18" fill="#38bdf8"/>
                <circle cx="602" cy="252" r="18" fill="#34d399"/>
                <rect x="164" y="392" width="632" height="46" rx="16" fill="rgba(255,255,255,0.08)"/>
                <rect x="164" y="456" width="418" height="22" rx="11" fill="rgba(255,255,255,0.08)"/>
                <rect x="600" y="456" width="196" height="22" rx="11" fill="rgba(255,255,255,0.08)"/>
                <g fill="rgba(255,255,255,0.82)" font-family="Arial, Helvetica, sans-serif">
                    <text x="90" y="84" font-size="26">${safeTitle}</text>
                    <text x="90" y="112" font-size="14" opacity="0.62">telemetry wall / regional support / operations visibility</text>
                </g>
            </svg>
        `),
    };
}

function createRenderModel(options = {}) {
    const siteConfig = options.siteConfig && typeof options.siteConfig === 'object' ? options.siteConfig : {};
    const templateName = normalizeTemplate(siteConfig.camouflageTemplate || options.template);
    const title = normalizeTitle(siteConfig.camouflageTitle || options.title);
    const statusCode = Number.isInteger(options.statusCode) ? options.statusCode : 404;
    const requestPath = String(options.requestPath || '/').trim() || '/';
    const requestMethod = String(options.requestMethod || 'GET').trim().toUpperCase() || 'GET';
    const now = new Date();
    const statusLabel = statusCode === 200 ? 'Service directory' : 'Resource not published';

    return {
        templateName,
        title,
        pageTitle: `${title} | ${statusLabel}`,
        description: `${title} operates industrial edge systems, inspection devices and field telemetry services for research and manufacturing environments.`,
        requestPath,
        requestMethod,
        statusCode: String(statusCode),
        statusLabel,
        currentYear: String(now.getUTCFullYear()),
        generatedAt: now.toUTCString(),
        classes: CLASS_MAP,
        assets: createInlineAssets(title),
    };
}

export function getCamouflageRuntime() {
    return {
        classSuffix: CLASS_SUFFIX,
        classes: { ...CLASS_MAP },
        templates: [...CAMOUFLAGE_TEMPLATE_IDS],
    };
}

export function applyCamouflageResponseHeaders(res) {
    res.setHeader('Cache-Control', CAMOUFLAGE_RESPONSE_CACHE_CONTROL);
    res.removeHeader('X-Powered-By');
    return res;
}

export function createSiteCamouflageHtml(options = {}) {
    const model = createRenderModel(options);
    const source = loadTemplate(model.templateName);
    return renderTemplate(source, model);
}
