import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Copy,
  Share2,
  ExternalLink,
  Smartphone,
  Globe,
  Maximize2,
  Check,
  CheckCircle2,
  BookmarkPlus,
  Wifi,
  Phone,
  Mail,
  User,
  UserPlus,
  MessageSquare,
  Search,
  KeyRound,
  Ticket,
  CreditCard,
  FileText,
  Star,
  Barcode,
  Pencil,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import {
  CodeFormat,
  DownloadImageFormat,
  Folder,
  ParsedQrData,
  StoredQrItem,
  getBarcodeFormatLabel,
  is1DBarcodeFormat,
  parseQrContent,
  resolveSafeCodeFormat,
  suggestFolderForType,
} from '../utils/qrLogic';
import { generateQrDataUrl, downloadQr, copyQrToClipboard, QrRenderOptions } from '../utils/qrRenderer';
import { TurnstileModal } from './TurnstileModal';
import { playTapSound, triggerHaptic } from '../utils/audio';
import { shareCodeContent } from '../utils/share';
import {
  Language,
  TRANSLATIONS,
  getLocalizedDetailKey,
  getLocalizedDetailValue,
  getLocalizedFolderName,
} from '../utils/i18n';
import { ThemeMode } from '../utils/theme';
import { FolderSelect } from './FolderSelect';
import { DownloadButton } from './DownloadButton';
import {
  UrlInspectionResult,
  addContactToDevice,
  inspectExternalUrl,
  isNativeLinkPlatform,
  openDeviceWifiSettings,
  openExternalUrl,
  resolveLinkActionPresentation,
  sanitizeExternalUrl,
} from '../utils/nativeLinks';
import { CodeEditorDraft, buildCodeEditorDraft } from '../utils/codeEditor';
import {
  QuickActionKind,
  buildMailtoUri,
  buildSmsUri,
  buildTelUri,
  buildWebSearchUrl,
  extractCleanEmail,
  extractCleanPhoneNumber,
  extractContactDraft,
  extractWifiQuickInfo,
  getPlannedQuickActionKinds,
} from '../utils/scannedActions';

interface CleanQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawContent: string;
  codeFormat?: CodeFormat;
  existingItem?: StoredQrItem | null;
  source?: 'camera' | 'screen' | 'file' | 'generated';
  folders: Folder[];
  lang?: Language;
  theme?: ThemeMode;
  defaultDownloadFormat?: DownloadImageFormat;
  onSaveToGallery: (item: Omit<StoredQrItem, 'id' | 'createdAt'>, existingId?: string) => void;
  onEditCode: (draft: CodeEditorDraft) => void;
  onShowToast?: (message: string) => void;
}

