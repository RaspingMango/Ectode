import {
  CodeFormat,
  StoredQrItem,
  is1DBarcodeFormat,
  parseQrContent,
  resolveSafeCodeFormat,
  suggestFolderForType,
} from './qrLogic';

export type GeneratorTemplate =
  | 'text'
  | 'url'
  | 'wifi'
  | 'ticket'
  | 'loyalty'
  | 'barcode'
  | 'vcard'
  | 'phone'
  | 'email';

export interface CodeEditorDraft {
  existingId?: string;
  isFavorite?: boolean;
  source?: 'camera' | 'screen' | 'file' | 'generated';
  template: GeneratorTemplate;
  textContent: string;
  urlContent: string;
  wifiSsid: string;
  wifiPass: string;
  wifiAuth: 'WPA' | 'WEP' | 'nopass';
  wifiHidden: boolean;
  ticketEvent: string;
  ticketSeat: string;
  ticketCode: string;
  loyaltyStore: string;
  loyaltyNumber: string;
  barcodeFormat: CodeFormat;
  barcodeValue: string;
  vcardName: string;
  vcardPhone: string;
  vcardEmail: string;
  vcardOrg: string;
  phoneNumber: string;
  emailAddress: string;
  title: string;
  folderId: string;
  notes: string;
  fgColor: string;
  bgColor: string;
  ecc: 'L' | 'M' | 'Q' | 'H';
}

