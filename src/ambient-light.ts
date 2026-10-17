// Thin wrapper over the Generic Sensor API's AmbientLightSensor.
// Only Chromium implements it, mainly on Android and behind the
// #enable-generic-sensor-extra-classes flag; Firefox and Safari do not. It needs a secure
// context, the "ambient-light-sensor" permission and a permissions policy that allows it.
// Every failure ends in onUnavailable, and the caller falls back to the clock.

interface AmbientLightSensorLike extends EventTarget {
  readonly illuminance: number | null;
  start(): void;
  stop(): void;
}
type AmbientLightSensorCtor = new (options?: { frequency?: number }) => AmbientLightSensorLike;

export type SensorFailure = 'unsupported' | 'denied' | 'error';

export interface AmbientLightHandle {
  stop(): void;
}

export interface AmbientLightCallbacks {
  onReading(lux: number): void;
  // `permanent` failures (unsupported, denied) are not worth retrying in this session.
  onUnavailable(reason: SensorFailure, permanent: boolean): void;
}

// Two readings per second is plenty for a theme switch and keeps the sensor cheap.
const FREQUENCY_HZ = 2;

export function isAmbientLightSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'AmbientLightSensor' in window;
}

async function permissionDenied(): Promise<boolean> {
  try {
    // 'ambient-light-sensor' is not in TypeScript's PermissionName union.
    const status = await navigator.permissions.query({ name: 'ambient-light-sensor' as PermissionName });
    return status.state === 'denied';
  } catch {
    return false; // Permissions API missing or name unknown: just try the sensor.
  }
}

export function startAmbientLight(callbacks: AmbientLightCallbacks): AmbientLightHandle {
  let sensor: AmbientLightSensorLike | null = null;
  let stopped = false;

  const fail = (reason: SensorFailure, permanent: boolean) => {
    if (stopped) return;
    handle.stop();
    callbacks.onUnavailable(reason, permanent);
  };

  const handle: AmbientLightHandle = {
    stop() {
      stopped = true;
      try { sensor?.stop(); } catch { /* already stopped */ }
      sensor = null;
    },
  };

  if (!isAmbientLightSupported()) {
    queueMicrotask(() => fail('unsupported', true));
    return handle;
  }

  void permissionDenied().then((denied) => {
    if (stopped) return;
    if (denied) return fail('denied', true);
    try {
      const Ctor = (window as unknown as { AmbientLightSensor: AmbientLightSensorCtor }).AmbientLightSensor;
      const s = new Ctor({ frequency: FREQUENCY_HZ });
      sensor = s;
      s.addEventListener('reading', () => {
        if (typeof s.illuminance === 'number' && Number.isFinite(s.illuminance)) callbacks.onReading(s.illuminance);
      });
      s.addEventListener('error', (event) => {
        // NotAllowedError: permission or policy refusal. NotReadableError / others: sensor trouble.
        const name = (event as Event & { error?: { name?: string } }).error?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') fail('denied', true);
        else fail('error', false);
      });
      s.start();
    } catch (err) {
      // SecurityError (policy) or ReferenceError / TypeError (not actually constructible).
      const name = (err as { name?: string } | null)?.name;
      fail(name === 'SecurityError' || name === 'NotAllowedError' ? 'denied' : 'error', name !== 'NotReadableError');
    }
  });
  return handle;
}
