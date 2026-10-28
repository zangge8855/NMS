import { describe, expect, it } from 'vitest';
import {
    LOCAL_IP_LOCATION_LABEL,
    regionCodeToFlag,
    resolveAccessCountry,
    resolveRegionCodeFromName,
} from './accessGeo';

describe('access geo helpers', () => {
    it('takes the country from the first token of ipLocation', () => {
        expect(resolveAccessCountry({ ipLocation: '美国 加利福尼亚州 山景城' })).toEqual({ name: '美国', code: 'US', local: false });
        expect(resolveAccessCountry({ ipLocation: '中国 广东 深圳' })).toEqual({ name: '中国', code: 'CN', local: false });
        expect(resolveAccessCountry({ ipLocation: '香港' })).toEqual({ name: '香港', code: 'HK', local: false });
    });

    it('falls back to the Cloudflare country code when no location was resolved', () => {
        expect(resolveAccessCountry({ ipLocation: '', cfCountry: 'jp' })).toEqual({ name: '日本', code: 'JP', local: false });
        expect(resolveAccessCountry({ cfCountry: 'XX' })).toEqual({ name: '', code: '', local: false });
        expect(resolveAccessCountry({ cfCountry: 'T1' })).toEqual({ name: '', code: '', local: false });
    });

    it('keeps the provider name and uses cfCountry for the flag when the name is not recognised', () => {
        expect(resolveAccessCountry({ ipLocation: '某地区 某城市', cfCountry: 'SG' })).toEqual({ name: '某地区', code: 'SG', local: false });
    });

    it('flags private and loopback addresses as local', () => {
        expect(resolveAccessCountry({ ipLocation: LOCAL_IP_LOCATION_LABEL })).toEqual({ name: LOCAL_IP_LOCATION_LABEL, code: '', local: true });
    });

    it('maps English and Chinese country names to ISO codes', () => {
        expect(resolveRegionCodeFromName('Germany')).toBe('DE');
        expect(resolveRegionCodeFromName('德国')).toBe('DE');
        expect(resolveRegionCodeFromName('Russia')).toBe('RU');
        expect(resolveRegionCodeFromName('英国')).toBe('GB');
        expect(resolveRegionCodeFromName('Atlantis')).toBe('');
    });

    it('renders regional indicator flags only for real country codes', () => {
        expect(regionCodeToFlag('us')).toBe('🇺🇸');
        expect(regionCodeToFlag('')).toBe('🌐');
        expect(regionCodeToFlag('XX')).toBe('🌐');
    });
});
