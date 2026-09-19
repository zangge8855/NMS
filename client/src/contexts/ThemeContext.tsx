import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';

export interface ThemeContextType {
    mode: 'auto' | 'light' | 'dark';
    resolvedTheme: 'light' | 'dark';
    setMode: (mode?: 'auto' | 'light' | 'dark') => void;
    cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const STORAGE_KEY = 'nms_theme';
const THEME_TRANSITION_CLASS = 'theme-transition';
const THEME_TRANSITION_MS = 320;

function getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'dark';
    try {
        return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
    } catch {
        return 'dark';
    }
}

function getInitialMode(): 'auto' | 'light' | 'dark' {
    if (typeof window === 'undefined') return 'auto';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
    return 'auto';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [mode, setModeState] = useState<'auto' | 'light' | 'dark'>(getInitialMode);
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme);
    const hasMountedRef = useRef(false);
    const transitionTimeoutRef = useRef<number | null>(null);

    const resolvedTheme: 'light' | 'dark' = mode === 'auto' ? systemTheme : mode;

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

        if (transitionTimeoutRef.current) {
            window.clearTimeout(transitionTimeoutRef.current);
        }
        root.classList.add(THEME_TRANSITION_CLASS);
        body.classList.add(THEME_TRANSITION_CLASS);
        transitionTimeoutRef.current = window.setTimeout(() => {
            root.classList.remove(THEME_TRANSITION_CLASS);
            body.classList.remove(THEME_TRANSITION_CLASS);
        }, THEME_TRANSITION_MS);

        return () => {
            if (transitionTimeoutRef.current) {
                window.clearTimeout(transitionTimeoutRef.current);
            }
        };
    }, [resolvedTheme, mode]);

    // Listen for system theme changes
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        try {
            const mql = window.matchMedia('(prefers-color-scheme: light)');
            if (!mql) return undefined;
            const handler = () => {
                setSystemTheme(getSystemTheme());
            };
            if (typeof mql.addEventListener === 'function') {
                mql.addEventListener('change', handler);
                return () => mql.removeEventListener('change', handler);
            }
            mql.addListener?.(handler);
            return () => mql.removeListener?.(handler);
        } catch {
            return undefined;
        }
    }, []);

    const setMode = useCallback((targetMode?: 'auto' | 'light' | 'dark') => {
        setModeState((current) => {
            const next = targetMode || (current === 'dark' ? 'light' : 'dark');
            try {
                if (next === 'auto') {
                    window.localStorage.removeItem(STORAGE_KEY);
                } else {
                    window.localStorage.setItem(STORAGE_KEY, next);
                }
            } catch {}
            return next;
        });
    }, []);

    const cycleTheme = useCallback(() => {
        setModeState((current) => {
            const next: 'auto' | 'light' | 'dark' = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
            try {
                if (next === 'auto') {
                    window.localStorage.removeItem(STORAGE_KEY);
                } else {
                    window.localStorage.setItem(STORAGE_KEY, next);
                }
            } catch {}
            return next;
        });
    }, []);

    useEffect(() => () => {
        if (transitionTimeoutRef.current) {
            window.clearTimeout(transitionTimeoutRef.current);
        }
        document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
        document.body?.classList.remove(THEME_TRANSITION_CLASS);
    }, []);

    return (
        <ThemeContext.Provider value={{ mode, resolvedTheme, setMode, cycleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

const DEFAULT_THEME_CTX: ThemeContextType = {
    mode: 'auto',
    resolvedTheme: 'dark',
    setMode: () => {},
    cycleTheme: () => {},
};

export function useTheme(): ThemeContextType {
    const ctx = useContext(ThemeContext);
    return ctx || DEFAULT_THEME_CTX;
}
