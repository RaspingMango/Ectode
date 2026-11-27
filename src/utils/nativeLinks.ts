import { Capacitor, registerPlugin } from '@capacitor/core';
import { TRANSLATIONS, type Language } from './i18n';
import type { ParsedQrData } from './qrLogic';
import { ContactDraft, buildContactVcfContent } from './scannedActions';

export interface LinkAppHandler {
  packageName: string;
  label: string;
}

export interface UrlInspectionResult {
  isHttpUrl: boolean;
  hasSupportedApp: boolean;
  primaryApp: LinkAppHandler | null;
  apps: LinkAppHandler[];
}

export type LinkOpenMode = 'app' | 'browser' | 'system';

export interface OpenUrlResult {
  opened: boolean;
  reason?: string;
}

interface NativeLinkPluginInterface {
  inspectUrl(options: { url: string }): Promise<UrlInspectionResult>;
  openUrl(options: {
    url: string;
    mode?: LinkOpenMode;
    packageName?: string;
    chooserTitle?: string;
  }): Promise<OpenUrlResult>;
  addContact(options: ContactDraft): Promise<OpenUrlResult>;
  openWifiSettings(): Promise<OpenUrlResult>;
}

const NativeLink = registerPlugin<NativeLinkPluginInterface>('NativeLink');

const BLOCKED_EXTERNAL_SCHEMES = new Set([
  'javascript',
  'data',
  'vbscript',
  'file',
  'content',
]);

const SAFE_OPAQUE_SCHEMES = new Set([
  'tel',
  'mailto',
  'geo',
  'sms',
  'smsto',
]);

export function shouldUseNativeLinks(isNativePlatform: boolean, platform: string): boolean {
  return Boolean(isNativePlatform && platform === 'android');
}

export function isNativeLinkPlatform(): boolean {
  return shouldUseNativeLinks(Capacitor.isNativePlatform(), Capacitor.getPlatform());
}

/**
 * Checks if string is an http:// or https:// web link.
 */
export function isWebHttpUrl(rawUrl: string | undefined | null): boolean {
  if (!rawUrl) return false;
  return /^https?:\/\/\S+$/i.test(rawUrl.trim());
}

/**
 * Checks if string is a non-HTTP deep link or app URI (e.g. tg://..., geo:..., sms:...).
 */
export function isCustomDeepLink(rawUrl: string | undefined | null): boolean {
  const safe = sanitizeExternalUrl(rawUrl);
  if (!safe) return false;
  if (isWebHttpUrl(safe)) return false;
  const colonIdx = safe.indexOf(':');
  if (colonIdx <= 0) return false;
  const scheme = safe.slice(0, colonIdx).toLowerCase();
  if (scheme === 'tel' || scheme === 'mailto') return false;
  return true;
}

/**
 * Validates that an external URL or deep link uses a safe scheme (blocks javascript:, data:, file:, content:).
 */
export function sanitizeExternalUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]{1,15}):(.*)$/i);
  if (!schemeMatch) return null;

  const scheme = schemeMatch[1].toLowerCase();
  const rest = schemeMatch[2];
  if (!rest || BLOCKED_EXTERNAL_SCHEMES.has(scheme)) {
    return null;
  }

  if (scheme === 'http' || scheme === 'https') {
    if (!/^\/\/[^/?#]+/.test(rest)) return null;
    return trimmed;
  }

  if (SAFE_OPAQUE_SCHEMES.has(scheme)) {
    return trimmed;
  }

  // Custom app deep links must use authority/path separator `://`
  if (rest.startsWith('//') && rest.length > 2) {
    return trimmed;
  }

  return null;
}

export interface LinkActionPresentation {
  mode: LinkOpenMode;
  primaryLabel: string;
  showSecondaryBrowserButton: boolean;
  targetPackageName?: string;
}

export function resolveLinkActionPresentation(params: {
  url: string;
  type: ParsedQrData['type'];
  inspection: UrlInspectionResult | null;
  lang: Language;
  defaultOpenInBrowserLabel: string;
  openInAppLabel: string;
  executeActionLabel: string;
}): LinkActionPresentation {
  const {
    url,
    type,
    inspection,
    lang,
    defaultOpenInBrowserLabel,
    openInAppLabel,
    executeActionLabel,
  } = params;

  const isHttp = isWebHttpUrl(url);
  const isDeepLink = isCustomDeepLink(url);

  if (inspection?.hasSupportedApp) {
    const singleApp = inspection.apps.length === 1 ? inspection.apps[0] : null;
    const appLabel = singleApp?.label?.trim();
    const primaryLabel = appLabel
      ? TRANSLATIONS[lang].openInAppNamedTemplate.replace('{app}', appLabel)
      : openInAppLabel;

    return {
      mode: 'app',
      primaryLabel,
      showSecondaryBrowserButton: isHttp,
      targetPackageName: singleApp?.packageName,
    };
  }

  if (isDeepLink) {
    return {
      mode: 'app',
      primaryLabel: openInAppLabel,
      showSecondaryBrowserButton: false,
    };
  }

  if (type === 'url' || isHttp) {
    return {
      mode: 'system',
      primaryLabel: defaultOpenInBrowserLabel,
      showSecondaryBrowserButton: false,
    };
  }

  return {
    mode: 'system',
    primaryLabel: executeActionLabel,
    showSecondaryBrowserButton: false,
  };
}

export async function inspectExternalUrl(url: string): Promise<UrlInspectionResult | null> {
  const safeUrl = sanitizeExternalUrl(url);
  if (!safeUrl || !isNativeLinkPlatform()) {
    return null;
  }

  try {
    return await NativeLink.inspectUrl({ url: safeUrl });
  } catch {
    return null;
  }
}

export async function openExternalUrl(
  url: string,
  options?: {
    mode?: LinkOpenMode;
    packageName?: string;
    chooserTitle?: string;
  }
): Promise<OpenUrlResult> {
  const safeUrl = sanitizeExternalUrl(url);
  if (!safeUrl) {
    return { opened: false, reason: 'invalid_url' };
  }

  if (!isNativeLinkPlatform()) {
    return { opened: false, reason: 'web_fallback' };
  }

  try {
    return await NativeLink.openUrl({
      url: safeUrl,
      mode: options?.mode ?? 'system',
      packageName: options?.packageName,
      chooserTitle: options?.chooserTitle,
    });
  } catch {
    return { opened: false, reason: 'error' };
  }
}

export async function addContactToDevice(
  contact: ContactDraft
): Promise<'opened' | 'downloaded' | 'failed'> {
  if (isNativeLinkPlatform()) {
    try {
      const res = await NativeLink.addContact(contact);
      if (res.opened) {
        return 'opened';
      }
    } catch {
      // Fall back to .vcf card download
    }
  }

  try {
    const vcf = buildContactVcfContent(contact);
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeName = (contact.name || contact.phone || contact.email || 'contact')
      .trim()
      .replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'contact';
    anchor.href = url;
    anchor.download = `${safeName}.vcf`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

export async function openDeviceWifiSettings(): Promise<boolean> {
  if (!isNativeLinkPlatform()) return false;
  try {
    const res = await NativeLink.openWifiSettings();
    return Boolean(res.opened);
  } catch {
    return false;
  }
}