export function CleanQrModal({
  isOpen,
  onClose,
  rawContent,
  codeFormat = 'QR_CODE',
  existingItem,
  source = 'camera',
  folders,
  lang = 'ru',
  theme = 'dark',
  defaultDownloadFormat = 'png',
  onSaveToGallery,
  onEditCode,
  onShowToast,
}: CleanQrModalProps) {
  const isDark = theme === 'dark';
  const t = TRANSLATIONS[lang];
  const safeFormat = resolveSafeCodeFormat(
    rawContent || '',
    existingItem?.codeFormat || codeFormat || 'QR_CODE'
  );
  const [parsed, setParsed] = useState<ParsedQrData>(() => parseQrContent(rawContent || '', safeFormat));
  const [dataUrl, setDataUrl] = useState<string>('');
  const [showTurnstile, setShowTurnstile] = useState(false);

  const fgColor = existingItem?.style?.fgColor || '#000000';
  const bgColor = existingItem?.style?.bgColor || '#ffffff';
  const ecc: 'L' | 'M' | 'Q' | 'H' = existingItem?.style?.ecc || 'M';

  // Form State
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState('docs');
  const [notes, setNotes] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isCopiedText, setIsCopiedText] = useState(false);
  const [copiedQuickKey, setCopiedQuickKey] = useState<string | null>(null);
  const [isCopiedImage, setIsCopiedImage] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [linkInspection, setLinkInspection] = useState<UrlInspectionResult | null>(null);

  const isBarcode = is1DBarcodeFormat(safeFormat);
  const safeActionUrl = sanitizeExternalUrl(parsed.actionUrl);
  const nativeLinkEnabled = isNativeLinkPlatform();

  useEffect(() => {
    if (!isOpen || !rawContent) return;

    const parsedData = parseQrContent(rawContent, safeFormat);
    setParsed(parsedData);

    if (existingItem) {
      setTitle(existingItem.title);
      setFolderId(existingItem.folderId);
      setNotes(existingItem.notes || '');
      setIsFavorite(existingItem.isFavorite);
    } else {
      setTitle(parsedData.displayTitle);
      setFolderId(suggestFolderForType(parsedData.type));
      setNotes('');
      setIsFavorite(false);
    }
  }, [isOpen, rawContent, safeFormat, existingItem]);

  useEffect(() => {
    if (!isOpen || !safeActionUrl || !nativeLinkEnabled) {
      setLinkInspection(null);
      return;
    }

    let cancelled = false;
    setLinkInspection(null);
    inspectExternalUrl(safeActionUrl).then((result) => {
      if (!cancelled) {
        setLinkInspection(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, safeActionUrl, nativeLinkEnabled]);

  const linkAction = useMemo(
    () =>
      resolveLinkActionPresentation({
        url: safeActionUrl || '',
        type: parsed.type,
        inspection: linkInspection,
        lang,
        defaultOpenInBrowserLabel: t.openInBrowser,
        openInAppLabel: t.openInApp,
        executeActionLabel: t.executeAction,
      }),
    [safeActionUrl, parsed.type, linkInspection, lang, t.openInBrowser, t.openInApp, t.executeAction]
  );

  useEffect(() => {
    if (!isOpen || !rawContent) return;
    let cancelled = false;

    const renderOpts: QrRenderOptions = {
      fgColor,
      bgColor,
      ecc,
      margin: 2,
      width: 720,
      codeFormat: safeFormat,
    };

    generateQrDataUrl(rawContent, renderOpts)
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err) => console.error('Error generating clean code preview:', err));

    return () => {
      cancelled = true;
    };
  }, [isOpen, rawContent, fgColor, bgColor, ecc, safeFormat]);

  const contactDraft = useMemo(() => extractContactDraft(rawContent, parsed), [rawContent, parsed]);
  const cleanPhone = useMemo(() => extractCleanPhoneNumber(rawContent, parsed), [rawContent, parsed]);
  const cleanEmail = useMemo(() => extractCleanEmail(rawContent, parsed), [rawContent, parsed]);
  const wifiInfo = useMemo(
    () => (parsed.type === 'wifi' ? extractWifiQuickInfo(rawContent) : null),
    [rawContent, parsed.type]
  );

  const plannedActions = useMemo<QuickActionKind[]>(
    () =>
      getPlannedQuickActionKinds({
        rawContent,
        parsed,
        hasSafeActionUrl: Boolean(safeActionUrl),
        showSecondaryBrowserButton: Boolean(nativeLinkEnabled && linkAction.showSecondaryBrowserButton),
        isNativeAndroid: nativeLinkEnabled,
      }),
    [rawContent, parsed, safeActionUrl, nativeLinkEnabled, linkAction.showSecondaryBrowserButton]
  );

  if (!isOpen || !rawContent) return null;

  const currentFolder = folders.find((f) => f.id === folderId) || folders[0];
  const currentFolderName = getLocalizedFolderName(currentFolder.id, currentFolder.name, lang);

  const copyTextValue = async (value: string, key: string, toastMessage?: string) => {
    playTapSound();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedQuickKey(key);
      if (key === 'raw') setIsCopiedText(true);
      if (toastMessage) onShowToast?.(toastMessage);
      setTimeout(() => {
        setCopiedQuickKey((prev) => (prev === key ? null : prev));
        if (key === 'raw') setIsCopiedText(false);
      }, 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleCopyText = () => copyTextValue(rawContent, 'raw');

  const handleCopyImage = async () => {
    playTapSound();
    const success = await copyQrToClipboard(rawContent, {
      fgColor,
      bgColor,
      ecc,
      codeFormat: safeFormat,
    });
    if (success) {
      setIsCopiedImage(true);
      setTimeout(() => setIsCopiedImage(false), 2000);
    }
  };

  const handleDownload = async (format: DownloadImageFormat) => {
    playTapSound();
    try {
      const res = await downloadQr(rawContent, title || 'ectode-code', format, {
        fgColor,
        bgColor,
        ecc,
        codeFormat: safeFormat,
      });
      if (res.saved) {
        setIsDownloaded(true);
        setTimeout(() => setIsDownloaded(false), 2000);
        onShowToast?.(`${t.savedToDownloads} ${res.fileName}`);
      }
    } catch {
      onShowToast?.(t.downloadFailed);
    }
  };

  const handleShare = async () => {
    playTapSound();
    let imageDataUrl = dataUrl;
    if (!imageDataUrl) {
      try {
        imageDataUrl = await generateQrDataUrl(rawContent, {
          fgColor,
          bgColor,
          ecc,
          margin: 2,
          width: 720,
          codeFormat: safeFormat,
        });
      } catch {
        imageDataUrl = '';
      }
    }

    const result = await shareCodeContent({
      title: title || 'Ectode',
      rawContent,
      dialogTitle: t.shareQr,
      imageDataUrl,
    });

    if (result === 'copied') {
      setIsCopiedText(true);
      setTimeout(() => setIsCopiedText(false), 2000);
    }
  };

  const handleEditClick = () => {
    playTapSound();
    const draft = buildCodeEditorDraft({
      rawContent,
      codeFormat: safeFormat,
      existingItem,
      title,
      folderId,
      notes,
      isFavorite,
      source: existingItem?.source || source,
      fgColor,
      bgColor,
      ecc,
    });
    onEditCode(draft);
  };

  const handleAddContact = async () => {
    if (!contactDraft) return;
    playTapSound();
    const result = await addContactToDevice(contactDraft);
    if (result === 'opened') {
      onShowToast?.(t.contactOpenedToast);
    } else if (result === 'downloaded') {
      onShowToast?.(t.contactVcfSavedToast);
    } else {
      onShowToast?.(t.contactOpenFailedToast);
    }
  };

  const handleSave = () => {
    playTapSound();
    triggerHaptic([30, 20, 50]);

    onSaveToGallery(
      {
        title: title.trim() || parsed.displayTitle,
        rawContent,
        folderId,
        dataType: parsed.type,
        codeFormat: safeFormat,
        notes: notes.trim(),
        isFavorite,
        source: existingItem?.source || source,
        style: {
          fgColor,
          bgColor,
          ecc,
        },
      },
      existingItem?.id
    );

    try {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#a8f09b', '#78dc77', '#ffdcc2'],
      });
    } catch {}

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 900);
  };

  const getTypeIcon = () => {
    const green = isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]';
    const blue = isDark ? 'text-[#a8c7fa]' : 'text-[#1d4ed8]';
    const purple = isDark ? 'text-[#d0bcff]' : 'text-[#6d28d9]';
    const amber = isDark ? 'text-[#ffdcc2]' : 'text-[#b45309]';
    const rose = isDark ? 'text-[#ffb4ab]' : 'text-[#be123c]';
    if (isBarcode) return <Barcode className={`w-4 h-4 ${green}`} />;
    switch (parsed.type) {
      case 'url': return <ExternalLink className={`w-4 h-4 ${purple}`} />;
      case 'wifi': return <Wifi className={`w-4 h-4 ${blue}`} />;
      case 'vcard': return <User className={`w-4 h-4 ${rose}`} />;
      case 'ticket': return <Ticket className={`w-4 h-4 ${amber}`} />;
      case 'loyalty': return <CreditCard className={`w-4 h-4 ${green}`} />;
      case 'barcode': return <Barcode className={`w-4 h-4 ${green}`} />;
      case 'phone': return <Phone className={`w-4 h-4 ${green}`} />;
      case 'email': return <Mail className={`w-4 h-4 ${blue}`} />;
      default: return <FileText className="w-4 h-4 text-[#8e918f]" />;
    }
  };

  const primaryActionBtnClass = `w-full min-h-[44px] py-3 px-4 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm whitespace-nowrap ${
    isDark
      ? 'bg-[#244927] hover:bg-[#2f5c33] text-[#c4fbb8]'
      : 'bg-[#e8f5e9] hover:bg-[#d7eed9] text-[#1b5e20]'
  }`;

  const secondaryActionBtnClass = `min-h-[44px] py-2.5 px-3 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors active:scale-[0.98] border whitespace-nowrap ${
    isDark
      ? 'bg-[#282a2f] hover:bg-[#33353a] text-[#e3e2e6] border-white/[0.04]'
      : 'bg-[#eef1ec] hover:bg-[#e2e6df] text-[#191c19] border-black/[0.06]'
  }`;

  const renderQuickActionItem = (kind: QuickActionKind, isPrimarySlot: boolean, extraClass = '') => {
    const btnClass = `${isPrimarySlot ? primaryActionBtnClass : secondaryActionBtnClass} ${extraClass}`.trim();
    const iconAccent = isPrimarySlot
      ? isDark
        ? 'text-[#a8f09b]'
        : 'text-[#2e6c31]'
      : isDark
        ? 'text-[#c4c7c5]'
        : 'text-[#404943]';

    switch (kind) {
      case 'add_contact':
        return (
          <button key={kind} type="button" onClick={handleAddContact} className={btnClass}>
            <UserPlus className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            <span className="truncate">{t.addToContacts}</span>
          </button>
        );

      case 'call_phone': {
        if (!cleanPhone) return null;
        const telHref = buildTelUri(cleanPhone);
        if (nativeLinkEnabled) {
          return (
            <button
              key={kind}
              type="button"
              onClick={async () => {
                playTapSound();
                const res = await openExternalUrl(telHref, { mode: 'system' });
                if (!res.opened) onShowToast?.(t.unableToOpenLink);
              }}
              className={btnClass}
            >
              <Phone className={`w-4 h-4 shrink-0 ${iconAccent}`} />
              <span className="truncate">{t.callNumber}</span>
            </button>
          );
        }
        return (
          <a key={kind} href={telHref} onClick={playTapSound} className={btnClass}>
            <Phone className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            <span className="truncate">{t.callNumber}</span>
          </a>
        );
      }

      case 'send_sms': {
        if (!cleanPhone) return null;
        const smsHref = buildSmsUri(cleanPhone);
        if (nativeLinkEnabled) {
          return (
            <button
              key={kind}
              type="button"
              onClick={async () => {
                playTapSound();
                const res = await openExternalUrl(smsHref, { mode: 'system' });
                if (!res.opened) onShowToast?.(t.unableToOpenLink);
              }}
              className={btnClass}
            >
              <MessageSquare className={`w-4 h-4 shrink-0 ${iconAccent}`} />
              <span className="truncate">{t.sendSms}</span>
            </button>
          );
        }
        return (
          <a key={kind} href={smsHref} onClick={playTapSound} className={btnClass}>
            <MessageSquare className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            <span className="truncate">{t.sendSms}</span>
          </a>
        );
      }

      case 'send_email': {
        if (!cleanEmail) return null;
        const mailHref = buildMailtoUri(cleanEmail);
        if (nativeLinkEnabled) {
          return (
            <button
              key={kind}
              type="button"
              onClick={async () => {
                playTapSound();
                const res = await openExternalUrl(mailHref, { mode: 'system' });
                if (!res.opened) onShowToast?.(t.unableToOpenLink);
              }}
              className={btnClass}
            >
              <Mail className={`w-4 h-4 shrink-0 ${iconAccent}`} />
              <span className="truncate">{t.sendEmail}</span>
            </button>
          );
        }
        return (
          <a key={kind} href={mailHref} onClick={playTapSound} className={btnClass}>
            <Mail className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            <span className="truncate">{t.sendEmail}</span>
          </a>
        );
      }

      case 'copy_wifi_password': {
        if (!wifiInfo?.password) return null;
        const copied = copiedQuickKey === 'wifi_pass';
        return (
          <button
            key={kind}
            type="button"
            onClick={() => copyTextValue(wifiInfo.password, 'wifi_pass', t.wifiPassCopiedToast)}
            className={btnClass}
          >
            {copied ? (
              <Check className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            ) : (
              <KeyRound className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            )}
            <span className="truncate">{copied ? t.copiedText : t.copyWifiPassword}</span>
          </button>
        );
      }

      case 'copy_wifi_ssid': {
        if (!wifiInfo?.ssid) return null;
        const copied = copiedQuickKey === 'wifi_ssid';
        return (
          <button
            key={kind}
            type="button"
            onClick={() => copyTextValue(wifiInfo.ssid, 'wifi_ssid', t.wifiSsidCopiedToast)}
            className={btnClass}
          >
            {copied ? (
              <Check className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            ) : (
              <Wifi className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            )}
            <span className="truncate">{copied ? t.copiedText : t.copyWifiSsid}</span>
          </button>
        );
      }

      case 'open_wifi_settings':
        return (
          <button
            key={kind}
            type="button"
            onClick={async () => {
              playTapSound();
              const opened = await openDeviceWifiSettings();
              if (!opened) onShowToast?.(t.unableToOpenLink);
            }}
            className={btnClass}
          >
            <Wifi className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            <span className="truncate">{t.wifiSettingsBtn}</span>
          </button>
        );

      case 'open_link_app': {
        if (!safeActionUrl) return null;
        if (nativeLinkEnabled) {
          return (
            <button
              key={kind}
              type="button"
              onClick={async () => {
                playTapSound();
                const res = await openExternalUrl(safeActionUrl, {
                  mode: linkAction.mode,
                  packageName: linkAction.targetPackageName,
                  chooserTitle: linkAction.primaryLabel,
                });
                if (!res.opened) onShowToast?.(t.unableToOpenLink);
              }}
              className={btnClass}
            >
              {linkAction.mode === 'app' ? (
                <Smartphone className={`w-4 h-4 shrink-0 ${iconAccent}`} />
              ) : (
                <ExternalLink className={`w-4 h-4 shrink-0 ${iconAccent}`} />
              )}
              <span className="truncate">{linkAction.primaryLabel}</span>
            </button>
          );
        }
        return (
          <a
            key={kind}
            href={safeActionUrl}
            target="_blank"
            rel="noreferrer"
            onClick={playTapSound}
            className={btnClass}
          >
            <ExternalLink className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            <span className="truncate">{linkAction.primaryLabel}</span>
          </a>
        );
      }

      case 'open_link_browser':
        if (!safeActionUrl) return null;
        return (
          <button
            key={kind}
            type="button"
            onClick={async () => {
              playTapSound();
              const res = await openExternalUrl(safeActionUrl, {
                mode: 'browser',
                chooserTitle: t.openInBrowser,
              });
              if (!res.opened) onShowToast?.(t.unableToOpenLink);
            }}
            title={t.openInBrowserTooltip}
            aria-label={t.openInBrowser}
            className={btnClass}
          >
            <Globe className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            <span className="truncate">{t.openInBrowserShort}</span>
          </button>
        );

      case 'copy_link': {
        const copied = copiedQuickKey === 'link';
        return (
          <button
            key={kind}
            type="button"
            onClick={() => copyTextValue(rawContent, 'link')}
            className={btnClass}
          >
            {copied ? (
              <Check className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            ) : (
              <Copy className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            )}
            <span className="truncate">{copied ? t.copiedText : t.copyLink}</span>
          </button>
        );
      }

      case 'search_web': {
        const searchUrl = buildWebSearchUrl(rawContent);
        if (nativeLinkEnabled) {
          return (
            <button
              key={kind}
              type="button"
              onClick={async () => {
                playTapSound();
                const res = await openExternalUrl(searchUrl, {
                  mode: 'browser',
                  chooserTitle: t.searchOnline,
                });
                if (!res.opened) onShowToast?.(t.unableToOpenLink);
              }}
              className={btnClass}
            >
              <Search className={`w-4 h-4 shrink-0 ${iconAccent}`} />
              <span className="truncate">{t.searchOnline}</span>
            </button>
          );
        }
        return (
          <a
            key={kind}
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
            onClick={playTapSound}
            className={btnClass}
          >
            <Search className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            <span className="truncate">{t.searchOnline}</span>
          </a>
        );
      }

      case 'copy_text':
      default: {
        const valueToCopy =
          parsed.type === 'phone' && cleanPhone
            ? cleanPhone
            : parsed.type === 'email' && cleanEmail
              ? cleanEmail
              : rawContent;
        const label =
          parsed.type === 'phone'
            ? t.copyPhone
            : parsed.type === 'email'
              ? t.copyEmail
              : t.copyText;
        const copied = copiedQuickKey === 'quick_copy';
        return (
          <button
            key={kind}
            type="button"
            onClick={() => copyTextValue(valueToCopy, 'quick_copy')}
            className={btnClass}
          >
            {copied ? (
              <Check className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            ) : (
              <Copy className={`w-4 h-4 shrink-0 ${iconAccent}`} />
            )}
            <span className="truncate">{copied ? t.copiedText : label}</span>
          </button>
        );
      }
    }
  };

  const primaryQuickAction = plannedActions[0] ?? null;
  const secondaryQuickActions = plannedActions.slice(1);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
        role="dialog"
        aria-label="Clean Code View"
      >
        <div
          className={`w-full sm:max-w-lg rounded-t-[32px] sm:rounded-[32px] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden border ${
            isDark ? 'bg-[#1e1f23] text-[#e3e2e6] border-white/[0.06]' : 'bg-white text-[#191c19] border-black/[0.08]'
          }`}
        >
          {/* M3 Drag Handle Bar on Mobile */}
          <div className={`w-10 h-1 rounded-full mx-auto mt-2.5 sm:hidden ${isDark ? 'bg-white/20' : 'bg-black/20'}`} />

          {/* Header */}
          <div
            className={`px-6 py-4 border-b flex items-center justify-between sticky top-0 z-10 backdrop-blur ${
              isDark ? 'bg-[#1e1f23]/95 border-white/[0.04]' : 'bg-white/95 border-black/[0.06]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {getTypeIcon()}
              <div>
                <h3 className={`font-bold text-base leading-tight ${isDark ? 'text-[#e3e2e6]' : 'text-[#191c19]'}`}>
                  {isBarcode ? t.cleanBarcodeModalTitle : t.cleanModalTitle}
                </h3>
                <p className={`text-xs ${isDark ? 'text-[#8e918f]' : 'text-[#575a56]'}`}>
                  {t.cleanModalSubtitle}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                playTapSound();
                onClose();
              }}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isDark
                  ? 'bg-white/[0.04] hover:bg-white/[0.08] text-[#c4c7c5] hover:text-white'
                  : 'bg-black/[0.04] hover:bg-black/[0.08] text-[#575a56] hover:text-[#191c19]'
              }`}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="p-5 sm:p-6 overflow-y-auto space-y-4">
            {/* Pristine Reconstructed Code Card */}
            <div
              className={`flex flex-col items-center rounded-[24px] p-5 relative border ${
                isDark ? 'bg-[#1a1b1f] border-white/[0.04]' : 'bg-[#f7f9f5] border-black/[0.06]'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  playTapSound();
                  setShowTurnstile(true);
                }}
                className={`absolute top-3.5 right-3.5 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm active:scale-95 ${
                  isDark
                    ? 'bg-[#244927] hover:bg-[#2f5c33] text-[#c4fbb8]'
                    : 'bg-[#e8f5e9] hover:bg-[#d7eed9] text-[#1b5e20]'
                }`}
                title={t.fullScreenTurnstile}
              >
                <Maximize2 className={`w-3.5 h-3.5 ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`} />
                <span>{t.fullScreenTurnstile}</span>
              </button>

              <div
                className={`rounded-3xl transition-all shadow-xl my-2 border border-black/10 flex items-center justify-center ${
                  isBarcode ? 'w-full max-w-[320px] px-4 py-5 mt-8' : 'p-4 mt-7 sm:mt-5'
                }`}
                style={{ backgroundColor: bgColor }}
              >
                {dataUrl ? (
                  <img
                    src={dataUrl}
                    alt={isBarcode ? 'Pristine Barcode' : 'Pristine QR'}
                    className={
                      isBarcode
                        ? 'w-full h-36 sm:h-40 object-contain'
                        : 'w-48 h-48 sm:w-56 sm:h-56 object-contain image-rendering-pixelated'
                    }
                  />
                ) : (
                  <div className={isBarcode ? 'w-full h-36 flex items-center justify-center' : 'w-48 h-48 flex items-center justify-center'}>
                    <div className={`w-8 h-8 border-3 ${isDark ? 'border-[#a8f09b]' : 'border-[#2e6c31]'} border-t-transparent rounded-full animate-spin`} />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 mt-2 flex-wrap justify-center text-xs text-[#8e918f]">
                <span className={`font-semibold ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`}>
                  {t.vectorOriginalBadge}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {isBarcode
                    ? `${t.formatBadgeLabel}: ${getBarcodeFormatLabel(safeFormat)}`
                    : `${t.eccCorrection}: ${ecc}`}
                </span>
              </div>

              {/* Media & Edit Actions Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-1.5 w-full mt-4 pt-3.5 border-t border-white/[0.04]">
                <DownloadButton
                  defaultFormat={defaultDownloadFormat}
                  onDownload={handleDownload}
                  downloaded={isDownloaded}
                  layout="tile"
                  menuPlacement="bottom"
                  lang={lang}
                  theme={theme}
                  className="h-full"
                />
                <button
                  type="button"
                  onClick={handleCopyImage}
                  className="flex flex-col items-center justify-center py-2.5 px-2 sm:px-1 rounded-2xl bg-[#282a2f] hover:bg-[#33353a] active:scale-95 text-[#e3e2e6] text-xs sm:text-[11px] font-semibold transition-colors"
                >
                  {isCopiedImage ? (
                    <Check className={`w-4 h-4 mb-1 ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`} />
                  ) : (
                    <Copy className={`w-4 h-4 mb-1 ${isDark ? 'text-[#d0bcff]' : 'text-[#6d28d9]'}`} />
                  )}
                  <span className="leading-tight truncate max-w-full">
                    {isCopiedImage ? t.copiedImage : t.copyImage}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex flex-col items-center justify-center py-2.5 px-2 sm:px-1 rounded-2xl bg-[#282a2f] hover:bg-[#33353a] active:scale-95 text-[#e3e2e6] text-xs sm:text-[11px] font-semibold transition-colors"
                >
                  <Share2 className={`w-4 h-4 mb-1 ${isDark ? 'text-[#ffdcc2]' : 'text-[#b45309]'}`} />
                  <span className="leading-tight truncate max-w-full">{t.shareQr}</span>
                </button>
                <button
                  type="button"
                  onClick={handleEditClick}
                  className="flex flex-col items-center justify-center py-2.5 px-2 sm:px-1 rounded-2xl bg-[#282a2f] hover:bg-[#33353a] active:scale-95 text-[#e3e2e6] text-xs sm:text-[11px] font-semibold transition-colors"
                >
                  <Pencil className={`w-4 h-4 mb-1 ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`} />
                  <span className="leading-tight truncate max-w-full">{t.editCodeBtn}</span>
                </button>
              </div>
            </div>

            {/* Prominent Contextual Quick Actions */}
            {primaryQuickAction && (
              <div className="bg-[#1a1b1f] rounded-[24px] p-5 space-y-3 border border-white/[0.04]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#e3e2e6]">
                    {t.quickActionsHeader}
                  </span>
                  <span className="text-xs font-medium text-[#8e918f]">
                    {isBarcode ? getBarcodeFormatLabel(safeFormat) : parsed.type.toUpperCase()}
                  </span>
                </div>

                {renderQuickActionItem(primaryQuickAction, true)}

                {secondaryQuickActions.length > 0 && (
                  <div
                    className={`grid gap-2 ${
                      secondaryQuickActions.length === 1
                        ? 'grid-cols-1'
                        : secondaryQuickActions.length === 3
                          ? 'grid-cols-2 sm:grid-cols-3'
                          : 'grid-cols-2'
                    }`}
                  >
                    {secondaryQuickActions.map((actionKind, idx) =>
                      renderQuickActionItem(
                        actionKind,
                        false,
                        secondaryQuickActions.length === 3 && idx === 2 ? 'col-span-2 sm:col-span-1' : ''
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Decoded Content Details */}
            <div className="bg-[#1a1b1f] rounded-[24px] p-5 space-y-3 border border-white/[0.04]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-[#c4c7c5]">
                  {getTypeIcon()}
                  <span className="uppercase">
                    {isBarcode ? getBarcodeFormatLabel(safeFormat) : parsed.type.toUpperCase()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyText}
                  className={`text-xs hover:underline flex items-center gap-1 font-semibold ${
                    isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'
                  }`}
                >
                  {isCopiedText ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {isCopiedText ? t.copiedText : t.copyText}
                </button>
              </div>

              {parsed.details && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 bg-[#282a2f] rounded-2xl text-xs">
                  {Object.entries(parsed.details).map(([k, v]) => (
                    <div key={k} className="flex flex-col">
                      <span className="text-[10px] text-[#8e918f] uppercase tracking-wider">
                        {getLocalizedDetailKey(k, lang)}
                      </span>
                      <span className="font-semibold text-[#e3e2e6] select-all">
                        {getLocalizedDetailValue(v, lang)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div
                className={`p-3 rounded-2xl text-xs font-mono break-all max-h-24 overflow-y-auto select-all border ${
                  isDark
                    ? 'bg-[#121316] text-[#c4c7c5] border-white/[0.04]'
                    : 'bg-[#eef1ec] text-[#191c19] border-black/[0.06]'
                }`}
              >
                {rawContent}
              </div>
            </div>

            {/* Gallery Save & Organize Form */}
            <div className="bg-[#1a1b1f] rounded-[24px] p-5 space-y-3.5 border border-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#e3e2e6] flex items-center gap-2">
                  <BookmarkPlus className={`w-4 h-4 ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`} />
                  {t.saveToGalleryHeader}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    setIsFavorite(!isFavorite);
                  }}
                  className={`px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 text-xs font-semibold ${
                    isFavorite
                      ? isDark
                        ? 'bg-[#ffdcc2] text-[#2e1500]'
                        : 'bg-[#fef3c7] text-[#92400e]'
                      : 'bg-[#282a2f] text-[#8e918f] hover:text-[#e3e2e6]'
                  }`}
                  aria-label="Favorite"
                >
                  <Star className={`w-3.5 h-3.5 ${isFavorite ? (isDark ? 'fill-[#2e1500]' : 'fill-[#92400e]') : ''}`} />
                  <span>{isFavorite ? t.inFavorites : t.addToFavorites}</span>
                </button>
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#8e918f] block mb-1">
                  {t.qrTitleLabel}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.qrTitlePlaceholder}
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#282a2f] text-sm text-[#e3e2e6] placeholder:text-[#8e918f] focus:outline-none focus:ring-2 focus:ring-[#a8f09b] border-none"
                />
              </div>

              <div>
                <label className={`text-[11px] font-medium block mb-1.5 ${isDark ? 'text-[#8e918f]' : 'text-[#575a56]'}`}>
                  {t.folderLabel}
                </label>
                <FolderSelect
                  folders={folders}
                  selectedFolderId={folderId}
                  onSelectFolder={setFolderId}
                  lang={lang}
                  theme={theme}
                  ariaLabel={t.folderLabel}
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#8e918f] block mb-1">
                  {t.noteLabel}
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t.notePlaceholder}
                  className="w-full px-4 py-2 rounded-2xl bg-[#282a2f] text-xs text-[#e3e2e6] placeholder:text-[#8e918f] focus:outline-none focus:ring-2 focus:ring-[#a8f09b] resize-none border-none"
                />
              </div>
            </div>
          </div>

          {/* Sticky Bottom Actions */}
          <div
            className={`px-4 pt-4 safe-bottom-sheet border-t sticky bottom-0 z-10 flex gap-2.5 ${
              isDark ? 'bg-[#1e1f23] border-white/[0.04]' : 'bg-white border-black/[0.06]'
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              className={`px-5 py-3.5 rounded-full active:scale-95 font-semibold text-xs transition-all ${
                isDark ? 'bg-[#282a2f] hover:bg-[#33353a] text-[#e3e2e6]' : 'bg-[#eef1ec] hover:bg-[#e4e8e1] text-[#191c19]'
              }`}
            >
              {t.cancelBtn}
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={savedSuccess}
              className={`flex-1 py-3.5 px-6 rounded-full font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-98 transition-all ${
                isDark
                  ? 'bg-[#a8f09b] hover:brightness-105 text-[#0b3810]'
                  : 'bg-[#2e6c31] hover:bg-[#255928] text-white'
              }`}
            >
              {savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t.savedSuccessText} «{currentFolderName}»!</span>
                </>
              ) : (
                <>
                  <BookmarkPlus className="w-4 h-4" />
                  <span>{existingItem ? t.updateBtn : t.saveBtn}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <TurnstileModal
        isOpen={showTurnstile}
        onClose={() => setShowTurnstile(false)}
        title={title || parsed.displayTitle}
        rawContent={rawContent}
        codeFormat={safeFormat}
        folderName={currentFolderName}
        lang={lang}
      />
    </>
  );
}
