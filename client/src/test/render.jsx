import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

export function renderWithRouter(ui, options = {}) {
    const { route = '/', ...rest } = options;
    return render(
        <MemoryRouter
            future={{
                v7_relativeSplatPath: true,
                v7_startTransition: true,
            }}
            initialEntries={[route]}
        >
            {ui}
        </MemoryRouter>,
        rest
    );
}
