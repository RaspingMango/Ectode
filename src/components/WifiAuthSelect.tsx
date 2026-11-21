import { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  KeyRound,
  LockOpen,
  ChevronDown,
  Check,
} from 'lucide-react';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { ThemeMode } from '../utils/theme';
import { playTapSound, triggerHaptic } from '../utils/audio';

export type WifiAuthOption = 'WPA' | 'WEP' | 'nopass';

interface WifiAuthSelectProps {
  value: WifiAuthOption;
  onChange: (value: WifiAuthOption) => void;
  lang?: Language;
  theme?: ThemeMode;
  className?: string;
}

export function WifiAuthSelect({
  value,
  onChange,
  lang = 'ru',
  theme = 'dark',
  className = '',
}: WifiAuthSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = theme === 'dark';
  const t = TRANSLATIONS[lang];

  const options: Array<{
    id: WifiAuthOption;
    label: string;
    description: string;
    icon: typeof ShieldCheck;
    iconBgDark: string;
    iconBgLight: string;
  }> = [
    {
      id: 'WPA',
      label: 'WPA/WPA2/WPA3',
      description: t.wifiAuthWpaDesc,
      icon: ShieldCheck,
      iconBgDark: 'bg-[#a8f09b]/15 text-[#a8f09b]',
      iconBgLight: 'bg-[#e8f5e9] text-[#2e6c31]',
    },
    {
      id: 'WEP',
      label: 'WEP',
      description: t.wifiAuthWepDesc,
      icon: KeyRound,
      iconBgDark: 'bg-[#ffdcc2]/15 text-[#ffdcc2]',
      iconBgLight: 'bg-[#fef3c7] text-[#b45309]',
    },
    {
      id: 'nopass',
      label: t.wifiAuthOpenLabel,
      description: t.wifiAuthOpenDesc,
      icon: LockOpen,
      iconBgDark: 'bg-[#a8c7fa]/15 text-[#a8c7fa]',
      iconBgLight: 'bg-[#e8f0fe] text-[#1d4ed8]',
    },
  ];

  const activeOption = options.find((opt) => opt.id === value) || options[0];
  const ActiveIcon = activeOption.icon;

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleToggle = () => {
    playTapSound();
    triggerHaptic(10);
    setIsOpen((prev) => !prev);
  };

  const handleSelect = (nextValue: WifiAuthOption) => {
    playTapSound();
    triggerHaptic(15);
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={t.wifiAuthLabel.replace(/:$/, '')}
        className={`w-full px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-2 transition-all duration-200 border text-left cursor-pointer outline-none focus:ring-2 ${
          isOpen
            ? isDark
              ? 'bg-[#282a2f] border-[#a8f09b] text-[#e3e2e6] ring-2 ring-[#a8f09b]'
              : 'bg-[#eef1ec] border-[#2e6c31] text-[#191c19] ring-2 ring-[#2e6c31]'
            : isDark
              ? 'bg-[#282a2f] hover:bg-[#33353a] border-white/[0.06] text-[#e3e2e6] focus:ring-[#a8f09b]'
              : 'bg-[#eef1ec] hover:bg-[#e4e8e1] border-black/[0.06] text-[#191c19] focus:ring-[#2e6c31]'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
              isDark ? activeOption.iconBgDark : activeOption.iconBgLight
            }`}
          >
            <ActiveIcon className="w-4 h-4" />
          </div>
          <span className="font-semibold text-xs truncate">
            {activeOption.label}
          </span>
        </div>

        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : 'rotate-0'
          } ${isDark ? 'text-[#8e918f]' : 'text-[#575a56]'}`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={t.wifiAuthLabel.replace(/:$/, '')}
          className={`absolute left-0 min-w-[268px] max-w-[calc(100vw-3rem)] sm:w-full top-full mt-1.5 z-50 rounded-2xl p-1.5 shadow-2xl border space-y-1 animate-in fade-in zoom-in-95 duration-150 ${
            isDark
              ? 'bg-[#1e1f23] border-white/[0.08] text-[#e3e2e6]'
              : 'bg-white border-black/[0.08] text-[#191c19]'
          }`}
        >
          {options.map((opt) => {
            const isSelected = opt.id === value;
            const Icon = opt.icon;

            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.id)}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-left transition-colors duration-150 ${
                  isSelected
                    ? isDark
                      ? 'bg-[#394738] text-[#a8f09b]'
                      : 'bg-[#e8f5e9] text-[#2e6c31]'
                    : isDark
                      ? 'hover:bg-[#282a2f] text-[#e3e2e6]'
                      : 'hover:bg-[#f1f4ee] text-[#191c19]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                      isDark ? opt.iconBgDark : opt.iconBgLight
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight truncate">
                      {opt.label}
                    </div>
                    <div
                      className={`text-[10px] leading-snug truncate mt-0.5 ${
                        isSelected
                          ? isDark ? 'text-[#c4fbb8]/80' : 'text-[#2e6c31]/80'
                          : isDark ? 'text-[#8e918f]' : 'text-[#575a56]'
                      }`}
                    >
                      {opt.description}
                    </div>
                  </div>
                </div>

                {isSelected && (
                  <Check className={`w-4 h-4 shrink-0 ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