export function unescapeWifiField(value: string): string {
  return value.replace(/\\([\\;,:"])/g, '$1');
}

function splitUnescapedSemicolons(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (escaped) {
      current += `\\${ch}`;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === ';') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (escaped) {
    current += '\\';
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

export function parseWifiPayload(raw: string): {
  ssid: string;
  pass: string;
  auth: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
} {
  const trimmed = raw.trim();
  const body = trimmed.replace(/^wifi:/i, '').replace(/;;$/, '');
  const tokens = splitUnescapedSemicolons(body);

  let ssid = '';
  let pass = '';
  let auth: 'WPA' | 'WEP' | 'nopass' = 'WPA';
  let hidden = false;

  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = token.slice(0, colonIdx).trim().toUpperCase();
    const val = unescapeWifiField(token.slice(colonIdx + 1));

    if (key === 'S') {
      ssid = val;
    } else if (key === 'P') {
      pass = val;
    } else if (key === 'T') {
      const normalized = val.trim().toUpperCase();
      if (normalized === 'WEP') auth = 'WEP';
      else if (normalized === 'NOPASS' || normalized === 'NONE' || normalized === '') auth = 'nopass';
      else auth = 'WPA';
    } else if (key === 'H') {
      hidden = val.trim().toLowerCase() === 'true';
    }
  }

  return { ssid, pass, auth, hidden };
}

export function parseContactPayload(raw: string): {
  name: string;
  phone: string;
  email: string;
  org: string;
} {
  const trimmed = raw.trim();
  if (/^MECARD:/i.test(trimmed)) {
    const body = trimmed.replace(/^MECARD:/i, '').replace(/;;$/, '');
    const tokens = splitUnescapedSemicolons(body);
    let name = '';
    let phone = '';
    let email = '';
    let org = '';
    for (const token of tokens) {
      const idx = token.indexOf(':');
      if (idx <= 0) continue;
      const key = token.slice(0, idx).trim().toUpperCase();
      const val = unescapeWifiField(token.slice(idx + 1).trim());
      if (key === 'N' && !name) name = val.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
      else if (key === 'TEL' && !phone) phone = val;
      else if (key === 'EMAIL' && !email) email = val;
      else if (key === 'ORG' && !org) org = val;
    }
    return { name, phone, email, org };
  }

  const fnMatch = trimmed.match(/(?:^|\r?\n)FN(?:;[^:]*)?:([^\r\n]+)/i);
  const nMatch = trimmed.match(/(?:^|\r?\n)N(?:;[^:]*)?:([^\r\n]+)/i);
  const telMatch = trimmed.match(/(?:^|\r?\n)TEL(?:;[^:]*)?:([^\r\n]+)/i);
  const emailMatch = trimmed.match(/(?:^|\r?\n)EMAIL(?:;[^:]*)?:([^\r\n]+)/i);
  const orgMatch = trimmed.match(/(?:^|\r?\n)ORG(?:;[^:]*)?:([^\r\n]+)/i);

  let name = fnMatch ? fnMatch[1].trim() : '';
  if (!name && nMatch) {
    name = nMatch[1]
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .reverse()
      .join(' ');
  }

  return {
    name,
    phone: telMatch ? telMatch[1].trim() : '',
    email: emailMatch ? emailMatch[1].trim() : '',
    org: orgMatch ? orgMatch[1].replace(/;/g, ' ').replace(/\s+/g, ' ').trim() : '',
  };
}

export function buildCodeEditorDraft(params: {
  rawContent: string;
  codeFormat?: CodeFormat;
  existingItem?: StoredQrItem | null;
  title?: string;
  folderId?: string;
  notes?: string;
  isFavorite?: boolean;
  source?: 'camera' | 'screen' | 'file' | 'generated';
  fgColor?: string;
  bgColor?: string;
  ecc?: 'L' | 'M' | 'Q' | 'H';
}): CodeEditorDraft {
  const rawContent = params.rawContent || '';
  const trimmed = rawContent.trim();
  const safeFormat = resolveSafeCodeFormat(
    rawContent,
    params.existingItem?.codeFormat || params.codeFormat || 'QR_CODE'
  );
  const parsed = parseQrContent(rawContent, safeFormat);

  const draft: CodeEditorDraft = {
    existingId: params.existingItem?.id,
    isFavorite: params.isFavorite ?? params.existingItem?.isFavorite ?? false,
    source: params.existingItem?.source || params.source || 'generated',
    template: 'text',
    textContent: rawContent,
    urlContent: 'https://',
    wifiSsid: '',
    wifiPass: '',
    wifiAuth: 'WPA',
    wifiHidden: false,
    ticketEvent: '',
    ticketSeat: '',
    ticketCode: '',
    loyaltyStore: '',
    loyaltyNumber: '',
    barcodeFormat: is1DBarcodeFormat(safeFormat) ? safeFormat : 'CODE_128',
    barcodeValue: is1DBarcodeFormat(safeFormat) ? trimmed : '',
    vcardName: '',
    vcardPhone: '',
    vcardEmail: '',
    vcardOrg: '',
    phoneNumber: '',
    emailAddress: '',
    title: params.title ?? params.existingItem?.title ?? parsed.displayTitle,
    folderId: params.folderId ?? params.existingItem?.folderId ?? suggestFolderForType(parsed.type),
    notes: params.notes ?? params.existingItem?.notes ?? '',
    fgColor: params.fgColor ?? params.existingItem?.style?.fgColor ?? '#000000',
    bgColor: params.bgColor ?? params.existingItem?.style?.bgColor ?? '#ffffff',
    ecc: params.ecc ?? params.existingItem?.style?.ecc ?? 'M',
  };

  if (is1DBarcodeFormat(safeFormat)) {
    draft.template = 'barcode';
    draft.barcodeFormat = safeFormat;
    draft.barcodeValue = trimmed;
    return draft;
  }

  if (parsed.type === 'wifi') {
    const wifi = parseWifiPayload(trimmed);
    draft.template = 'wifi';
    draft.wifiSsid = wifi.ssid;
    draft.wifiPass = wifi.pass;
    draft.wifiAuth = wifi.auth;
    draft.wifiHidden = wifi.hidden;
    return draft;
  }

  if (parsed.type === 'vcard') {
    const contact = parseContactPayload(trimmed);
    draft.template = 'vcard';
    draft.vcardName = contact.name;
    draft.vcardPhone = contact.phone;
    draft.vcardEmail = contact.email;
    draft.vcardOrg = contact.org;
    return draft;
  }

  if (parsed.type === 'phone') {
    draft.template = 'phone';
    draft.phoneNumber = trimmed.replace(/^tel:/i, '').trim();
    return draft;
  }

  if (parsed.type === 'email') {
    draft.template = 'email';
    draft.emailAddress = trimmed.replace(/^mailto:/i, '').split('?')[0].trim();
    return draft;
  }

  if (parsed.type === 'url' && /^https?:\/\//i.test(trimmed)) {
    draft.template = 'url';
    draft.urlContent = trimmed;
    return draft;
  }

  if (/^TICKET:/i.test(trimmed)) {
    const parts = trimmed.split(':');
    draft.template = 'ticket';
    draft.ticketEvent = parts[1] || '';
    draft.ticketSeat = parts[2] || '';
    draft.ticketCode = parts.slice(3).join(':') || '';
    return draft;
  }

  if (/^LOYALTY:/i.test(trimmed)) {
    const parts = trimmed.split(':');
    draft.template = 'loyalty';
    draft.loyaltyStore = parts[1] || '';
    draft.loyaltyNumber = parts.slice(2).join(':') || '';
    return draft;
  }

  draft.template = 'text';
  draft.textContent = rawContent;
  return draft;
}
