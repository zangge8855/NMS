import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/test/setup.js',
        clearMocks: true,
        restoreMocks: true,
        mockReset: true,
    },
});
