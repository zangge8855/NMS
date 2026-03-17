import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import config from '../config.js';
import { getRegistrationStatus, isPasswordSelfServiceEnabled } from '../routes/auth.js';

const originalPasswordResetEnabled = config.registration.passwordResetEnabled;

afterEach(() => {
    config.registration.passwordResetEnabled = originalPasswordResetEnabled;
});

describe('auth route capability status', () => {
    it('includes the password reset capability in registration status', () => {
        config.registration.passwordResetEnabled = false;

        const status = getRegistrationStatus();

        assert.equal(status.passwordResetEnabled, false);
        assert.equal(isPasswordSelfServiceEnabled(), false);
    });

    it('treats password reset as enabled by default', () => {
        config.registration.passwordResetEnabled = true;

        const status = getRegistrationStatus();

        assert.equal(status.passwordResetEnabled, true);
        assert.equal(isPasswordSelfServiceEnabled(), true);
    });
});
