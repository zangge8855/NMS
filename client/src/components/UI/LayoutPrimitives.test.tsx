import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageToolbar from './PageToolbar';
import SectionHeader from './SectionHeader';

describe('Layout primitives', () => {
    it('renders page toolbar content in stable regions', () => {
        const { container } = render(
            <PageToolbar
                className="custom-toolbar"
                compact
                sticky
                density="dense"
                stackOnTablet
                main={<div>Toolbar main</div>}
                summary={<span>Synced</span>}
                actions={<button type="button">Refresh</button>}
                meta={<span>2 items</span>}
            />
        );

        expect(screen.getByText('Toolbar main')).toBeInTheDocument();
        expect(screen.getByText('Synced')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
        expect(screen.getByText('2 items')).toBeInTheDocument();
        expect(container.firstChild).toHaveClass('page-toolbar');
        expect(container.firstChild).toHaveClass('page-toolbar--compact');
        expect(container.firstChild).toHaveClass('page-toolbar--sticky');
        expect(container.firstChild).toHaveClass('page-toolbar--dense');
        expect(container.firstChild).toHaveClass('page-toolbar--stack-tablet');
        expect(container.firstChild).toHaveClass('custom-toolbar');
    });

    it('renders section header copy, meta, and actions', () => {
        const { container } = render(
            <SectionHeader
                title="Traffic trend"
                subtitle="Last 14 days"
                meta={<span>14 points</span>}
                actions={<button type="button">Export</button>}
                compact
                density="dense"
                titleSize="sm"
            />
        );

        expect(screen.getByText('Traffic trend')).toBeInTheDocument();
        expect(screen.getByText('Last 14 days')).toBeInTheDocument();
        expect(screen.getByText('14 points')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
        expect(container.firstChild).toHaveClass('section-header');
        expect(container.firstChild).toHaveClass('section-header--compact');
        expect(container.firstChild).toHaveClass('section-header--dense');
        expect(container.firstChild).toHaveClass('section-header--title-sm');
        expect(container.firstChild).toHaveClass('section-header--align-between');
    });
});
