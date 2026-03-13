import React from 'react';
import { render } from '@testing-library/react';
import { LanguageProvider } from './LanguageContext.jsx';

function DummyApp() {
    return <div>dummy</div>;
}

describe('LanguageProvider', () => {
    it('syncs document title with the sidebar brand copy', () => {
        render(
            <LanguageProvider>
                <DummyApp />
            </LanguageProvider>
        );

        expect(document.title).toBe('NMS');
        expect(document.documentElement.lang).toBe('zh-CN');
    });

    it('updates document title when stored locale is english', () => {
        localStorage.setItem('nms_locale', 'en-US');

        render(
            <LanguageProvider>
                <DummyApp />
            </LanguageProvider>
        );

        expect(document.title).toBe('NMS');
        expect(document.documentElement.lang).toBe('en-US');
    });
});
