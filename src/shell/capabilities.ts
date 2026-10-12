/**
 * Capability checks: what this device and this viewer can run.
 * M1 reports them so we learn, on your real phone, which platform-evidence items hold
 * (stage 1 audit, Platform evidence: items 1, 2, 5 and 7).
 */

export type CheckStatus = 'yes' | 'no' | 'partial' | 'pending';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export function checkWebGL(): CheckResult {
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) {
      const dbg = gl2.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? String(gl2.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'renderer hidden';
      const maxTex = Number(gl2.getParameter(gl2.MAX_TEXTURE_SIZE));
      gl2.getExtension('WEBGL_lose_context')?.loseContext();
      return { id: 'webgl', label: '3D graphics (WebGL 2)', status: 'yes', detail: `${renderer}, textures up to ${maxTex} px` };
    }
    const gl1 = canvas.getContext('webgl');
    if (gl1) {
      return { id: 'webgl', label: '3D graphics (WebGL 2)', status: 'partial', detail: 'only WebGL 1: reduced quality' };
    }
    return { id: 'webgl', label: '3D graphics (WebGL 2)', status: 'no', detail: 'not available: the 2D fallback world will be used' };
  } catch (e) {
    return { id: 'webgl', label: '3D graphics (WebGL 2)', status: 'no', detail: `error: ${String(e)}` };
  }
}

export function checkAudio(): CheckResult {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return { id: 'audio', label: 'Sound (Web Audio)', status: 'no', detail: 'not available: the app will run silently' };
  return { id: 'audio', label: 'Sound (Web Audio)', status: 'yes', detail: 'available; starts after your first tap' };
}

export function checkLocalStorage(): CheckResult {
  const key = 'ascent.probe';
  try {
    window.localStorage.setItem(key, '1');
    const ok = window.localStorage.getItem(key) === '1';
    window.localStorage.removeItem(key);
    return ok
      ? { id: 'local', label: 'On-device journal (browser storage)', status: 'yes', detail: 'offline copies can be kept on this device' }
      : { id: 'local', label: 'On-device journal (browser storage)', status: 'no', detail: 'read-back failed' };
  } catch {
    return { id: 'local', label: 'On-device journal (browser storage)', status: 'no', detail: 'blocked here: changes will be kept only once synced' };
  }
}

export function checkScreen(): CheckResult {
  const w = Math.round(window.innerWidth);
  const h = Math.round(window.innerHeight);
  const dpr = window.devicePixelRatio || 1;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced motion on' : 'full motion';
  return { id: 'screen', label: 'Screen', status: 'yes', detail: `${w} × ${h}, pixel ratio ${dpr}, ${motion}` };
}

export function checkCores(): CheckResult {
  const cores = navigator.hardwareConcurrency;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const parts = [cores ? `${cores} cores` : 'cores unknown', mem ? `about ${mem} GB memory` : 'memory not reported'];
  return { id: 'device', label: 'Device', status: 'yes', detail: parts.join(', ') };
}

/** Waits for the artifact runtime to answer for a capability; null after the timeout. */
async function useCapability(name: string, timeoutMs: number): Promise<unknown> {
  const rt = window.claude;
  if (!rt || typeof rt.use !== 'function') return null;
  return Promise.race([
    rt.use(name).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/** Synced private storage: the artifact database plus a signed-in viewer id. */
export async function checkSyncedStorage(): Promise<CheckResult> {
  const label = 'Synced private storage';
  if (!window.claude) {
    return { id: 'sync', label, status: 'no', detail: 'not inside a claude.ai artifact viewer' };
  }
  const [db, user] = await Promise.all([useCapability('db', 10_000), useCapability('user', 10_000)]);
  if (!db) return { id: 'sync', label, status: 'no', detail: 'database not available in this view' };
  let id: string | null = null;
  try {
    const u = user as { id?: () => Promise<string | null> } | null;
    id = u && typeof u.id === 'function' ? await u.id() : null;
  } catch {
    id = null;
  }
  if (!id) return { id: 'sync', label, status: 'partial', detail: 'database available, but no signed-in viewer id' };
  return { id: 'sync', label, status: 'yes', detail: 'available and private to you' };
}

export function runSyncChecks(): CheckResult[] {
  return [checkWebGL(), checkAudio(), checkLocalStorage(), checkScreen(), checkCores()];
}
