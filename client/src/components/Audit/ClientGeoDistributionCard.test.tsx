import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ClientGeoDistributionCard from './ClientGeoDistributionCard';

describe('ClientGeoDistributionCard', () => {
    it('groups access-log rows by country using the fields the audit API returns', () => {
        render(
            <ClientGeoDistributionCard
                items={[
                    { id: '1', clientIp: '203.0.113.1', ipLocation: '中国 广东 深圳', ipCarrier: '电信' },
                    { id: '2', clientIp: '203.0.113.1', ipLocation: '中国 广东 深圳', ipCarrier: '电信' },
                    { id: '3', clientIp: '203.0.113.2', ipLocation: '中国 北京', ipCarrier: '中国联通' },
                    { id: '4', clientIp: '198.51.100.7', ipLocation: '', cfCountry: 'US' },
                ]}
            />
        );

        expect(screen.getByText('3 个活跃 IP')).toBeInTheDocument();
        expect(screen.getByText('中国')).toBeInTheDocument();
        expect(screen.getByText('· 中国电信, 中国联通')).toBeInTheDocument();
        expect(screen.getByText('美国')).toBeInTheDocument();
        expect(screen.getByText('67%')).toBeInTheDocument();
        expect(screen.queryByText('未知区域')).not.toBeInTheDocument();
    });

    it('translates country names for the English locale', () => {
        render(
            <ClientGeoDistributionCard
                locale="en-US"
                items={[{ id: '1', ip: '203.0.113.9', ipLocation: '日本 东京' }]}
            />
        );

        expect(screen.getByText('Japan')).toBeInTheDocument();
        expect(screen.getByText('1 Active IPs')).toBeInTheDocument();
    });

    it('still reports unknown when nothing about the IP could be resolved', () => {
        render(<ClientGeoDistributionCard items={[{ id: '1', ip: '203.0.113.5' }]} />);
        expect(screen.getByText('未知区域')).toBeInTheDocument();
    });
});
