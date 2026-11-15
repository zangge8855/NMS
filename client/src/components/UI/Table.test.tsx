import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import Table from './Table';
import { renderWithRouter } from '../../test/render';

describe('Table', () => {
    it('renders a keyboard-focusable scroll region with localized default label and column scopes', () => {
        renderWithRouter(
            <Table headers={['节点', '状态']}>
                <tr>
                    <td>Node A</td>
                    <td>Online</td>
                </tr>
            </Table>
        );

        const region = screen.getByRole('region', { name: '数据表格' });
        expect(region).toHaveAttribute('tabindex', '0');

        const headers = screen.getAllByRole('columnheader');
        expect(headers).toHaveLength(2);
        expect(headers[0]).toHaveAttribute('scope', 'col');
        expect(headers[1]).toHaveAttribute('scope', 'col');
    });

    it('supports custom ariaLabel and omitting the outer table container', () => {
        const { container } = renderWithRouter(
            <Table headers={['Name']} tableContainer={false}>
                <tr>
                    <td>Alpha</td>
                </tr>
            </Table>
        );

        expect(container.querySelector('.table-container')).toBeNull();
        expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('scope', 'col');

        renderWithRouter(
            <Table headers={['Server']} ariaLabel="Cluster nodes table">
                <tr>
                    <td>Beta</td>
                </tr>
            </Table>
        );

        expect(screen.getByRole('region', { name: 'Cluster nodes table' })).toHaveAttribute('tabindex', '0');
    });
});
