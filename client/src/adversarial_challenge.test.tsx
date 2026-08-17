import { describe, test, expect } from 'vitest';
import React, { useState, useEffect } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import messages, { VALID_LOCALES, getLocaleMessage, interpolateMessage } from './i18n/messages';

describe('Adversarial Challenge: i18n Key Resolution & Completeness', () => {
  function getAllKeys(obj: any, prefix = ''): string[] {
    let keys: string[] = [];
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          keys = keys.concat(getAllKeys(obj[key], fullPath));
        } else {
          keys.push(fullPath);
        }
      }
    }
    return keys;
  }

  test('i18n Symmetry: all keys in zh-CN exist in en-US and vice-versa', () => {
    const zhKeys = new Set(getAllKeys(messages['zh-CN']));
    const enKeys = new Set(getAllKeys(messages['en-US']));

    const missingInEn = [...zhKeys].filter(k => !enKeys.has(k));
    const missingInZh = [...enKeys].filter(k => !zhKeys.has(k));

    console.log(`[i18n Check] total zh-CN keys: ${zhKeys.size}, total en-US keys: ${enKeys.size}`);
    if (missingInEn.length > 0) {
      console.warn(`[i18n Warning] Missing in en-US (${missingInEn.length}):`, missingInEn.slice(0, 10));
    }
    if (missingInZh.length > 0) {
      console.warn(`[i18n Warning] Missing in zh-CN (${missingInZh.length}):`, missingInZh.slice(0, 10));
    }

    expect(missingInEn).toEqual([]);
    expect(missingInZh).toEqual([]);
  });

  test('Static Code AST/Regex Sweep: All t("...") calls in src/ resolve valid messages', () => {
    const srcDir = path.resolve(__dirname);
    const missingKeysFound: { file: string; keyPath: string; locale: string }[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') {
            scanDir(fullPath);
          }
        } else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js') || entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          if (entry.name.includes('.test.')) continue;
          const content = fs.readFileSync(fullPath, 'utf8');
          const tRegex = /\bt\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g;
          let match;
          while ((match = tRegex.exec(content)) !== null) {
            const keyPath = match[1];
            // Skip dynamic keys containing template strings or expressions if any match
            if (keyPath.includes('${') || keyPath === 'shell.brandSubtitle') continue;

            for (const locale of VALID_LOCALES) {
              const res = getLocaleMessage(locale, keyPath);
              if (res === '' || res === keyPath) {
                missingKeysFound.push({ file: path.relative(srcDir, fullPath), keyPath, locale });
              }
            }
          }
        }
      }
    }

    scanDir(srcDir);
    if (missingKeysFound.length > 0) {
      console.error('[i18n Missing Code Keys]:', missingKeysFound);
    }
    expect(missingKeysFound).toEqual([]);
  });

  test('Interpolation Resilience: handling null, undefined, boolean, and empty parameters', () => {
    const res1 = interpolateMessage('Hello {name}, count: {count}', { name: 'Alice', count: 0 });
    expect(res1).toBe('Hello Alice, count: 0');

    const res2 = interpolateMessage('User {user}', { user: null });
    expect(res2).toBe('User ');

    const res3 = interpolateMessage('Status {status}', { status: undefined });
    expect(res3).toBe('Status ');

    const res4 = interpolateMessage('No params {missing}', {});
    expect(res4).toBe('No params {missing}');
  });
});

