import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'nms_theme';
const LEGACY_STORAGE_KEY = 'xui_theme';
const THEME_TRANSITION_CLASS = 'theme-transition';
const THEME_TRANSITION_MS = 320;

function getSystemTheme() {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }) {
    const mode = 'auto';
    const [resolvedTheme, setResolvedTheme] = useState(getSystemTheme);
    const hasMountedRef = useRef(false);
    const transitionTimeoutRef = useRef(null);

    // Apply theme to <html> element
    useEffect(() => {
        const root = document.documentElement;
        const { body } = document;

        root.setAttribute('data-theme', resolvedTheme);
        root.setAttribute('data-theme-mode', mode);
        root.style.colorScheme = resolvedTheme;
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);

        if (!body) return undefined;
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return undefined;
        }

        window.clearTimeout(transitionTimeoutRef.current);
        root.classList.add(THEME_TRANSITION_CLASS);
        body.classList.add(THEME_TRANSITION_CLASS);
        transitionTimeoutRef.current = window.setTimeout(() => {
            root.classList.remove(THEME_TRANSITION_CLASS);
            body.classList.remove(THEME_TRANSITION_CLASS);
        }, THEME_TRANSITION_MS);

        return () => window.clearTimeout(transitionTimeoutRef.current);
    }, [resolvedTheme]);

    // Listen for system theme changes. Manual theme switching is intentionally disabled.
    useEffect(() => {
        const mql = window.matchMedia('(prefers-color-scheme: light)');
        const handler = () => {
            setResolvedTheme(getSystemTheme());
        };
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', handler);
            return () => mql.removeEventListener('change', handler);
        }
        mql.addListener?.(handler);
        return () => mql.removeListener?.(handler);
    }, []);

    const setMode = useCallback(() => {
        setResolvedTheme(getSystemTheme());
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }, []);

    const cycleTheme = setMode;

    useEffect(() => () => {
        window.clearTimeout(transitionTimeoutRef.current);
        document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
        document.body?.classList.remove(THEME_TRANSITION_CLASS);
    }, []);

    return (
        <ThemeContext.Provider value={{ mode, resolvedTheme, setMode, cycleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
    return ctx;
}
