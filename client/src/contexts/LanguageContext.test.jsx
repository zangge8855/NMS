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

    it('falls back to the app name when the brand subtitle is empty', () => {
        render(
            <MemoryRouter initialEntries={['/unknown']}>
                <LanguageProvider>
                    <DummyApp />
                </LanguageProvider>
            </MemoryRouter>
        );

        expect(document.title).toBe('NMS');
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

        expect(document.title).toBe('NMS');
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
