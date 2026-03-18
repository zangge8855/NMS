import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render.jsx';
import DownloadsCenter from './DownloadsCenter.jsx';

vi.mock('../Layout/Header.jsx', () => ({
    default: ({ title }) => <div>{title}</div>,
}));

describe('DownloadsCenter', () => {
    it('renders client downloads as a dedicated page without subscription import actions', async () => {
        renderWithRouter(<DownloadsCenter />);

        expect(screen.getByText('软件下载')).toBeInTheDocument();
        expect(screen.getAllByText('客户端下载').length).toBeGreaterThan(0);
        expect(screen.getAllByText('推荐配置文件').length).toBeGreaterThan(0);
        expect(screen.getAllByRole('link', { name: 'FlClash' }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole('link', { name: 'Shadowrocket' }).length).toBeGreaterThan(0);
        expect(screen.queryByRole('link', { name: '导入到 Shadowrocket' })).not.toBeInTheDocument();
        expect(screen.queryByText('订阅地址与导入')).not.toBeInTheDocument();
    });
});
