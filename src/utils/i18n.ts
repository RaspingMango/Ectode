import { en_us } from './locales/en_us';
import { ru_ru } from './locales/ru_ru';
import { fr_fr } from './locales/fr_fr';
import { de_de } from './locales/de_de';
import { es_es } from './locales/es_es';
import { pt_pt } from './locales/pt_pt';
import type {
  ColorPresetId,
  FolderIconId,
  Language,
  LocaleOptionMeta,
  TranslationSchema,
} from './locales/types';

export type {
  ColorPresetId,
  FolderIconId,
  Language,
  LocaleOptionMeta,
  TranslationSchema,
};

export { en_us, ru_ru, fr_fr, de_de, es_es, pt_pt };

export const TRANSLATIONS: Record<Language, TranslationSchema> = {
  en: en_us,
  ru: ru_ru,
  fr: fr_fr,
  de: de_de,
  es: es_es,
  pt: pt_pt,
};

export const LANGUAGE_OPTIONS: readonly LocaleOptionMeta[] = [
  { id: 'en', shortCode: 'EN', fileLocale: 'en_us', intlLocale: 'en-US', nativeName: 'English', isAiTranslated: false },
  { id: 'ru', shortCode: 'RU', fileLocale: 'ru_ru', intlLocale: 'ru-RU', nativeName: 'Русский', isAiTranslated: false },
  { id: 'fr', shortCode: 'FR', fileLocale: 'fr_fr', intlLocale: 'fr-FR', nativeName: 'Français', isAiTranslated: true },
  { id: 'de', shortCode: 'DE', fileLocale: 'de_de', intlLocale: 'de-DE', nativeName: 'Deutsch', isAiTranslated: true },
  { id: 'es', shortCode: 'ES', fileLocale: 'es_es', intlLocale: 'es-ES', nativeName: 'Español', isAiTranslated: true },
  { id: 'pt', shortCode: 'PT', fileLocale: 'pt_pt', intlLocale: 'pt-PT', nativeName: 'Português', isAiTranslated: true },
] as const;

export function getLanguageMeta(lang: Language): LocaleOptionMeta {
  return LANGUAGE_OPTIONS.find((opt) => opt.id === lang) || LANGUAGE_OPTIONS[0];
}

export function getIntlLocale(lang: Language): string {
  return getLanguageMeta(lang).intlLocale;
}

export function normalizeStoredLanguage(raw?: string | null): Language | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase().replace(/-/g, '_');
  if (norm === 'ru' || norm === 'ru_ru') return 'ru';
  if (norm === 'en' || norm === 'en_us' || norm === 'en_gb') return 'en';
  if (norm === 'fr' || norm === 'fr_fr') return 'fr';
  if (norm === 'de' || norm === 'de_de') return 'de';
  if (norm === 'es' || norm === 'es_es') return 'es';
  if (norm === 'pt' || norm === 'pt_pt' || norm === 'pt_br') return 'pt';
  return null;
}

export function resolveDeviceLanguage(locale?: string | null): Language {
  const normalized = (locale || '').trim().toLowerCase();
  const matches = (code: string) =>
    normalized === code || normalized.startsWith(`${code}-`) || normalized.startsWith(`${code}_`);

  if (matches('ru')) return 'ru';
  if (matches('fr')) return 'fr';
  if (matches('de')) return 'de';
  if (matches('es')) return 'es';
  if (matches('pt')) return 'pt';
  return 'en';
}

export function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem('ectode_language') || localStorage.getItem('ecode_language');
    const normalized = normalizeStoredLanguage(saved);
    if (normalized) return normalized;
  } catch {
    // Ignore storage access errors and fall back to device language
  }
  const primaryLocale =
    typeof navigator !== 'undefined'
      ? navigator.language || navigator.languages?.[0]
      : undefined;
  return resolveDeviceLanguage(primaryLocale);
}

export function saveLanguagePreference(lang: Language): void {
  try {
    localStorage.setItem('ectode_language', lang);
  } catch {}
}

type StockFolderKey = 'folderTickets' | 'folderLoyalty' | 'folderWifi' | 'folderLinks' | 'folderContacts' | 'folderDocs';

const STOCK_FOLDER_ID_TO_KEY: Record<string, StockFolderKey> = {
  tickets: 'folderTickets',
  loyalty: 'folderLoyalty',
  wifi: 'folderWifi',
  links: 'folderLinks',
  contacts: 'folderContacts',
  docs: 'folderDocs',
};

export function getLocalizedFolderName(folderId: string, defaultName: string, lang: Language): string {
  const dict = TRANSLATIONS[lang];
  const key = STOCK_FOLDER_ID_TO_KEY[folderId];
  if (!key) return defaultName;

  const isKnownStockName = Object.values(TRANSLATIONS).some((localeDict) => localeDict[key] === defaultName);
  if (!isKnownStockName && defaultName.trim().length > 0) {
    return defaultName;
  }
  return dict[key];
}

export function getLocalizedDetailKey(key: string, lang: Language): string {
  const dict = TRANSLATIONS[lang];
  switch (key) {
    case 'Формат': return dict.detailKeys.format;
    case 'Значение': return dict.detailKeys.value;
    case 'Сеть (SSID)': return dict.detailKeys.ssid;
    case 'Пароль': return dict.detailKeys.password;
    case 'Шифрование': return dict.detailKeys.security;
    case 'Скрытая сеть': return dict.detailKeys.hiddenNetwork;
    case 'Имя': return dict.detailKeys.name;
    case 'Телефон': return dict.detailKeys.phone;
    case 'Организация': return dict.detailKeys.organization;
    default: return key;
  }
}

export function getLocalizedDetailValue(value: string, lang: Language): string {
  const dict = TRANSLATIONS[lang];
  switch (value) {
    case '(Без пароля)': return dict.detailValues.noPassword;
    case 'Неизвестная сеть': return dict.detailValues.unknownNetwork;
    case 'Да': return dict.detailValues.yes;
    case 'Нет': return dict.detailValues.no;
    case 'Контакт': return dict.detailValues.contact;
    default: return value;
  }
}

export function getLocalizedColorPresetName(presetId: string, fallbackName: string, lang: Language): string {
  const dict = TRANSLATIONS[lang];
  if (presetId in dict.colorPresets) {
    return dict.colorPresets[presetId as ColorPresetId];
  }
  return fallbackName;
}

export function getLocalizedFolderIconLabel(iconId: string, fallbackLabel: string, lang: Language): string {
  const dict = TRANSLATIONS[lang];
  if (iconId in dict.folderIcons) {
    return dict.folderIcons[iconId as FolderIconId];
  }
  return fallbackLabel;
}

export function formatCodeCount(count: number, lang: Language): string {
  if (lang === 'ru') {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 19) return `${count} кодов`;
    if (mod10 === 1) return `${count} код`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} кода`;
    return `${count} кодов`;
  }
  const dict = TRANSLATIONS[lang];
  const template = count === 1 ? dict.codeCountSingular : dict.codeCountPlural;
  return template.replace('{count}', String(count));
}
