import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from './LanguageContext.jsx';

function DummyApp() {
    return <div>dummy</div>;
}

describe('LanguageProvider', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('syncs document title with the sidebar brand copy', () => {
        render(
            <MemoryRouter initialEntries={['/unknown']}>
                <LanguageProvider>
                    <DummyApp />
                </LanguageProvider>
            </MemoryRouter>
        );

        expect(document.title).toBe('NMS · 多节点集群管理');
        expect(document.documentElement.lang).toBe('zh-CN');
    });

    it('updates document title when stored locale is english', () => {
        localStorage.setItem('nms_locale', 'en-US');

        render(
            <MemoryRouter initialEntries={['/unknown']}>
                <LanguageProvider>
                    <DummyApp />
                </LanguageProvider>
            </MemoryRouter>
        );

        expect(document.title).toBe('NMS · Multi-Node Panel Cluster');
        expect(document.documentElement.lang).toBe('en-US');
    });

    it('updates document title dynamically on route navigation', () => {
        render(
            <MemoryRouter initialEntries={['/clients']}>
                <LanguageProvider>
                    <DummyApp />
                </LanguageProvider>
            </MemoryRouter>
        );

        expect(document.title).toBe('用户管理 · NMS');
    });
});
