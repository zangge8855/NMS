import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

function ThemeProbe() {
    const { mode, resolvedTheme, setMode } = useTheme();
    return (
        <div>
            <span data-testid="theme-mode">{mode}</span>
            <span data-testid="resolved-theme">{resolvedTheme}</span>
            <button type="button" onClick={() => setMode('light')}>
                Light
            </button>
            <button type="button" onClick={() => setMode('dark')}>
                Dark
            </button>
            <button type="button" onClick={() => setMode('auto')}>
                Auto
            </button>
        </div>
    );
}

describe('ThemeProvider', () => {
    let colorSchemeMeta: HTMLMetaElement | null = null;

    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.removeAttribute('data-theme-mode');
        document.documentElement.style.colorScheme = '';

        colorSchemeMeta = document.head.querySelector('meta[name="color-scheme"]');
        if (!colorSchemeMeta) {
            colorSchemeMeta = document.createElement('meta');
            colorSchemeMeta.setAttribute('name', 'color-scheme');
            colorSchemeMeta.setAttribute('content', 'light dark');
            document.head.appendChild(colorSchemeMeta);
        } else {
            colorSchemeMeta.setAttribute('content', 'light dark');
        }
    });

    afterEach(() => {
        colorSchemeMeta?.remove();
    });

    it('keeps auto color-scheme on light dark without pinning inline root style', () => {
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>
        );

        expect(screen.getByTestId('theme-mode')).toHaveTextContent('auto');
        expect(colorSchemeMeta?.getAttribute('content')).toBe('light dark');
        expect(document.documentElement.style.colorScheme).toBe('');
    });

    it('updates meta color-scheme when switching modes and restores light dark in auto mode', () => {
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        expect(screen.getByTestId('theme-mode')).toHaveTextContent('light');
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light');
        expect(colorSchemeMeta?.getAttribute('content')).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(document.documentElement.style.colorScheme).toBe('light');

        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        expect(screen.getByTestId('theme-mode')).toHaveTextContent('dark');
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
        expect(colorSchemeMeta?.getAttribute('content')).toBe('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');

        fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
        expect(screen.getByTestId('theme-mode')).toHaveTextContent('auto');
        expect(colorSchemeMeta?.getAttribute('content')).toBe('light dark');
        expect(document.documentElement.style.colorScheme).toBe('');
    });

    it('synchronizes theme mode across tabs via window storage events', () => {
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>
        );

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'nms_theme', newValue: 'light' }));
        });

        expect(screen.getByTestId('theme-mode')).toHaveTextContent('light');
        expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light');
        expect(colorSchemeMeta?.getAttribute('content')).toBe('light');

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'nms_theme', newValue: 'auto' }));
        });

        expect(screen.getByTestId('theme-mode')).toHaveTextContent('auto');
        expect(colorSchemeMeta?.getAttribute('content')).toBe('light dark');
    });
});
