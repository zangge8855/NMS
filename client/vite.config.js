import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    base: './',
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
            '/ws': {
                target: 'ws://localhost:3001',
                changeOrigin: true,
                ws: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return undefined;
                    if (id.includes('/recharts/') || id.includes('/victory-vendor/')) return 'charts-vendor';
                    if (id.includes('/react-hot-toast/') || id.includes('/qrcode.react/')) return 'ui-vendor';
                    if (id.includes('/react-icons/')) return 'icons-vendor';
                    if (id.includes('/react-dom/') || id.includes('/react-router-dom/') || id.includes('/react/')) {
                        return 'react-vendor';
                    }
                    return undefined;
                },
            },
        },
    },
    test: {
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                url: 'http://localhost/',
            },
        },
        globals: true,
        setupFiles: './src/test/setup.js',
        testTimeout: 20_000,
        clearMocks: true,
        restoreMocks: true,
        mockReset: true,
    },
});
