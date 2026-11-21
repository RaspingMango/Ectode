import { useEffect, useRef, useState } from 'react';
import { FolderCog, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Folder } from '../utils/qrLogic';
import { Language, TRANSLATIONS, formatCodeCount, getLocalizedFolderName } from '../utils/i18n';
import { ThemeMode } from '../utils/theme';
import { playTapSound, triggerHaptic } from '../utils/audio';
import { getFolderIcon } from './FolderSelect';

interface ManageFoldersModalProps {
  isOpen: boolean;
  folders: Folder[];
  folderCounts: Record<string, number>;
  lang?: Language;
  theme?: ThemeMode;
  onClose: () => void;
  onOpenCreateFolder: () => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folderId: string) => void;
  onReorderFolders: (fromIndex: number, toIndex: number) => void;
}

const HOLD_TO_DRAG_MS = 200;
const GRIP_HOLD_TO_DRAG_MS = 50;
const CANCEL_SCROLL_THRESHOLD_PX = 8;

export function ManageFoldersModal({
  isOpen,
  folders,
  folderCounts,
  lang = 'ru',
  theme = 'dark',
  onClose,
  onOpenCreateFolder,
  onEditFolder,
  onDeleteFolder,
  onReorderFolders,
}: ManageFoldersModalProps) {
  const isDark = theme === 'dark';
  const t = TRANSLATIONS[lang];

  const [folderPendingDelete, setFolderPendingDelete] = useState<Folder | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  const foldersRef = useRef<Folder[]>(folders);
  foldersRef.current = folders;

  const onReorderRef = useRef(onReorderFolders);
  onReorderRef.current = onReorderFolders;

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dragAnchorYRef = useRef<number>(0);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      clearHoldTimer();
      draggingIdRef.current = null;
      setDraggingFolderId(null);
      setDragOffsetY(0);
      setFolderPendingDelete(null);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      clearHoldTimer();
    };
  }, []);

  if (!isOpen) return null;

  const startDrag = (folderId: string, clientY: number) => {
    clearHoldTimer();
    draggingIdRef.current = folderId;
    dragAnchorYRef.current = clientY;
    setDraggingFolderId(folderId);
    setDragOffsetY(0);
    setFolderPendingDelete(null);
    playTapSound();
    triggerHaptic(25);
  };

  const handleRowPointerDown = (
    e: React.PointerEvent<HTMLElement>,
    folder: Folder,
    isGripHandle: boolean
  ) => {
    if (e.button !== 0 || foldersRef.current.length < 2) return;
    if (!isGripHandle && (e.target as HTMLElement).closest('button')) {
      return;
    }

    if (isGripHandle) {
      e.stopPropagation();
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const activePointerId = e.pointerId;
    let latestY = startY;
    let cleanedUp = false;

    clearHoldTimer();

    holdTimerRef.current = setTimeout(() => {
      if (!cleanedUp) {
        startDrag(folder.id, latestY);
      }
    }, isGripHandle ? GRIP_HOLD_TO_DRAG_MS : HOLD_TO_DRAG_MS);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== activePointerId) return;
      latestY = moveEvent.clientY;

      if (!draggingIdRef.current) {
        const dx = Math.abs(moveEvent.clientX - startX);
        const dy = Math.abs(moveEvent.clientY - startY);

        if (isGripHandle && dy > 4) {
          startDrag(folder.id, moveEvent.clientY);
          return;
        }

        if (dx > CANCEL_SCROLL_THRESHOLD_PX || dy > CANCEL_SCROLL_THRESHOLD_PX) {
          cleanup();
        }
        return;
      }

      moveEvent.preventDefault();

      const activeId = draggingIdRef.current;
      const list = foldersRef.current;
      const currentIdx = list.findIndex((item) => item.id === activeId);
      if (currentIdx === -1) return;

      const currentEl = rowRefs.current[activeId];
      if (!currentEl) return;
      const currentRect = currentEl.getBoundingClientRect();

      let targetIdx = currentIdx;
      let targetRect: DOMRect | null = null;

      if (currentIdx > 0) {
        const prevFolder = list[currentIdx - 1];
        const prevEl = rowRefs.current[prevFolder.id];
        if (prevEl) {
          const prevRect = prevEl.getBoundingClientRect();
          const prevMidY = prevRect.top + prevRect.height / 2;
          if (moveEvent.clientY < prevMidY) {
            targetIdx = currentIdx - 1;
            targetRect = prevRect;
          }
        }
      }

      if (targetIdx === currentIdx && currentIdx < list.length - 1) {
        const nextFolder = list[currentIdx + 1];
        const nextEl = rowRefs.current[nextFolder.id];
        if (nextEl) {
          const nextRect = nextEl.getBoundingClientRect();
          const nextMidY = nextRect.top + nextRect.height / 2;
          if (moveEvent.clientY > nextMidY) {
            targetIdx = currentIdx + 1;
            targetRect = nextRect;
          }
        }
      }

      if (targetIdx !== currentIdx && targetRect) {
        const slotDelta = targetRect.top - currentRect.top;
        dragAnchorYRef.current += slotDelta;
        triggerHaptic(12);
        onReorderRef.current(currentIdx, targetIdx);
      }

      setDragOffsetY(moveEvent.clientY - dragAnchorYRef.current);
    };

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearHoldTimer();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      if (draggingIdRef.current === folder.id) {
        draggingIdRef.current = null;
        setDraggingFolderId(null);
        setDragOffsetY(0);
      }
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== activePointerId) return;
      cleanup();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  };

  const handleGripKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      playTapSound();
      triggerHaptic(15);
      onReorderFolders(index, index - 1);
    } else if (e.key === 'ArrowDown' && index < folders.length - 1) {
      e.preventDefault();
      playTapSound();
      triggerHaptic(15);
      onReorderFolders(index, index + 1);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={t.manageFoldersTitle}
      onClick={() => {
        setFolderPendingDelete(null);
        onClose();
      }}
    >
      <div
        className={`w-full max-w-md rounded-[28px] p-6 shadow-2xl space-y-4 border max-h-[88vh] flex flex-col ${
          isDark ? 'bg-[#1e1f23] text-[#e3e2e6] border-white/[0.08]' : 'bg-white text-[#191c19] border-black/[0.08]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${
              isDark ? 'bg-[#244927] text-[#a8f09b]' : 'bg-[#e8f5e9] text-[#2e6c31]'
            }`}>
              <FolderCog className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-base leading-tight truncate">
                {t.manageFoldersTitle}
              </h3>
              <p className={`text-[11px] leading-snug mt-0.5 ${isDark ? 'text-[#8e918f]' : 'text-[#575a56]'}`}>
                {t.manageFoldersDesc}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              playTapSound();
              setFolderPendingDelete(null);
              onClose();
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
              isDark ? 'bg-white/[0.04] hover:bg-white/[0.08] text-[#c4c7c5]' : 'bg-black/[0.04] hover:bg-black/[0.08] text-[#575a56]'
            }`}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Inline Folder Delete Confirmation */}
        {folderPendingDelete && (
          <div className={`p-3.5 rounded-2xl border space-y-2.5 animate-in fade-in ${
            isDark
              ? 'bg-[#371e1d] text-[#ffdad6] border-[#ffb4ab]/25'
              : 'bg-[#fde8e8] text-[#690005] border-[#b3261e]/20'
          }`}>
            <div className="space-y-0.5">
              <div className="text-xs font-bold">
                {t.deleteFolderTitle} «{getLocalizedFolderName(folderPendingDelete.id, folderPendingDelete.name, lang)}»
              </div>
              <p className={`text-[11px] leading-relaxed ${isDark ? 'text-[#ffdad6]/85' : 'text-[#690005]/85'}`}>
                {t.deleteFolderConfirm}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  playTapSound();
                  setFolderPendingDelete(null);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold ${
                  isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'
                }`}
              >
                {t.cancelBtn}
              </button>
              <button
                type="button"
                onClick={() => {
                  playTapSound();
                  onDeleteFolder(folderPendingDelete.id);
                  setFolderPendingDelete(null);
                }}
                className={`px-4 py-1.5 rounded-full text-xs font-bold hover:brightness-105 ${
                  isDark ? 'bg-[#ffb4ab] text-[#690005]' : 'bg-[#b3261e] text-white'
                }`}
              >
                {t.deleteBtn}
              </button>
            </div>
          </div>
        )}

        {/* Reorderable Folder List */}
        <div
          className="overflow-y-auto space-y-2 pr-1 select-none"
          style={{ touchAction: draggingFolderId ? 'none' : 'pan-y' }}
        >
          {folders.map((f, index) => {
            const localizedName = getLocalizedFolderName(f.id, f.name, lang);
            const count = folderCounts[f.id] || 0;
            const canDelete = folders.length > 1;
            const isDragging = draggingFolderId === f.id;

            return (
              <div
                key={f.id}
                ref={(el) => {
                  rowRefs.current[f.id] = el;
                }}
                data-folder-id={f.id}
                onPointerDown={(e) => handleRowPointerDown(e, f, false)}
                onContextMenu={(e) => e.preventDefault()}
                style={
                  isDragging
                    ? { transform: `translateY(${dragOffsetY}px) scale(1.02)` }
                    : undefined
                }
                className={`p-3 rounded-2xl flex items-center justify-between gap-2 border select-none ${
                  isDragging
                    ? `relative z-20 shadow-2xl ${
                        isDark
                          ? 'bg-[#33353a] border-[#a8f09b] ring-2 ring-[#a8f09b]/35'
                          : 'bg-white border-[#2e6c31] ring-2 ring-[#2e6c31]/25'
                      }`
                    : `transition-transform duration-150 ${
                        isDark ? 'bg-[#282a2f] border-white/[0.04]' : 'bg-[#f7f9f5] border-black/[0.06]'
                      }`
                } ${folders.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {folders.length > 1 && (
                    <button
                      type="button"
                      onPointerDown={(e) => handleRowPointerDown(e, f, true)}
                      onKeyDown={(e) => handleGripKeyDown(e, index)}
                      className={`p-1 -ml-1 rounded-lg touch-none shrink-0 transition-colors cursor-grab active:cursor-grabbing ${
                        isDragging
                          ? isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'
                          : isDark ? 'text-[#8e918f] hover:text-[#c4c7c5]' : 'text-[#747775] hover:text-[#191c19]'
                      }`}
                      title={t.reorderFolderHint}
                      aria-label={`${t.reorderFolderHint}: ${localizedName}`}
                    >
                      <GripVertical className="w-4 h-4" />
                    </button>
                  )}

                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: `${f.color}22`,
                      color: f.color,
                    }}
                  >
                    {getFolderIcon(f, 'w-4 h-4')}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">
                      {localizedName}
                    </div>
                    <div className={`text-[10px] ${isDark ? 'text-[#8e918f]' : 'text-[#575a56]'}`}>
                      {formatCodeCount(count, lang)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      playTapSound();
                      setFolderPendingDelete(null);
                      onClose();
                      onEditFolder(f);
                    }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                      isDark ? 'bg-[#1e1f23] hover:bg-[#33353a] text-[#c4c7c5]' : 'bg-white hover:bg-[#e2e6df] text-[#404943]'
                    }`}
                    title={t.editFolderTooltip}
                    aria-label={`${t.editFolderTooltip}: ${localizedName}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    disabled={!canDelete}
                    onClick={() => {
                      playTapSound();
                      setFolderPendingDelete(f);
                    }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-35 ${
                      isDark
                        ? 'bg-[#1e1f23] hover:bg-[#93000a] text-[#c4c7c5] hover:text-[#ffdad6]'
                        : 'bg-white hover:bg-[#fde8e8] text-[#404943] hover:text-[#b3261e]'
                    }`}
                    title={canDelete ? t.deleteFolderTooltip : t.cannotDeleteLastFolder}
                    aria-label={`${t.deleteFolderTooltip}: ${localizedName}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-1 flex gap-2">
          <button
            type="button"
            onClick={() => {
              playTapSound();
              setFolderPendingDelete(null);
              onClose();
              onOpenCreateFolder();
            }}
            className={`flex-1 py-3 px-4 rounded-full font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-95 ${
              isDark
                ? 'bg-[#a8f09b] hover:brightness-105 text-[#0b3810]'
                : 'bg-[#2e6c31] hover:bg-[#255928] text-white'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>{t.newFolderChip}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
