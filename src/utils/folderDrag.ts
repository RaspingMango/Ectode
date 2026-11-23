export interface SlotRect {
  top: number;
  height: number;
}

export interface DragBounds {
  minOffsetY: number;
  maxOffsetY: number;
}

/**
 * Computes safe vertical translation bounds for a dragged row so it stays
 * strictly within the list's first-to-last slot span and visible scroll viewport.
 */
export function computeDragBounds(
  slots: SlotRect[],
  initialIndex: number,
  viewportTop?: number,
  viewportBottom?: number
): DragBounds {
  if (
    slots.length === 0 ||
    initialIndex < 0 ||
    initialIndex >= slots.length
  ) {
    return { minOffsetY: 0, maxOffsetY: 0 };
  }

  const firstTop = slots[0].top;
  const lastSlot = slots[slots.length - 1];
  const lastBottom = lastSlot.top + lastSlot.height;
  const dragged = slots[initialIndex];

  const minTop =
    viewportTop !== undefined ? Math.max(firstTop, viewportTop) : firstTop;
  const maxBottom =
    viewportBottom !== undefined
      ? Math.min(lastBottom, viewportBottom)
      : lastBottom;

  const minOffsetY = Math.min(0, minTop - dragged.top);
  const maxOffsetY = Math.max(0, maxBottom - dragged.height - dragged.top);

  return { minOffsetY, maxOffsetY };
}

/**
 * Clamps a raw drag Y offset inside the computed drag bounds.
 */
export function clampDragOffset(rawOffsetY: number, bounds: DragBounds): number {
  return Math.max(bounds.minOffsetY, Math.min(bounds.maxOffsetY, rawOffsetY));
}

/**
 * Computes the destination slot index deterministically from static initial
 * slot positions and the current clamped drag offset (never reads transformed DOM).
 */
export function computeDragTargetIndex(
  slots: SlotRect[],
  initialIndex: number,
  clampedOffsetY: number
): number {
  if (slots.length <= 1) return 0;
  const safeInitial = Math.max(0, Math.min(slots.length - 1, initialIndex));
  const dragged = slots[safeInitial];
  const dragCenterY = dragged.top + dragged.height / 2 + clampedOffsetY;

  let target = 0;
  for (let i = 0; i < slots.length - 1; i++) {
    const centerA = slots[i].top + slots[i].height / 2;
    const centerB = slots[i + 1].top + slots[i + 1].height / 2;
    const midpoint = (centerA + centerB) / 2;
    if (dragCenterY > midpoint) {
      target = i + 1;
    }
  }
  return target;
}

/**
 * Computes the CSS translateY shift for a non-dragged sibling row while
 * dragging `initialIndex` over `targetIndex`.
 */
export function computeSiblingShiftY(
  itemIndex: number,
  initialIndex: number,
  targetIndex: number,
  slots: SlotRect[]
): number {
  if (
    itemIndex === initialIndex ||
    initialIndex === targetIndex ||
    slots.length < 2
  ) {
    return 0;
  }

  const slotStep =
    initialIndex < slots.length - 1
      ? slots[initialIndex + 1].top - slots[initialIndex].top
      : slots[initialIndex].top - slots[initialIndex - 1].top;

  if (initialIndex < targetIndex) {
    if (itemIndex > initialIndex && itemIndex <= targetIndex) {
      return -slotStep;
    }
  } else if (targetIndex < initialIndex) {
    if (itemIndex >= targetIndex && itemIndex < initialIndex) {
      return slotStep;
    }
  }

  return 0;
}
