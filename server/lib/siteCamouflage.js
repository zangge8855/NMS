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
export const CAMOUFLAGE_TEMPLATE_IDS = Object.freeze(['corporate', 'nginx', 'blog']);
export const CAMOUFLAGE_RESPONSE_CACHE_CONTROL = 'public, max-age=86400';
const FALLBACK_CLASS_TOKENS = [
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
const CAMOUFLAGE_ASSET_ROUTE_PREFIX = '/media';
const CAMOUFLAGE_FILE_ASSET_SPECS = Object.freeze({
    corporate: Object.freeze({
        heroImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/industrial/facility-overview.png`,
            file: 'assets/corporate/2026-03-15-18-40-corporate-hero.png',
            fallback: 'heroTexture',
        }),
        inspectionImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/industrial/inspection-line.png`,
            file: 'assets/corporate/2026-03-15-18-46-corporate-inspection.png',
            fallback: 'inspectionImage',
        }),
        telemetryImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/industrial/operations-wall.png`,
            file: 'assets/corporate/2026-03-15-18-56-corporate-ops-wall.png',
            fallback: 'telemetryImage',
        }),
        operationsImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/industrial/control-room.png`,
            file: 'assets/corporate/2026-03-15-18-45-corporate-control-room.png',
            fallback: 'telemetryImage',
        }),
        machineVisionImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/industrial/machine-vision-cell.png`,
            file: 'assets/corporate/2026-03-15-18-57-corporate-machine-vision.png',
            fallback: 'inspectionImage',
        }),
        corridorImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/industrial/edge-corridor.png`,
            file: 'assets/corporate/2026-03-15-18-55-corporate-edge-corridor.png',
            fallback: 'telemetryImage',
        }),
    }),
    blog: Object.freeze({
        heroImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/editorial-hero.png`,
            file: 'assets/blog/2026-03-15-18-41-blog-hero.png',
            fallback: 'heroTexture',
        }),
        blogHeroImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/editorial-hero.png`,
            file: 'assets/blog/2026-03-15-18-41-blog-hero.png',
            fallback: 'heroTexture',
        }),
        inspectionImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/editorial-desk.png`,
            file: 'assets/blog/2026-03-15-18-47-blog-desk-editorial.png',
            fallback: 'inspectionImage',
        }),
        editorialDeskImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/editorial-desk.png`,
            file: 'assets/blog/2026-03-15-18-47-blog-desk-editorial.png',
            fallback: 'inspectionImage',
        }),
        engineerFeatureImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/engineer-feature.png`,
            file: 'assets/blog/2026-03-15-18-48-blog-engineer-feature.png',
            fallback: 'inspectionImage',
        }),
        telemetryImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/plant-walkthrough.png`,
            file: 'assets/blog/2026-03-15-18-59-blog-plant-walkthrough.png',
            fallback: 'telemetryImage',
        }),
        plantWalkthroughImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/plant-walkthrough.png`,
            file: 'assets/blog/2026-03-15-18-59-blog-plant-walkthrough.png',
            fallback: 'telemetryImage',
        }),
        caseStudyDeskImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/case-study-desk.png`,
            file: 'assets/blog/2026-03-15-18-58-blog-case-study-desk.png',
            fallback: 'inspectionImage',
        }),
        researchNotesImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/journal/research-notes.png`,
            file: 'assets/blog/2026-03-15-19-00-blog-research-notes.png',
            fallback: 'inspectionImage',
        }),
    }),
    nginx: Object.freeze({
        supportHeroImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/service/operations-center.png`,
            file: 'assets/support/2026-03-15-18-42-support-hero.png',
            fallback: 'telemetryImage',
        }),
        opsDeskImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/service/ops-desk.png`,
            file: 'assets/support/2026-03-15-18-49-support-ops-desk.png',
            fallback: 'telemetryImage',
        }),
        networkRackImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/service/network-rack.png`,
            file: 'assets/support/2026-03-15-18-50-support-network-rack.png',
            fallback: 'telemetryImage',
        }),
        helpdeskImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/service/helpdesk-console.png`,
            file: 'assets/support/2026-03-15-19-01-support-helpdesk.png',
            fallback: 'telemetryImage',
        }),
        docsDownloadsImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/service/docs-library.png`,
            file: 'assets/support/2026-03-15-19-02-support-docs-downloads.png',
            fallback: 'telemetryImage',
        }),
        maintenanceRackImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/service/maintenance-rack.png`,
            file: 'assets/support/2026-03-15-19-03-support-maintenance-rack.png',
            fallback: 'telemetryImage',
        }),
        inspectionImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/service/operations-center.png`,
            file: 'assets/support/2026-03-15-18-42-support-hero.png',
            fallback: 'inspectionImage',
        }),
        telemetryImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/service/helpdesk-console.png`,
            file: 'assets/support/2026-03-15-19-01-support-helpdesk.png',
            fallback: 'telemetryImage',
        }),
    }),
});

function collectClassTokens() {
    const tokens = new Set(FALLBACK_CLASS_TOKENS);
    for (const templateName of CAMOUFLAGE_TEMPLATE_IDS) {
        const file = path.join(CAMOUFLAGE_VIEW_DIR, `${templateName}.html`);
        let source = '';
        try {
            source = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const match of source.matchAll(/\{\{\s*class:([a-zA-Z0-9_-]+)\s*\}\}/g)) {
            tokens.add(match[1]);
        }
    }
    return [...tokens];
}

const CLASS_TOKENS = Object.freeze(collectClassTokens());

const CLASS_MAP = Object.freeze(Object.fromEntries(
    CLASS_TOKENS.map((token) => [token, `${token}-${CLASS_SUFFIX}`])
));

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

function buildCamouflageFileAssets() {
    const templates = {};
    const routes = new Map();

    for (const [templateName, entries] of Object.entries(CAMOUFLAGE_FILE_ASSET_SPECS)) {
        templates[templateName] = {};
        for (const [assetKey, entry] of Object.entries(entries)) {
            const absoluteFile = path.join(CAMOUFLAGE_VIEW_DIR, entry.file);
            const assetEntry = Object.freeze({
                assetKey,
                templateName,
                absoluteFile,
                publicPath: entry.publicPath,
                fallback: entry.fallback || '',
                exists: fs.existsSync(absoluteFile),
            });
            templates[templateName][assetKey] = assetEntry;
            routes.set(assetEntry.publicPath, assetEntry);
        }
        templates[templateName] = Object.freeze(templates[templateName]);
    }

    return Object.freeze({
        templates: Object.freeze(templates),
        routes,
    });
}

const CAMOUFLAGE_FILE_ASSETS = buildCamouflageFileAssets();

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
        favicon: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
                <defs>
                    <linearGradient id="fav" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stop-color="#38bdf8"/>
                        <stop offset="100%" stop-color="#34d399"/>
                    </linearGradient>
                </defs>
                <rect width="64" height="64" rx="18" fill="#08111f"/>
                <rect x="8" y="8" width="48" height="48" rx="14" fill="url(#fav)" fill-opacity="0.18" stroke="rgba(255,255,255,0.18)"/>
                <rect x="16" y="20" width="30" height="8" rx="4" fill="#d7f7ff"/>
                <rect x="24" y="34" width="16" height="8" rx="4" fill="#7dd3fc"/>
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

function createTemplateAssets(templateName, title) {
    const assets = createInlineAssets(title);
    const templateAssets = CAMOUFLAGE_FILE_ASSETS.templates[normalizeTemplate(templateName)] || {};

    for (const [assetKey, entry] of Object.entries(templateAssets)) {
        if (entry.exists) {
            assets[assetKey] = entry.publicPath;
            continue;
        }
        if (entry.fallback && assets[entry.fallback]) {
            assets[assetKey] = assets[entry.fallback];
        }
    }

    return assets;
}

function createRenderModel(options = {}) {
    const siteConfig = options.siteConfig && typeof options.siteConfig === 'object' ? options.siteConfig : {};
    const templateName = normalizeTemplate(siteConfig.camouflageTemplate || options.template);
    const title = normalizeTitle(siteConfig.camouflageTitle || options.title);
    const statusCode = Number.isInteger(options.statusCode) ? options.statusCode : 404;
    const requestPath = String(options.requestPath || '/').trim() || '/';
    const requestMethod = String(options.requestMethod || 'GET').trim().toUpperCase() || 'GET';
    const now = new Date();
    const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const statusLabelZh = '官方网站';
    const statusLabelEn = 'Official site';
    const directoryBadgeZh = '官方网站';
    const directoryBadgeEn = 'Official site';
    const accessNoteZh = statusCode === 200
        ? '欢迎浏览产品资料、行业方案与服务信息。'
        : '您访问的页面暂时不可用，请查看产品、方案或服务栏目。';
    const accessNoteEn = statusCode === 200
        ? 'Browse product details, industry solutions and service information on the official site.'
        : 'This page is temporarily unavailable. Continue through the product, solutions or service sections.';
    const archiveNoticeZh = statusCode === 200 ? '当前内容已发布在新闻中心。' : '该内容暂未在新闻中心发布，请查看最新动态。';
    const archiveNoticeEn = statusCode === 200 ? 'This content is published in the newsroom.' : 'This content is not currently published in the newsroom. Please review the latest updates.';
    const deliveryNoticeZh = statusCode === 200 ? '当前页面提供服务资料、下载说明与联络信息。' : '您访问的页面暂未开放，请查看服务与支持栏目。';
    const deliveryNoticeEn = statusCode === 200 ? 'This page provides service documents, download notes and contact information.' : 'This page is not currently available. Please continue through the service and support section.';
    const pageTitleZh = `${title} | ${statusLabelZh}`;
    const pageTitleEn = `${title} | ${statusLabelEn}`;
    const descriptionZh = `${title} 官方网站，提供公开页面与基础导航信息。`;
    const descriptionEn = `${title} official website with public pages and core navigation information.`;
    const generatedDateZh = `${year}年${month}月${day}日`;
    const generatedDateEn = `${monthNamesEn[now.getUTCMonth()]} ${Number(day)}, ${year}`;

    return {
        templateName,
        title,
        defaultLanguage: 'zh-CN',
        alternateLanguage: 'en-US',
        languageStorageKey: 'site_lang_pref',
        pageTitle: pageTitleZh,
        pageTitleZh,
        pageTitleEn,
        description: descriptionZh,
        descriptionZh,
        descriptionEn,
        requestPath,
        requestMethod,
        statusCode: String(statusCode),
        statusLabel: statusLabelZh,
        statusLabelZh,
        statusLabelEn,
        directoryBadgeZh,
        directoryBadgeEn,
        accessNoteZh,
        accessNoteEn,
        archiveNoticeZh,
        archiveNoticeEn,
        deliveryNoticeZh,
        deliveryNoticeEn,
        currentYear: String(now.getUTCFullYear()),
        generatedDateZh,
        generatedDateEn,
        generatedAt: now.toUTCString(),
        classes: CLASS_MAP,
        assets: createTemplateAssets(templateName, title),
    };
}

export function getCamouflageRuntime() {
    return {
        classSuffix: CLASS_SUFFIX,
        classes: { ...CLASS_MAP },
        templates: [...CAMOUFLAGE_TEMPLATE_IDS],
    };
}

export function getCamouflageAssetPublicPath(templateName, assetKey) {
    const templateAssets = CAMOUFLAGE_FILE_ASSETS.templates[normalizeTemplate(templateName)] || {};
    return templateAssets[assetKey]?.publicPath || '';
}

export function applyCamouflageResponseHeaders(res) {
    res.setHeader('Cache-Control', CAMOUFLAGE_RESPONSE_CACHE_CONTROL);
    res.removeHeader('X-Powered-By');
    return res;
}

export function createCamouflageAssetMiddleware({
    getSiteConfig = () => ({}),
} = {}) {
    return (req, res, next) => {
        const siteConfig = getSiteConfig() || {};
        if (siteConfig.camouflageEnabled !== true) {
            return next();
        }

        const method = String(req.method || 'GET').toUpperCase();
        if (!['GET', 'HEAD'].includes(method)) {
            return next();
        }

        const asset = CAMOUFLAGE_FILE_ASSETS.routes.get(String(req.path || ''));
        if (!asset || !asset.exists) {
            return next();
        }

        applyCamouflageResponseHeaders(res);
        return res.sendFile(asset.absoluteFile, (error) => {
            if (error) {
                next(error);
            }
        });
    };
}

export function createSiteCamouflageHtml(options = {}) {
    const model = createRenderModel(options);
    const source = loadTemplate(model.templateName);
    return renderTemplate(source, model);
}
