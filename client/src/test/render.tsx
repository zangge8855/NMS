import React, { type ReactElement } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../contexts/LanguageContext';

export interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
    route?: string;
}

export function renderWithRouter(ui: ReactElement, options: RenderWithRouterOptions = {}): RenderResult {
    const { route = '/', ...rest } = options;
    return render(
        <MemoryRouter
            future={{
                v7_relativeSplatPath: true,
                v7_startTransition: true,
            }}
            initialEntries={[route]}
        >
            <LanguageProvider>{ui}</LanguageProvider>
        </MemoryRouter>,
        rest
    );
}
