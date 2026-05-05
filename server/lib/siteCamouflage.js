import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMOUFLAGE_VIEW_DIR = path.resolve(__dirname, '..', 'views', 'camouflage');
const TEMPLATE_CACHE = new Map();
const DEFAULT_TEMPLATE = 'corporate';
const DEFAULT_TITLE = 'City Field Notes';
const CLASS_SUFFIX = crypto.randomBytes(5).toString('hex');
const LEGACY_TECH_TITLE_PATTERN = /\b(?:edge\s+precision\s+systems|edge\s+precision|precision\s+systems)\b/i;
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
    'hero-feature',
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
        coverImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/city-cover.svg`,
            file: 'assets/city/city-cover.svg',
            fallback: 'cityCoverImage',
        }),
        cafeImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/cafe-corner.svg`,
            file: 'assets/city/cafe-corner.svg',
            fallback: 'cafeImage',
        }),
        galleryImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/gallery-evening.svg`,
            file: 'assets/city/gallery-evening.svg',
            fallback: 'galleryImage',
        }),
        architectureImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/architecture-detail.svg`,
            file: 'assets/city/architecture-detail.svg',
            fallback: 'architectureImage',
        }),
        mapImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/weekend-map.svg`,
            file: 'assets/city/weekend-map.svg',
            fallback: 'mapImage',
        }),
        readingImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/reading-room.svg`,
            file: 'assets/city/reading-room.svg',
            fallback: 'readingImage',
        }),
    }),
    blog: Object.freeze({
        coverImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/photo-walk.svg`,
            file: 'assets/city/photo-walk.svg',
            fallback: 'cityCoverImage',
        }),
        blogHeroImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/photo-walk.svg`,
            file: 'assets/city/photo-walk.svg',
            fallback: 'cityCoverImage',
        }),
        cafeImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/cafe-corner.svg`,
            file: 'assets/city/cafe-corner.svg',
            fallback: 'cafeImage',
        }),
        editorialDeskImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/reading-room.svg`,
            file: 'assets/city/reading-room.svg',
            fallback: 'readingImage',
        }),
        galleryImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/gallery-evening.svg`,
            file: 'assets/city/gallery-evening.svg',
            fallback: 'galleryImage',
        }),
        architectureImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/architecture-detail.svg`,
            file: 'assets/city/architecture-detail.svg',
            fallback: 'architectureImage',
        }),
        mapImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/weekend-map.svg`,
            file: 'assets/city/weekend-map.svg',
            fallback: 'mapImage',
        }),
        readingImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/reading-room.svg`,
            file: 'assets/city/reading-room.svg',
            fallback: 'readingImage',
        }),
    }),
    nginx: Object.freeze({
        coverImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/weekend-cover.svg`,
            file: 'assets/city/weekend-cover.svg',
            fallback: 'cityCoverImage',
        }),
        supportHeroImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/weekend-cover.svg`,
            file: 'assets/city/weekend-cover.svg',
            fallback: 'cityCoverImage',
        }),
        cafeImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/cafe-corner.svg`,
            file: 'assets/city/cafe-corner.svg',
            fallback: 'cafeImage',
        }),
        galleryImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/gallery-evening.svg`,
            file: 'assets/city/gallery-evening.svg',
            fallback: 'galleryImage',
        }),
        architectureImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/architecture-detail.svg`,
            file: 'assets/city/architecture-detail.svg',
            fallback: 'architectureImage',
        }),
        mapImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/weekend-map.svg`,
            file: 'assets/city/weekend-map.svg',
            fallback: 'mapImage',
        }),
        readingImage: Object.freeze({
            publicPath: `${CAMOUFLAGE_ASSET_ROUTE_PREFIX}/city/reading-room.svg`,
            file: 'assets/city/reading-room.svg',
            fallback: 'readingImage',
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
    CLASS_TOKENS.map((name) => [name, `${name}-${CLASS_SUFFIX}`])
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
    if (LEGACY_TECH_TITLE_PATTERN.test(collapsed)) return DEFAULT_TITLE;
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
                <rect width="180" height="180" fill="#f7f1e8"/>
                <g stroke="rgba(45,34,26,0.08)" stroke-width="1">
                    <path d="M0 36H180M0 90H180M0 144H180"/>
                    <path d="M36 0V180M90 0V180M144 0V180"/>
                </g>
                <circle cx="36" cy="36" r="2" fill="rgba(45,34,26,0.1)"/>
                <circle cx="144" cy="144" r="2" fill="rgba(45,34,26,0.1)"/>
            </svg>
        `),
        heroTexture: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
                <defs>
                    <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="#f8d9a0"/>
                        <stop offset="48%" stop-color="#d9806d"/>
                        <stop offset="100%" stop-color="#263246"/>
                    </linearGradient>
                </defs>
                <rect width="1200" height="720" fill="url(#sky)"/>
                <circle cx="940" cy="146" r="84" fill="#fff3c4" fill-opacity="0.88"/>
                <path d="M0 540c150-34 285-27 405 21 119 48 236 35 352-38 134-85 282-82 443 8v189H0z" fill="#172133" fill-opacity="0.78"/>
                <g fill="#24324a">
                    <rect x="80" y="250" width="118" height="318"/>
                    <rect x="232" y="196" width="152" height="372"/>
                    <rect x="430" y="282" width="88" height="286"/>
                    <rect x="548" y="224" width="164" height="344"/>
                    <rect x="752" y="178" width="138" height="390"/>
                    <rect x="922" y="268" width="184" height="300"/>
                </g>
                <g fill="#fff6df" opacity="0.58">
                    <rect x="112" y="284" width="28" height="46" rx="4"/><rect x="158" y="284" width="28" height="46" rx="4"/>
                    <rect x="262" y="232" width="32" height="54" rx="4"/><rect x="318" y="232" width="32" height="54" rx="4"/>
                    <rect x="584" y="258" width="34" height="58" rx="4"/><rect x="642" y="258" width="34" height="58" rx="4"/>
                    <rect x="782" y="214" width="30" height="52" rx="4"/><rect x="836" y="214" width="30" height="52" rx="4"/>
                </g>
                <text x="84" y="116" fill="rgba(255,255,255,0.88)" font-size="34" font-family="Georgia, serif">${safeTitle}</text>
            </svg>
        `),
        cityCoverImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900" viewBox="0 0 1400 900">
                <defs>
                    <linearGradient id="a" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#f8d9a0"/><stop offset="47%" stop-color="#d9806d"/><stop offset="100%" stop-color="#263246"/></linearGradient>
                    <linearGradient id="b" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#fff8e7" stop-opacity="0.75"/><stop offset="100%" stop-color="#2a3850" stop-opacity="0.48"/></linearGradient>
                </defs>
                <rect width="1400" height="900" fill="url(#a)"/>
                <circle cx="1080" cy="170" r="105" fill="#fff2bd" opacity="0.86"/>
                <path d="M0 665c150-36 285-34 404 7 128 44 242 33 353-30 132-75 278-74 438 0 71 33 139 47 205 43v215H0z" fill="#1d2838" opacity="0.86"/>
                <g fill="#24324a"><rect x="74" y="314" width="146" height="380"/><rect x="260" y="240" width="198" height="454"/><rect x="500" y="356" width="126" height="338"/><rect x="670" y="286" width="218" height="408"/><rect x="928" y="224" width="166" height="470"/><rect x="1134" y="330" width="194" height="364"/></g>
                <g fill="url(#b)"><rect x="112" y="356" width="36" height="62" rx="4"/><rect x="168" y="356" width="36" height="62" rx="4"/><rect x="302" y="292" width="42" height="72" rx="4"/><rect x="374" y="292" width="42" height="72" rx="4"/><rect x="716" y="334" width="46" height="78" rx="4"/><rect x="796" y="334" width="46" height="78" rx="4"/><rect x="972" y="274" width="40" height="70" rx="4"/><rect x="1038" y="274" width="40" height="70" rx="4"/></g>
            </svg>
        `),
        dotTexture: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
                <rect width="160" height="160" fill="none"/>
                <g fill="rgba(41,32,25,0.16)">
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
                        <stop offset="0%" stop-color="#f2bf7d"/>
                        <stop offset="100%" stop-color="#d96f5f"/>
                    </linearGradient>
                </defs>
                <rect width="64" height="64" rx="18" fill="#2b211a"/>
                <rect x="9" y="9" width="46" height="46" rx="14" fill="url(#fav)"/>
                <path d="M21 42V22h6l5 11 5-11h6v20h-6V32l-4 8h-3l-4-8v10z" fill="#fff9ed"/>
            </svg>
        `),
        cafeImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <defs>
                    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stop-color="#f7dfbd"/>
                        <stop offset="100%" stop-color="#ab6f4e"/>
                    </linearGradient>
                </defs>
                <rect width="960" height="640" rx="28" fill="url(#bg)"/>
                <rect x="92" y="96" width="776" height="404" rx="36" fill="#fff6e8" opacity="0.68"/>
                <rect x="128" y="142" width="708" height="92" rx="24" fill="#5b3729" opacity="0.84"/>
                <rect x="154" y="278" width="250" height="150" rx="24" fill="#f3c796"/>
                <circle cx="566" cy="355" r="82" fill="#f1b56f"/>
                <circle cx="566" cy="355" r="48" fill="#7b4630"/>
                <path d="M642 350c76-18 108 18 88 58-18 36-78 34-104-5" fill="none" stroke="#7b4630" stroke-width="24" stroke-linecap="round"/>
                <rect x="132" y="505" width="696" height="32" rx="16" fill="#5b3729" opacity="0.4"/>
            </svg>
        `),
        galleryImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <defs>
                    <linearGradient id="bg2" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stop-color="#1d2430"/>
                        <stop offset="100%" stop-color="#5f4951"/>
                    </linearGradient>
                </defs>
                <rect width="960" height="640" rx="28" fill="url(#bg2)"/>
                <rect x="88" y="92" width="784" height="430" rx="34" fill="#f7efe4" opacity="0.14"/>
                <rect x="136" y="144" width="190" height="260" rx="8" fill="#f3d6a4"/>
                <rect x="386" y="120" width="210" height="310" rx="8" fill="#b7c2c9"/>
                <rect x="656" y="164" width="166" height="224" rx="8" fill="#e3a077"/>
                <circle cx="230" cy="272" r="54" fill="#86513d" opacity="0.7"/>
                <path d="M432 348c44-94 96-116 150-24" stroke="#4c6471" stroke-width="22" fill="none" stroke-linecap="round"/>
                <path d="M692 320c34-56 66-62 96-16" stroke="#764338" stroke-width="20" fill="none" stroke-linecap="round"/>
                <rect x="124" y="466" width="710" height="20" rx="10" fill="#fff7ea" opacity="0.2"/>
            </svg>
        `),
        architectureImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <rect width="960" height="640" rx="28" fill="#e8d7c2"/>
                <g fill="#7b6a5a"><rect x="128" y="118" width="704" height="88" rx="6"/><rect x="156" y="238" width="88" height="282" rx="42"/><rect x="296" y="238" width="88" height="282" rx="42"/><rect x="436" y="238" width="88" height="282" rx="42"/><rect x="576" y="238" width="88" height="282" rx="42"/><rect x="716" y="238" width="88" height="282" rx="42"/><rect x="102" y="532" width="756" height="42" rx="10"/></g>
                <g fill="#fff7ea" opacity="0.62"><circle cx="200" cy="272" r="26"/><circle cx="340" cy="272" r="26"/><circle cx="480" cy="272" r="26"/><circle cx="620" cy="272" r="26"/><circle cx="760" cy="272" r="26"/></g>
            </svg>
        `),
        mapImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <rect width="960" height="640" rx="28" fill="#f5ead7"/>
                <path d="M120 178c126 44 226 44 300 0s176-40 306 12" fill="none" stroke="#c28f62" stroke-width="28" stroke-linecap="round"/>
                <path d="M182 456c116-102 223-144 322-126 117 21 192-12 274-104" fill="none" stroke="#455d6c" stroke-width="24" stroke-linecap="round"/>
                <path d="M126 304h704M246 108v426M462 90v470M686 126v396" stroke="#2f3c45" stroke-width="8" opacity="0.18"/>
                <circle cx="244" cy="180" r="26" fill="#d96f5f"/><circle cx="548" cy="336" r="26" fill="#d96f5f"/><circle cx="748" cy="232" r="26" fill="#d96f5f"/>
            </svg>
        `),
        readingImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <rect width="960" height="640" rx="28" fill="#efe0cc"/>
                <rect x="92" y="150" width="776" height="332" rx="34" fill="#c99364" opacity="0.55"/>
                <rect x="156" y="208" width="260" height="210" rx="18" fill="#fff8eb"/><rect x="434" y="208" width="260" height="210" rx="18" fill="#fff4df"/>
                <path d="M416 216c36 54 36 136 0 194M434 216c-36 54-36 136 0 194" stroke="#8b5c3f" stroke-width="10" fill="none" opacity="0.35"/>
                <rect x="184" y="242" width="174" height="14" rx="7" fill="#8b5c3f" opacity="0.35"/><rect x="184" y="282" width="194" height="14" rx="7" fill="#8b5c3f" opacity="0.25"/>
                <rect x="480" y="248" width="154" height="14" rx="7" fill="#8b5c3f" opacity="0.35"/><rect x="480" y="288" width="176" height="14" rx="7" fill="#8b5c3f" opacity="0.25"/>
                <circle cx="734" cy="320" r="64" fill="#6d4430"/><circle cx="734" cy="320" r="38" fill="#c99364"/>
            </svg>
        `),
        inspectionImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <rect width="960" height="640" rx="28" fill="#f2ddc4"/>
                <rect x="130" y="120" width="700" height="400" rx="30" fill="#fff6e7" opacity="0.74"/>
                <circle cx="300" cy="320" r="86" fill="#d96f5f" opacity="0.76"/><circle cx="500" cy="280" r="64" fill="#e2a463" opacity="0.72"/><circle cx="650" cy="352" r="96" fill="#455d6c" opacity="0.66"/>
            </svg>
        `),
        telemetryImage: createSvgDataUri(`
            <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
                <rect width="960" height="640" rx="28" fill="#263246"/>
                <circle cx="760" cy="160" r="86" fill="#f2bf7d" opacity="0.84"/>
                <path d="M0 480c138-44 270-42 396 8 126 49 247 42 362-22 68-38 135-55 202-50v224H0z" fill="#111827" opacity="0.44"/>
                <g fill="#f7e4c8" opacity="0.34"><rect x="112" y="210" width="80" height="252"/><rect x="230" y="160" width="120" height="302"/><rect x="392" y="248" width="88" height="214"/><rect x="522" y="196" width="136" height="266"/></g>
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
    const monthIndex = now.getUTCMonth();
    const seasonIndex = Math.floor(((monthIndex + 1) % 12) / 3);
    const seasonNamesZh = ['冬季', '春季', '夏季', '秋季'];
    const seasonNamesEn = ['Winter', 'Spring', 'Summer', 'Autumn'];
    const seasonLabelZh = `${year} ${seasonNamesZh[seasonIndex]}`;
    const seasonLabelEn = `${seasonNamesEn[seasonIndex]} ${year}`;
    const editionCode = `${year}.${month}`;
    let statusLabelZh = '城市生活';
    let statusLabelEn = 'City magazine';
    let directoryBadgeZh = '城市周刊';
    let directoryBadgeEn = 'City weekly';
    let descriptionZh = `${title} 城市生活、街区漫游与周末灵感。`;
    let descriptionEn = `${title} city life, neighborhood walks, and weekend ideas.`;

    if (templateName === 'blog') {
        statusLabelZh = '影像笔记';
        statusLabelEn = 'Photo notes';
        directoryBadgeZh = '街头影像';
        directoryBadgeEn = 'Street photos';
        descriptionZh = `${title} 城市影像、日常观察与短篇手记。`;
        descriptionEn = `${title} city photographs, everyday observations, and short notes.`;
    } else if (templateName === 'nginx') {
        statusLabelZh = '周末指南';
        statusLabelEn = 'Weekend guide';
        directoryBadgeZh = '本地活动';
        directoryBadgeEn = 'Local picks';
        descriptionZh = `${title} 周末路线、展览、市集与咖啡馆灵感。`;
        descriptionEn = `${title} weekend routes, exhibitions, markets, and cafes.`;
    }

    const accessNoteZh = statusCode === 200
        ? '本期内容已经整理完成。'
        : '这篇页面暂未收录。';
    const accessNoteEn = statusCode === 200
        ? 'This edition is ready to read.'
        : 'This page is not in the current issue.';
    const archiveNoticeZh = statusCode === 200 ? '往期文章按月份归档。' : '可以回到首页继续浏览本期内容。';
    const archiveNoticeEn = statusCode === 200 ? 'Past stories are archived by month.' : 'Return home to keep reading the current issue.';
    const deliveryNoticeZh = '下一期内容会在月末更新。';
    const deliveryNoticeEn = 'The next issue arrives near the end of the month.';
    const companyExperienceYears = '12';
    const serviceRegionZh = '城市';
    const serviceRegionEn = 'City';
    const contactPhone = '';
    const contactEmail = 'hello@cityfieldnotes.example';
    const trustTextZh = `连续 ${companyExperienceYears} 期记录城市日常`;
    const trustTextEn = `${companyExperienceYears} issues of everyday city notes`;
    const companyFootnoteZh = `${title} · 城市生活杂志`;
    const companyFootnoteEn = `${title} · City life magazine`;
    const pageTitleZh = `${title} | ${statusLabelZh}`;
    const pageTitleEn = `${title} | ${statusLabelEn}`;
    const generatedDateZh = `${year}年${month}月${day}日`;
    const generatedDateEn = `${monthNamesEn[now.getUTCMonth()]} ${Number(day)}, ${year}`;

    return {
        templateName,
        title,
        defaultLanguage: 'zh-CN',
        alternateLanguage: 'en-US',
        languageStorageKey: 'city_lang_pref',
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
        seasonLabelZh,
        seasonLabelEn,
        editionCode,
        accessNoteZh,
        accessNoteEn,
        archiveNoticeZh,
        archiveNoticeEn,
        deliveryNoticeZh,
        deliveryNoticeEn,
        companyExperienceYears,
        serviceRegionZh,
        serviceRegionEn,
        contactPhone,
        contactEmail,
        trustTextZh,
        trustTextEn,
        companyFootnoteZh,
        companyFootnoteEn,
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
