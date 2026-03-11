import React from 'react';
import { render, screen } from '@testing-library/react';
import PageToolbar from './PageToolbar.jsx';
import SectionHeader from './SectionHeader.jsx';

describe('Layout primitives', () => {
    it('renders page toolbar content in stable regions', () => {
        const { container } = render(
            <PageToolbar
                className="custom-toolbar"
                compact
                stackOnTablet
                main={<div>Toolbar main</div>}
                actions={<button type="button">Refresh</button>}
                meta={<span>2 items</span>}
            />
        );

        expect(screen.getByText('Toolbar main')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
        expect(screen.getByText('2 items')).toBeInTheDocument();
        expect(container.firstChild).toHaveClass('page-toolbar');
        expect(container.firstChild).toHaveClass('page-toolbar--compact');
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
            />
        );

        expect(screen.getByText('Traffic trend')).toBeInTheDocument();
        expect(screen.getByText('Last 14 days')).toBeInTheDocument();
        expect(screen.getByText('14 points')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
        expect(container.firstChild).toHaveClass('section-header');
        expect(container.firstChild).toHaveClass('section-header--compact');
        expect(container.firstChild).toHaveClass('section-header--align-between');
    });
});
