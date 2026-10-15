import {
  foliateInteractionLimits,
  isInteractiveTarget,
  type PointerStart,
} from './foliate-reader-support';

export type PageTurnDirection = 'next' | 'previous';

/**
 * Turns wheel input and horizontal touch swipes inside rendered section
 * documents into throttled page turns. One instance is shared by every
 * section of a book so the cooldown and gesture state stay consistent.
 */
export class PageTurnGestures {
  private lockedUntil = 0;
  private readonly navigate: (direction: PageTurnDirection) => Promise<void>;
  private readonly now: () => number;
  private pointerStart: PointerStart | null = null;
  private wheelDelta = 0;
  private wheelResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    navigate: (direction: PageTurnDirection) => Promise<void>,
    now: () => number = Date.now,
  ) {
    this.navigate = navigate;
    this.now = now;
  }

  /** Listens to one section document; the returned function detaches it. */
  attach(doc: Document): () => void {
    const handleWheel = (event: WheelEvent) => {
      this.handleWheel(event);
    };
    const handlePointerDown = (event: PointerEvent) => {
      this.handlePointerDown(event);
    };
    const handlePointerUp = (event: PointerEvent) => {
      this.handlePointerUp(doc, event);
    };
    const cancelPointer = () => {
      this.pointerStart = null;
    };
    doc.addEventListener('wheel', handleWheel, { passive: false });
    doc.addEventListener('pointerdown', handlePointerDown);
    doc.addEventListener('pointerup', handlePointerUp);
    doc.addEventListener('pointercancel', cancelPointer);
    return () => {
      doc.removeEventListener('wheel', handleWheel);
      doc.removeEventListener('pointerdown', handlePointerDown);
      doc.removeEventListener('pointerup', handlePointerUp);
      doc.removeEventListener('pointercancel', cancelPointer);
    };
  }

  /** Clears partial gestures, e.g. when the book closes. */
  reset(): void {
    this.pointerStart = null;
    this.wheelDelta = 0;
    if (this.wheelResetTimer) clearTimeout(this.wheelResetTimer);
    this.wheelResetTimer = null;
  }

  private handleWheel(event: WheelEvent): void {
    if (event.ctrlKey || isInteractiveTarget(event.target)) return;
    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    if (!Number.isFinite(delta) || delta === 0) return;
    event.preventDefault();
    if (this.now() < this.lockedUntil) return;
    this.wheelDelta += delta;
    if (this.wheelResetTimer) clearTimeout(this.wheelResetTimer);
    this.wheelResetTimer = setTimeout(() => {
      this.wheelDelta = 0;
      this.wheelResetTimer = null;
    }, 180);
    if (Math.abs(this.wheelDelta) < foliateInteractionLimits.wheelThreshold) {
      return;
    }
    const direction = this.wheelDelta > 0 ? 'next' : 'previous';
    this.wheelDelta = 0;
    this.turn(direction);
  }

  private handlePointerDown(event: PointerEvent): void {
    if (
      event.pointerType !== 'touch' ||
      event.button !== 0 ||
      isInteractiveTarget(event.target)
    ) {
      this.pointerStart = null;
      return;
    }
    this.pointerStart = { x: event.clientX, y: event.clientY };
  }

  private handlePointerUp(doc: Document, event: PointerEvent): void {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || event.pointerType !== 'touch') return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (
      Math.abs(deltaX) < foliateInteractionLimits.swipeThreshold ||
      Math.abs(deltaX) <= Math.abs(deltaY) * 1.2 ||
      !doc.getSelection()?.isCollapsed
    ) {
      return;
    }
    event.preventDefault();
    this.turn(deltaX < 0 ? 'next' : 'previous');
  }

  private turn(direction: PageTurnDirection): void {
    if (this.now() < this.lockedUntil) return;
    this.lockedUntil = this.now() + foliateInteractionLimits.cooldown;
    void this.navigate(direction).catch(() => undefined);
  }
}
