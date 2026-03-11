import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'nms_theme';
const LEGACY_STORAGE_KEY = 'xui_theme';
const VALID_THEMES = ['light', 'dark', 'auto'];
const THEME_TRANSITION_CLASS = 'theme-transition';
const THEME_TRANSITION_MS = 320;

function getStoredThemeMode() {
    if (typeof window === 'undefined') return 'auto';
    const stored = localStorage.getItem(STORAGE_KEY);
    if (VALID_THEMES.includes(stored)) return stored;

    const legacyStored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (VALID_THEMES.includes(legacyStored)) {
        localStorage.setItem(STORAGE_KEY, legacyStored);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return legacyStored;
    }

    return 'auto';
}

function getSystemTheme() {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveTheme(mode) {
    if (mode === 'auto') return getSystemTheme();
    return mode;
}

export function ThemeProvider({ children }) {
    const [mode, setModeState] = useState(getStoredThemeMode);
    const hasMountedRef = useRef(false);
    const transitionTimeoutRef = useRef(null);

    const resolvedTheme = resolveTheme(mode);

    // Apply theme to <html> element
    useEffect(() => {
        const root = document.documentElement;
        const { body } = document;

        root.setAttribute('data-theme', resolvedTheme);
        root.setAttribute('data-theme-mode', mode);
        root.style.colorScheme = resolvedTheme;

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
    }, [mode, resolvedTheme]);

    // Listen for system theme changes when in auto mode
    useEffect(() => {
        if (mode !== 'auto') return;
        const mql = window.matchMedia('(prefers-color-scheme: light)');
        const handler = () => {
            document.documentElement.setAttribute('data-theme', getSystemTheme());
        };
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, [mode]);

    const setMode = useCallback((newMode) => {
        const m = VALID_THEMES.includes(newMode) ? newMode : 'auto';
        setModeState(m);
        localStorage.setItem(STORAGE_KEY, m);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    }, []);

    // Cycle: dark → light → auto → dark
    const cycleTheme = useCallback(() => {
        setMode(mode === 'dark' ? 'light' : mode === 'light' ? 'auto' : 'dark');
    }, [mode, setMode]);

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
