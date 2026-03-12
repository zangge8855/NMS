import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { DEFAULT_LOCALE, VALID_LOCALES, getLocaleMessage } from '../i18n/messages.js';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'nms_locale';

function getStoredLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return VALID_LOCALES.includes(stored) ? stored : DEFAULT_LOCALE;
}

export function LanguageProvider({ children }) {
  const [locale, setLocaleState] = useState(getStoredLocale);

  const setLocale = useCallback((nextLocale) => {
    const normalized = VALID_LOCALES.includes(nextLocale) ? nextLocale : DEFAULT_LOCALE;
    setLocaleState(normalized);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN');
  }, [locale, setLocale]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = `NMS · ${getLocaleMessage(locale, 'shell.brandSubtitle')}`;
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    setLocale,
    toggleLocale,
    t: (path, params = {}) => getLocaleMessage(locale, path, params),
  }), [locale, setLocale, toggleLocale]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useI18n must be used within LanguageProvider');
  return context;
}
