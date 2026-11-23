import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import type { ThemeMode } from './theme';

export interface CameraViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius?: number;
}

export interface NativeCameraStartOptions {
  facing: 'environment' | 'user';
  bounds: CameraViewportBounds;
  viewportWidth: number;
  backdropColor: string;
}

export interface NativeCameraStartResult {
  started: boolean;
  permissionDenied: boolean;
  hasTorch: boolean;
  torchEnabled: boolean;
}

export interface NativeCameraDetectionEvent {
  data: string;
  format?: string;
  timestamp?: number;
}

export interface NativeCameraStateEvent {
  running: boolean;
  torchEnabled?: boolean;
  reason?: string;
}

interface NativeCameraPluginInterface {
  isSupported(): Promise<{ supported: boolean; platform?: string }>;
  getStatus(): Promise<{ running: boolean; hasTorch: boolean; torchEnabled: boolean }>;
  startCamera(options: NativeCameraStartOptions): Promise<NativeCameraStartResult>;
  updateBounds(options: {
    bounds: CameraViewportBounds;
    viewportWidth: number;
    backdropColor?: string;
  }): Promise<void>;
  setTorch(options: { enabled: boolean }): Promise<{ supported: boolean; enabled: boolean }>;
  stopCamera(): Promise<{ stopped: boolean }>;
  addListener(
    eventName: 'codeDetected',
    listenerFunc: (event: NativeCameraDetectionEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'cameraState',
    listenerFunc: (event: NativeCameraStateEvent) => void
  ): Promise<PluginListenerHandle>;
}

const NativeCamera = registerPlugin<NativeCameraPluginInterface>('NativeCamera');

export function shouldUseNativeCamera(isNativePlatform: boolean, platform: string): boolean {
  return Boolean(isNativePlatform && platform === 'android');
}

export function isNativeCameraPlatform(): boolean {
  return shouldUseNativeCamera(Capacitor.isNativePlatform(), Capacitor.getPlatform());
}

export function computeCameraBackdropColor(theme: ThemeMode): string {
  return theme === 'light' ? '#f7f9f5' : '#121316';
}

export function normalizeViewportBounds(
  rect: { left: number; top: number; width: number; height: number },
  borderRadius: number = 28
): CameraViewportBounds {
  const safeFinite = (n: number) => (Number.isFinite(n) ? n : 0);
  return {
    left: Math.max(0, Math.round(safeFinite(rect.left) * 100) / 100),
    top: Math.max(0, Math.round(safeFinite(rect.top) * 100) / 100),
    width: Math.max(1, Math.round(safeFinite(rect.width) * 100) / 100),
    height: Math.max(1, Math.round(safeFinite(rect.height) * 100) / 100),
    borderRadius: Math.max(0, safeFinite(borderRadius)),
  };
}

export function detectWebTrackTorchSupport(
  track: { getCapabilities?: () => unknown } | null | undefined,
  photoCapabilities?: { fillLightMode?: string[] } | null
): boolean {
  if (track && typeof track.getCapabilities === 'function') {
    try {
      const caps = track.getCapabilities() as { torch?: boolean } | null | undefined;
      if (caps && caps.torch) {
        return true;
      }
    } catch {
      // Ignore getCapabilities errors on restricted browsers
    }
  }

  const modes = photoCapabilities?.fillLightMode;
  if (Array.isArray(modes)) {
    return modes.includes('torch') || modes.includes('flash');
  }

  return false;
}

export function shouldSuspendCamera(modalFlags: {
  cleanModalOpen?: boolean;
  turnstileModalOpen?: boolean;
  folderModalOpen?: boolean;
  aboutOpen?: boolean;
}): boolean {
  return Boolean(
    modalFlags.cleanModalOpen ||
      modalFlags.turnstileModalOpen ||
      modalFlags.folderModalOpen ||
      modalFlags.aboutOpen
  );
}

export async function startNativeCamera(
  options: NativeCameraStartOptions
): Promise<NativeCameraStartResult> {
  return NativeCamera.startCamera(options);
}

export async function updateNativeCameraBounds(options: {
  bounds: CameraViewportBounds;
  viewportWidth: number;
  backdropColor?: string;
}): Promise<void> {
  if (!isNativeCameraPlatform()) return;
  try {
    await NativeCamera.updateBounds(options);
  } catch {
    // Ignore transient layout updates before camera starts
  }
}

export async function setNativeCameraTorch(
  enabled: boolean
): Promise<{ supported: boolean; enabled: boolean }> {
  return NativeCamera.setTorch({ enabled });
}

export async function stopNativeCamera(): Promise<void> {
  if (!isNativeCameraPlatform()) return;
  try {
    await NativeCamera.stopCamera();
  } catch (err) {
    console.warn('stopNativeCamera failed:', err);
  }
}

export async function addNativeCameraCodeListener(
  callback: (event: NativeCameraDetectionEvent) => void
): Promise<PluginListenerHandle | null> {
  if (!isNativeCameraPlatform()) return null;
  return NativeCamera.addListener('codeDetected', callback);
}

export async function addNativeCameraStateListener(
  callback: (event: NativeCameraStateEvent) => void
): Promise<PluginListenerHandle | null> {
  if (!isNativeCameraPlatform()) return null;
  return NativeCamera.addListener('cameraState', callback);
}
