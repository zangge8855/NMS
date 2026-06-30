import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_LOCALE, VALID_LOCALES, getLocaleMessage, getLocaleMessageObject } from '../i18n/messages.js';
import { getNavItemForPath } from '../components/Layout/navConfig.js';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'nms_locale';

const ROUTE_TITLE_FALLBACKS = {
  '/logs': 'pages.logs.title',
  '/capabilities': 'pages.capabilities.title',
};

function getStoredLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return VALID_LOCALES.includes(stored) ? stored : DEFAULT_LOCALE;
}

export function LanguageProvider({ children }) {
  const [locale, setLocaleState] = useState(getStoredLocale);
  const location = useLocation();

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
    const item = getNavItemForPath(location.pathname);
    const fallbackTitlePath = ROUTE_TITLE_FALLBACKS[location.pathname];
    const pageTitle = item
      ? (typeof item.label === 'object' ? item.label[locale] : item.label)
      : (fallbackTitlePath ? getLocaleMessage(locale, fallbackTitlePath) : '');
    const subtitle = String(getLocaleMessage(locale, 'shell.brandSubtitle') || '').trim();
    if (pageTitle) {
      document.title = `${pageTitle} · NMS`;
    } else {
      document.title = subtitle ? `NMS · ${subtitle}` : 'NMS';
    }
  }, [locale, location.pathname]);

  const value = useMemo(() => ({
    locale,
    setLocale,
    toggleLocale,
    t: (path, params = {}) => getLocaleMessage(locale, path, params),
    tm: (path) => getLocaleMessageObject(locale, path),
  }), [locale, setLocale, toggleLocale]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      toggleLocale: () => {},
      t: (path, params = {}) => getLocaleMessage(DEFAULT_LOCALE, path, params),
      tm: (path) => getLocaleMessageObject(DEFAULT_LOCALE, path),
    };
  }
  return context;
}
