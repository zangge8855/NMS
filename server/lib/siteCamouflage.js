const CAMOUFLAGE_HERO_IMAGE = 'https://images.pexels.com/photos/18471457/pexels-photo-18471457.jpeg?auto=compress&cs=tinysrgb&w=1600';
const CAMOUFLAGE_DETAIL_IMAGE = 'https://images.pexels.com/photos/6755059/pexels-photo-6755059.jpeg?auto=compress&cs=tinysrgb&w=1200';

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function createSiteCamouflageHtml() {
    return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>曜衡智能设备 | Edge Precision Systems</title>
    <meta name="description" content="曜衡智能设备专注边缘智能终端、工业视觉设备与数据采集平台，为先进制造与科研场景提供高可靠硬件系统。" />
    <style>
        :root {
            --bg: #07111f;
            --bg-soft: rgba(10, 26, 46, 0.84);
            --panel: rgba(9, 19, 34, 0.72);
            --panel-border: rgba(255, 255, 255, 0.10);
            --text: #f5f7fb;
            --text-muted: rgba(227, 233, 244, 0.72);
            --accent: #59c7ff;
            --accent-strong: #92e7ff;
            --success: #79f0c6;
            --shadow: 0 24px 80px rgba(2, 9, 20, 0.42);
            --radius-xl: 28px;
            --radius-lg: 20px;
        }

        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            font-family: "Segoe UI Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
            color: var(--text);
            background:
                radial-gradient(circle at 12% 18%, rgba(89, 199, 255, 0.18), transparent 34%),
                radial-gradient(circle at 84% 12%, rgba(121, 240, 198, 0.14), transparent 32%),
                linear-gradient(160deg, #06101c 0%, #0a1628 42%, #07111f 100%);
            min-height: 100vh;
        }

        body::before {
            content: "";
            position: fixed;
            inset: 0;
            background:
                linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
            background-size: 72px 72px;
            opacity: 0.18;
            pointer-events: none;
        }

        .shell {
            width: min(1200px, calc(100vw - 40px));
            margin: 0 auto;
            padding: 28px 0 44px;
            position: relative;
            z-index: 1;
        }

        .nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 28px;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 14px;
            min-width: 0;
        }

        .brand-mark {
            width: 48px;
            height: 48px;
            border-radius: 16px;
            background:
                linear-gradient(145deg, rgba(89, 199, 255, 0.24), rgba(121, 240, 198, 0.18)),
                rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.14);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
            position: relative;
        }

        .brand-mark::before,
        .brand-mark::after {
            content: "";
            position: absolute;
            border-radius: 999px;
            background: linear-gradient(90deg, var(--accent), var(--accent-strong));
        }

        .brand-mark::before { width: 26px; height: 6px; top: 14px; left: 11px; }
        .brand-mark::after { width: 18px; height: 6px; top: 28px; left: 19px; }

        .brand-copy { min-width: 0; }
        .brand-name { font-size: 18px; font-weight: 700; letter-spacing: 0.04em; }
        .brand-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .brand-sub strong { color: rgba(255, 255, 255, 0.94); font-weight: 600; }

        .nav-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: 999px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.10);
            color: var(--text-muted);
            font-size: 12px;
            white-space: nowrap;
        }

        .nav-links {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }

        .nav-link {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: 999px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            color: var(--text-muted);
            font-size: 12px;
            text-decoration: none;
            transition: transform 160ms ease, border-color 160ms ease, color 160ms ease;
        }

        .nav-link:hover {
            transform: translateY(-1px);
            color: var(--text);
            border-color: rgba(255,255,255,0.16);
        }

        .hero {
            display: grid;
            grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
            gap: 22px;
            align-items: stretch;
            margin-bottom: 22px;
        }

        .hero-main,
        .hero-side,
        .section-card,
        .footer-card {
            background: var(--panel);
            border: 1px solid var(--panel-border);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow);
            backdrop-filter: blur(16px);
            overflow: hidden;
        }

        .hero-main {
            position: relative;
            padding: 34px;
            min-height: 460px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background:
                linear-gradient(135deg, rgba(6, 17, 31, 0.72), rgba(7, 15, 27, 0.28)),
                url("${CAMOUFLAGE_HERO_IMAGE}") center/cover no-repeat;
        }

        .hero-main::after {
            content: "";
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(6, 17, 31, 0.08), rgba(6, 17, 31, 0.74));
            pointer-events: none;
        }

        .hero-content,
        .hero-metrics {
            position: relative;
            z-index: 1;
        }

        .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 7px 12px;
            border-radius: 999px;
            background: rgba(4, 14, 28, 0.52);
            border: 1px solid rgba(255,255,255,0.12);
            color: var(--accent-strong);
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 18px;
        }

        .hero-title {
            max-width: 13ch;
            font-size: clamp(38px, 5.2vw, 70px);
            line-height: 0.96;
            font-weight: 800;
            letter-spacing: -0.03em;
            margin: 0 0 16px;
        }

        .hero-title-en {
            max-width: 26ch;
            margin: 0 0 18px;
            color: rgba(244, 248, 255, 0.84);
            font-size: clamp(17px, 2vw, 24px);
            line-height: 1.45;
            font-weight: 500;
        }

        .hero-lead {
            max-width: 560px;
            margin: 0;
            color: rgba(242, 247, 255, 0.86);
            font-size: 16px;
            line-height: 1.75;
        }

        .hero-lead-en {
            max-width: 540px;
            margin: 12px 0 0;
            color: rgba(227, 233, 244, 0.68);
            font-size: 13px;
            line-height: 1.75;
        }

        .hero-metrics {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            margin-top: 28px;
        }

        .hero-actions {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            margin-top: 22px;
        }

        .hero-action {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px 18px;
            border-radius: 999px;
            text-decoration: none;
            transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.02em;
        }

        .hero-action-primary {
            color: #03111f;
            background: linear-gradient(135deg, #d7f7ff, #8fe5ff);
            box-shadow: 0 14px 34px rgba(89, 199, 255, 0.26);
        }

        .hero-action-secondary {
            color: var(--text);
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.10);
        }

        .hero-action:hover {
            transform: translateY(-2px);
        }

        .metric {
            padding: 16px 18px;
            border-radius: 18px;
            background: rgba(4, 14, 28, 0.58);
            border: 1px solid rgba(255,255,255,0.12);
        }

        .metric-value {
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.03em;
        }

        .metric-label {
            margin-top: 6px;
            color: var(--text-muted);
            font-size: 12px;
            line-height: 1.5;
        }

        .metric-label-en {
            display: block;
            margin-top: 4px;
            color: rgba(227, 233, 244, 0.56);
            font-size: 11px;
            line-height: 1.5;
        }

        .hero-side {
            padding: 24px;
            display: grid;
            grid-template-rows: auto auto 1fr;
            gap: 18px;
        }

        .hero-side-card {
            padding: 18px;
            border-radius: var(--radius-lg);
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
        }

        .hero-side-kicker {
            font-size: 12px;
            color: var(--accent-strong);
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 10px;
        }

        .hero-side-title {
            font-size: 22px;
            font-weight: 700;
            line-height: 1.3;
            margin: 0 0 10px;
        }

        .hero-side-title-en,
        .section-title-en {
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(227, 233, 244, 0.58);
            margin-bottom: 10px;
        }

        .hero-side-copy {
            margin: 0;
            color: var(--text-muted);
            line-height: 1.75;
            font-size: 14px;
        }

        .hero-side-copy-en,
        .section-copy-en {
            margin: 10px 0 0;
            color: rgba(227, 233, 244, 0.62);
            line-height: 1.75;
            font-size: 12px;
        }

        .hero-side-media {
            min-height: 180px;
            border-radius: var(--radius-lg);
            overflow: hidden;
            border: 1px solid rgba(255,255,255,0.08);
            background:
                linear-gradient(180deg, rgba(4, 14, 28, 0.18), rgba(4, 14, 28, 0.42)),
                url("${CAMOUFLAGE_DETAIL_IMAGE}") center/cover no-repeat;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 18px;
            margin-bottom: 18px;
        }

        .grid-two {
            display: grid;
            grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
            gap: 18px;
            margin-bottom: 18px;
        }

        .section-card {
            padding: 22px;
        }

        .section-kicker {
            color: var(--accent-strong);
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 10px;
        }

        .section-title {
            font-size: 20px;
            font-weight: 700;
            margin: 0 0 6px;
        }

        .section-copy {
            margin: 0;
            color: var(--text-muted);
            line-height: 1.7;
            font-size: 14px;
        }

        .capabilities {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
            margin-top: 18px;
        }

        .product-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
            margin-top: 18px;
        }

        .product-card {
            padding: 18px;
            border-radius: 18px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
        }

        .product-name {
            font-size: 17px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .product-tag {
            color: rgba(227, 233, 244, 0.58);
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 10px;
        }

        .pill-strip {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 18px;
        }

        .pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 9px 12px;
            border-radius: 999px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            color: rgba(244, 248, 255, 0.88);
            font-size: 12px;
        }

        .capability {
            padding: 16px 18px;
            border-radius: 18px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
        }

        .capability-title {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .footer-card {
            padding: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }

        .footer-copy {
            color: var(--text-muted);
            font-size: 13px;
            line-height: 1.7;
        }

        .footer-chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: 999px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            color: var(--text);
            white-space: nowrap;
        }

        .footer-chip strong { color: var(--success); }

        @media (max-width: 1024px) {
            .hero {
                grid-template-columns: 1fr;
            }

            .grid,
            .grid-two,
            .capabilities,
            .hero-metrics,
            .product-grid {
                grid-template-columns: 1fr;
            }
        }

        @media (max-width: 640px) {
            .shell {
                width: min(100vw - 24px, 100%);
                padding-top: 18px;
            }

            .nav,
            .footer-card {
                flex-direction: column;
                align-items: flex-start;
            }

            .nav-links {
                width: 100%;
            }

            .hero-main,
            .hero-side,
            .section-card,
            .footer-card {
                border-radius: 22px;
            }

            .hero-main {
                padding: 24px;
                min-height: 420px;
            }

            .hero-title {
                max-width: none;
                font-size: 38px;
            }
        }
    </style>