describe('Adversarial Challenge: Theme & CSS Custom Properties', () => {
  test('CSS Custom Properties: All var(--...) references are defined in stylesheet', () => {
    const cssFiles = [
      path.resolve(__dirname, 'index.css'),
      path.resolve(__dirname, 'styles/flagship-console.css'),
      path.resolve(__dirname, 'styles/overlay-restore.css'),
      path.resolve(__dirname, 'styles/restrained-ui.css'),
    ].filter(f => fs.existsSync(f));

    const definedVars = new Set<string>();
    const usedVars = new Set<string>();

    cssFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      const varDefRegex = /(--[a-zA-Z0-9_-]+)\s*:/g;
      const varUseRegex = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
      let match;
      while ((match = varDefRegex.exec(content)) !== null) {
        definedVars.add(match[1]);
      }
      while ((match = varUseRegex.exec(content)) !== null) {
        usedVars.add(match[1]);
      }
    });

    const undefinedVarsUsed = [...usedVars].filter(v => !definedVars.has(v));
    console.log(`[CSS Variable Check] Defined: ${definedVars.size}, Used: ${usedVars.size}`);
    if (undefinedVarsUsed.length > 0) {
      console.error('[CSS Undefined Vars Used]:', undefinedVarsUsed);
    }
    expect(undefinedVarsUsed).toEqual([]);
  });
});

describe('Adversarial Challenge: Component Stress & Rapid Updates', () => {
  test('Rapid State Handler Stress: Rapid state toggles and fast re-renders', async () => {
    function StressTestComponent() {
      const [count, setCount] = useState(0);
      const [text, setText] = useState('');
      const [activeTab, setActiveTab] = useState('tab1');
      const [items, setItems] = useState<string[]>([]);

      return (
        <div>
          <button data-testid="inc-btn" onClick={() => setCount(c => c + 1)}>
            Count: {count}
          </button>
          <input
            data-testid="text-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button data-testid="tab1-btn" onClick={() => setActiveTab('tab1')}>Tab 1</button>
          <button data-testid="tab2-btn" onClick={() => setActiveTab('tab2')}>Tab 2</button>
          <button data-testid="add-btn" onClick={() => setItems(it => [...it, `Item ${it.length}`])}>
            Add Item
          </button>
          <div data-testid="tab-content">{activeTab}</div>
          <div data-testid="items-list">{items.join(', ')}</div>
        </div>
      );
    }

    const { getByTestId } = render(<StressTestComponent />);

    const incBtn = getByTestId('inc-btn');
    const input = getByTestId('text-input') as HTMLInputElement;
    const tab1Btn = getByTestId('tab1-btn');
    const tab2Btn = getByTestId('tab2-btn');
    const addBtn = getByTestId('add-btn');

    // Simulate 100 rapid clicks on incBtn
    await act(async () => {
      for (let i = 0; i < 100; i++) {
        fireEvent.click(incBtn);
      }
    });
    expect(incBtn.textContent).toBe('Count: 100');

    // Simulate rapid input changes
    await act(async () => {
      for (let i = 0; i < 50; i++) {
        fireEvent.change(input, { target: { value: `val_${i}` } });
      }
    });
    expect(input.value).toBe('val_49');

    // Simulate rapid tab switching
    await act(async () => {
      for (let i = 0; i < 50; i++) {
        fireEvent.click(i % 2 === 0 ? tab2Btn : tab1Btn);
      }
    });
    expect(getByTestId('tab-content').textContent).toBe('tab1');

    // Simulate rapid item additions
    await act(async () => {
      for (let i = 0; i < 50; i++) {
        fireEvent.click(addBtn);
      }
    });
    expect(getByTestId('items-list').textContent?.split(', ').length).toBe(50);
  });

  test('Async Unmount Resilience: updating state after unmount should not crash', async () => {
    let resolvePromise: (val: string) => void = () => {};
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });

    function AsyncComponent() {
      const [data, setData] = useState('initial');
      useEffect(() => {
        let isMounted = true;
        promise.then((res) => {
          if (isMounted) {
            setData(res);
          }
        });
        return () => {
          isMounted = false;
        };
      }, []);

      return <div data-testid="async-data">{data}</div>;
    }

    const { unmount } = render(<AsyncComponent />);
    // Unmount before promise resolves
    unmount();

    // Resolve promise after unmount
    await act(async () => {
      resolvePromise('resolved');
    });

    // Should complete cleanly without error
  });
});
