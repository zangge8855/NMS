import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import NodeHealthGrid from './NodeHealthGrid.jsx';

describe('NodeHealthGrid', () => {
    it('separates authentication failures from unreachable nodes', () => {
        renderWithRouter(
            <NodeHealthGrid
                servers={[{ id: 'server-auth', name: 'Auth Node' }]}
                serverStatuses={{
                    'server-auth': {
                        online: false,
                        reasonCode: 'auth_failed',
                        error: 'invalid username or password',
                    },
                }}
            />
        );

        expect(screen.getByText('认证失败')).toBeInTheDocument();
        expect(screen.getByText('凭据无效')).toBeInTheDocument();
        expect(screen.getByText('invalid username or password')).toBeInTheDocument();
    });
});
