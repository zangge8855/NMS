import {
    SESSION_SNAPSHOT_EVENT,
    clearSessionSnapshot,
    readSessionSnapshot,
    writeSessionSnapshot,
} from './sessionSnapshot.js';

describe('sessionSnapshot', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it('dispatches write and clear events for in-app snapshot sync', () => {
        const events = [];
        const handleSnapshotEvent = (event) => {
            events.push(event);
        };

        window.addEventListener(SESSION_SNAPSHOT_EVENT, handleSnapshotEvent);

        writeSessionSnapshot('dashboard_v1', { ready: true }, { source: 'app-bootstrap' });
        expect(readSessionSnapshot('dashboard_v1')).toEqual({ ready: true });
        expect(events).toHaveLength(1);
        expect(events[0].detail).toMatchObject({
            key: 'dashboard_v1',
            action: 'write',
            source: 'app-bootstrap',
            storageKey: 'nms_session_snapshot:dashboard_v1',
            value: { ready: true },
        });

        clearSessionSnapshot('dashboard_v1');
        expect(readSessionSnapshot('dashboard_v1')).toBeNull();
        expect(events).toHaveLength(2);
        expect(events[1].detail).toMatchObject({
            key: 'dashboard_v1',
            action: 'clear',
            source: '',
            storageKey: 'nms_session_snapshot:dashboard_v1',
        });

        window.removeEventListener(SESSION_SNAPSHOT_EVENT, handleSnapshotEvent);
    });
});
