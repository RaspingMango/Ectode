import { parseContactPayload, parseWifiPayload } from './codeEditor';
import { ParsedQrData, buildVCardQrString, is1DBarcodeFormat } from './qrLogic';

export interface ContactDraft {
  name?: string;
  phone?: string;
  email?: string;
  org?: string;
}

export type QuickActionKind =
  | 'add_contact'
  | 'call_phone'
  | 'send_sms'
  | 'send_email'
  | 'copy_wifi_password'
  | 'copy_wifi_ssid'
  | 'open_wifi_settings'
  | 'open_link_app'
  | 'open_link_browser'
  | 'copy_link'
  | 'search_web'
  | 'copy_text';

export function extractCleanPhoneNumber(rawContent: string, parsed: ParsedQrData): string | null {
  if (parsed.type === 'phone') {
    const cleaned = rawContent.trim().replace(/^tel:/i, '').trim();
    return cleaned || null;
  }
  if (parsed.type === 'vcard') {
    const contact = parseContactPayload(rawContent);
    return contact.phone ? contact.phone.trim() : null;
  }
  return null;
}

export function extractCleanEmail(rawContent: string, parsed: ParsedQrData): string | null {
  if (parsed.type === 'email') {
    const cleaned = rawContent.trim().replace(/^mailto:/i, '').split('?')[0].trim();
    return cleaned || null;
  }
  if (parsed.type === 'vcard') {
    const contact = parseContactPayload(rawContent);
    return contact.email ? contact.email.trim() : null;
  }
  return null;
}

export function extractContactDraft(rawContent: string, parsed: ParsedQrData): ContactDraft | null {
  if (parsed.type === 'phone') {
    const phone = extractCleanPhoneNumber(rawContent, parsed);
    if (!phone) return null;
    return { phone };
  }

  if (parsed.type === 'vcard') {
    const contact = parseContactPayload(rawContent);
    if (!contact.name && !contact.phone && !contact.email && !contact.org) {
      return null;
    }
    return {
      name: contact.name || undefined,
      phone: contact.phone || undefined,
      email: contact.email || undefined,
      org: contact.org || undefined,
    };
  }

  if (parsed.type === 'email') {
    const email = extractCleanEmail(rawContent, parsed);
    if (!email) return null;
    return { email };
  }

  return null;
}

export function buildContactVcfContent(contact: ContactDraft): string {
  const displayName = contact.name?.trim() || contact.phone?.trim() || contact.email?.trim() || 'Contact';
  return buildVCardQrString(
    displayName,
    contact.phone?.trim() || '',
    contact.email?.trim() || '',
    contact.org?.trim() || ''
  );
}

export function buildSmsUri(phone: string): string {
  const normalized = phone.replace(/[^0-9+*#,;]/g, '');
  return `sms:${normalized}`;
}

export function buildTelUri(phone: string): string {
  const normalized = phone.replace(/[^0-9+*#,;]/g, '');
  return `tel:${normalized}`;
}

export function buildMailtoUri(email: string): string {
  return `mailto:${email.trim()}`;
}

export function buildWebSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

export function extractWifiQuickInfo(rawContent: string): {
  ssid: string;
  password: string;
  hasPassword: boolean;
  auth: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
} {
  const wifi = parseWifiPayload(rawContent);
  return {
    ssid: wifi.ssid,
    password: wifi.pass,
    hasPassword: wifi.auth !== 'nopass' && wifi.pass.length > 0,
    auth: wifi.auth,
    hidden: wifi.hidden,
  };
}

export function getPlannedQuickActionKinds(params: {
  rawContent: string;
  parsed: ParsedQrData;
  hasSafeActionUrl: boolean;
  showSecondaryBrowserButton: boolean;
  isNativeAndroid: boolean;
}): QuickActionKind[] {
  const { rawContent, parsed, hasSafeActionUrl, showSecondaryBrowserButton, isNativeAndroid } = params;
  const isBarcode = is1DBarcodeFormat(parsed.codeFormat);

  if (isBarcode) {
    return ['search_web', 'copy_text'];
  }

  switch (parsed.type) {
    case 'phone': {
      const actions: QuickActionKind[] = ['add_contact', 'call_phone', 'send_sms', 'copy_text'];
      return actions;
    }
    case 'vcard': {
      const actions: QuickActionKind[] = ['add_contact'];
      if (extractCleanPhoneNumber(rawContent, parsed)) {
        actions.push('call_phone', 'send_sms');
      }
      if (extractCleanEmail(rawContent, parsed)) {
        actions.push('send_email');
      }
      actions.push('copy_text');
      return actions;
    }
    case 'email': {
      return ['send_email', 'add_contact', 'copy_text'];
    }
    case 'wifi': {
      const wifi = extractWifiQuickInfo(rawContent);
      const actions: QuickActionKind[] = [];
      if (wifi.hasPassword) actions.push('copy_wifi_password');
      if (wifi.ssid) actions.push('copy_wifi_ssid');
      if (isNativeAndroid) actions.push('open_wifi_settings');
      if (!wifi.hasPassword && !wifi.ssid) actions.push('copy_text');
      return actions;
    }
    case 'url': {
      const actions: QuickActionKind[] = [];
      if (hasSafeActionUrl) {
        actions.push('open_link_app');
        if (showSecondaryBrowserButton) actions.push('open_link_browser');
      }
      actions.push('copy_link');
      return actions;
    }
    case 'loyalty': {
      return ['search_web', 'copy_text'];
    }
    case 'ticket':
    case 'text':
    default: {
      return ['copy_text', 'search_web'];
    }
  }
}