</head>
<body>
    <main class="shell">
        <div class="nav">
            <div class="brand">
                <div class="brand-mark" aria-hidden="true"></div>
                <div class="brand-copy">
                    <div class="brand-name">曜衡智能设备</div>
                    <div class="brand-sub"><strong>Edge Precision Systems</strong> · Advanced Hardware Lab</div>
                </div>
            </div>
            <div class="nav-links">
                <div class="nav-badge">CN / EN Corporate Landing</div>
                <a class="nav-link" href="#products">产品矩阵 Products</a>
                <a class="nav-link" href="#industries">行业方案 Industries</a>
                <a class="nav-link" href="#assurance">质量体系 Assurance</a>
            </div>
        </div>

        <section class="hero">
            <article class="hero-main">
                <div class="hero-content">
                    <div class="eyebrow">Industrial Edge Devices</div>
                    <h1 class="hero-title">面向高可靠场景的智能设备平台</h1>
                    <p class="hero-title-en">Advanced hardware systems for industrial edge computing, precision sensing, and mission-critical field operations.</p>
                    <p class="hero-lead">
                        曜衡智能设备聚焦边缘计算终端、工业视觉单元与数据采集设备，
                        为实验室、先进制造与智能检测场景提供一体化硬件系统。
                    </p>
                    <p class="hero-lead-en">
                        We design integrated edge devices, machine-vision units, and acquisition systems for advanced manufacturing, research facilities, and intelligent inspection environments.
                    </p>
                    <div class="hero-actions">
                        <a class="hero-action hero-action-primary" href="#products">查看产品矩阵 · Product Portfolio</a>
                        <a class="hero-action hero-action-secondary" href="#industries">了解行业方案 · Industry Solutions</a>
                    </div>
                </div>
                <div class="hero-metrics">
                    <div class="metric">
                        <div class="metric-value">24h</div>
                        <div class="metric-label">关键产线连续运维响应<span class="metric-label-en">Continuous response coverage for critical production lines</span></div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">99.95%</div>
                        <div class="metric-label">设备集群年度可用性目标<span class="metric-label-en">Annual availability target for managed device fleets</span></div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">3.8x</div>
                        <div class="metric-label">复杂检测任务边缘提速能力<span class="metric-label-en">Acceleration uplift for complex edge inspection workloads</span></div>
                    </div>
                </div>
            </article>

            <aside class="hero-side">
                <div class="hero-side-card">
                    <div class="hero-side-kicker">旗舰方案</div>
                    <h2 class="hero-side-title">Aurora Edge X7</h2>
                    <div class="hero-side-title-en">Flagship Integrated Platform</div>
                    <p class="hero-side-copy">
                        为工业视觉、实验自动化与多源数据采集场景提供模块化设备底座，
                        支持多协议接入、边缘决策与远程维护。
                    </p>
                    <p class="hero-side-copy-en">
                        A modular hardware foundation for machine vision, lab automation, and multi-source data capture with unified remote operations.
                    </p>
                </div>
                <div class="hero-side-card">
                    <div class="hero-side-kicker">交付模式</div>
                    <div class="hero-side-title-en">Deployment & Lifecycle</div>
                    <p class="hero-side-copy">
                        从样机验证、试产导入到多点部署，统一采用设备标准化与任务编排并行交付。
                    </p>
                    <p class="hero-side-copy-en">
                        From pilot validation to scaled rollout, delivery follows a standardized device and orchestration baseline.
                    </p>
                </div>
                <div class="hero-side-media" aria-hidden="true"></div>
            </aside>
        </section>

        <section class="grid" id="products">
            <article class="section-card">
                <div class="section-kicker">智能终端</div>
                <h3 class="section-title">边缘设备平台</h3>
                <div class="section-title-en">Edge Device Platform</div>
                <p class="section-copy">覆盖工控现场、实验台位与机柜级部署，统一管理采集、控制与分析链路。</p>
                <p class="section-copy-en">A unified platform for cabinet-grade deployments, industrial control sites, and research workbenches.</p>
            </article>
            <article class="section-card">
                <div class="section-kicker">工业检测</div>
                <h3 class="section-title">多模态视觉单元</h3>
                <div class="section-title-en">Multi-Modal Vision Units</div>
                <p class="section-copy">用于缺陷识别、尺寸量测与自动化检测站，支持连续运行和快速复核。</p>
                <p class="section-copy-en">Built for defect screening, dimensional measurement, and inspection cells with continuous duty cycles.</p>
            </article>
            <article class="section-card">
                <div class="section-kicker">场景交付</div>
                <h3 class="section-title">科研与制造双场景</h3>
                <div class="section-title-en">Research & Production Ready</div>
                <p class="section-copy">兼顾研发试验、数据标定与量产部署，降低从实验室到产线的切换成本。</p>
                <p class="section-copy-en">Designed to bridge prototype validation, calibration, and production deployment without rebuilding the stack.</p>
            </article>
        </section>

        <section class="section-card">
            <div class="section-kicker">产品矩阵</div>
            <h3 class="section-title">面向关键场景的三条产品线</h3>
            <div class="section-title-en">Three coordinated product families for high-reliability deployments</div>
            <div class="product-grid">
                <div class="product-card">
                    <div class="product-name">Aurora Edge X7</div>
                    <div class="product-tag">Integrated Edge Controller</div>
                    <div class="section-copy">面向边缘控制、数据采集与机柜级集成，适合实验自动化与工艺控制单元。</div>
                    <div class="section-copy-en">Built for integrated control, data capture, and cabinet-scale orchestration in lab and process environments.</div>
                </div>
                <div class="product-card">
                    <div class="product-name">Vector Vision R4</div>
                    <div class="product-tag">Machine Vision Appliance</div>
                    <div class="section-copy">服务于缺陷识别、尺寸测量与自动检测站，对连续运行和可复核性有更高要求的产线场景。</div>
                    <div class="section-copy-en">Optimized for inspection cells that require stable throughput, repeatability, and fast review loops.</div>
                </div>
                <div class="product-card">
                    <div class="product-name">Helios Capture H2</div>
                    <div class="product-tag">Industrial Data Hub</div>
                    <div class="section-copy">聚焦多源传感器接入与时序数据治理，适用于工站级和科研级现场采集。</div>
                    <div class="section-copy-en">A data hub for multi-sensor ingestion, synchronized collection, and disciplined field telemetry management.</div>
                </div>
            </div>
        </section>

        <section class="grid-two" id="industries">
            <article class="section-card">
                <div class="section-kicker">行业方案</div>
                <h3 class="section-title">典型应用场景</h3>
                <div class="section-title-en">Applied across industrial inspection and advanced research operations</div>
                <div class="capabilities">
                    <div class="capability">
                        <div class="capability-title">智能检测产线</div>
                        <div class="section-copy">支持相机、控制器和工位设备统一部署。</div>
                        <div class="section-copy-en">Unified deployment for cameras, controllers, and inspection stations.</div>
                    </div>
                    <div class="capability">
                        <div class="capability-title">实验仪器集成</div>
                        <div class="section-copy">兼容台架试验、标定记录与自动化任务编排。</div>
                        <div class="section-copy-en">Ready for bench validation, calibration logging, and automated task flows.</div>
                    </div>
                    <div class="capability">
                        <div class="capability-title">多点设备运维</div>
                        <div class="section-copy">适合跨区域设备批量上线与后续变更管理。</div>
                        <div class="section-copy-en">Designed for multi-site rollout and controlled change management.</div>
                    </div>
                </div>
            </article>

            <article class="section-card" id="assurance">
                <div class="section-kicker">质量体系</div>
                <h3 class="section-title">从样机到量产保持同一标准</h3>
                <div class="section-title-en">The same engineering baseline from pilot builds to scaled deployment</div>
                <p class="section-copy">我们以设备一致性、版本可追溯、现场交付稳定性为核心，确保不同项目阶段保持统一质量基线。</p>
                <p class="section-copy-en">Engineering governance is centered on hardware consistency, traceable revisions, and controlled delivery quality.</p>
                <div class="pill-strip">
                    <span class="pill">ISO 9001 Ready</span>
                    <span class="pill">EMC Validation</span>
                    <span class="pill">Remote Service SOP</span>
                    <span class="pill">Fleet Rollout Baseline</span>
                </div>
            </article>
        </section>

        <section class="section-card">
            <div class="section-kicker">核心能力</div>
            <h3 class="section-title">稳定交付而不是堆砌参数</h3>
            <div class="section-title-en">Engineered for dependable delivery, not specification theater</div>
            <p class="section-copy">我们围绕设备可靠性、边缘算力调度、远程维护与批量部署标准化构建产品体系，让复杂现场也能保持统一运营节奏。</p>
            <p class="section-copy-en">Our product architecture prioritizes reliability, orchestration, maintainability, and operational consistency across distributed hardware fleets.</p>
            <div class="capabilities">
                <div class="capability">
                    <div class="capability-title">模块化硬件</div>
                    <div class="section-copy">接口、算力与供电方案按项目场景灵活组合。</div>
                    <div class="section-copy-en">Flexible compute, I/O, and power topology tailored to project requirements.</div>
                </div>
                <div class="capability">
                    <div class="capability-title">批量部署</div>
                    <div class="section-copy">多点上线采用统一镜像、统一策略与统一监控基线。</div>
                    <div class="section-copy-en">Fleet rollout built on standardized images, policy baselines, and observability presets.</div>
                </div>
                <div class="capability">
                    <div class="capability-title">远程运维</div>
                    <div class="section-copy">设备状态、日志和变更流程全部纳入可回溯闭环。</div>
                    <div class="section-copy-en">Status, logs, and change history stay traceable throughout the device lifecycle.</div>
                </div>
            </div>
        </section>

        <footer class="footer-card">
            <div class="footer-copy">
                曜衡智能设备 · Edge Precision Systems<br />
                面向工业检测、科研仪器与高可靠边缘终端的设备解决方案<br />
                Advanced hardware solutions for inspection lines, research instruments, and mission-critical edge terminals
            </div>
            <div class="footer-chip">生产可用性目标 <strong>99.95%</strong></div>
        </footer>
    </main>
</body>
</html>`;
}
