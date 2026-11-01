import type { MouseEvent, PointerEvent, TouchEvent } from 'react';

/**
 * Props for buttons that are tapped fast and often (adding dishes, + / −).
 *
 * iPad Safari only clicks a while after the finger lifts, and a second quick tap on the same
 * spot is taken as a double tap, so it never clicks at all: dishes tapped in a row went missing
 * or arrived late. Here a finger (or pencil) acts the moment it lifts – unless the touch became
 * a scroll – and the browser's own click that follows is dropped. Mouse and keyboard still click.
 */
export function tapProps<T extends HTMLElement>(onTap: () => void) {
  return {
    onPointerDown: (e: PointerEvent<T>) => {
      if (e.pointerType !== 'mouse') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    },
    onPointerCancel: (e: PointerEvent<T>) => {
      touches.delete(e.pointerId); // it became a scroll
    },
    onPointerUp: (e: PointerEvent<T>) => {
      const start = touches.get(e.pointerId);
      touches.delete(e.pointerId);
      if (!start || Math.abs(e.clientX - start.x) > SLOP || Math.abs(e.clientY - start.y) > SLOP) return;
      if ((e.currentTarget as HTMLElement & { disabled?: boolean }).disabled) return;
      tappedAt.set(e.currentTarget, Date.now());
      onTap();
    },
    onTouchEnd: (e: TouchEvent<T>) => {
      // No click and no double-tap after a tap that already counted.
      if (takeTap(e.currentTarget)) e.preventDefault();
    },
    onClick: (e: MouseEvent<T>) => {
      if (!takeTap(e.currentTarget)) onTap();
    },
  };
}

/** How far a finger may move (CSS px) and still count as a tap. */
const SLOP = 10;
const touches = new Map<number, { x: number; y: number }>();
const tappedAt = new WeakMap<EventTarget, number>();
/** Whether the element was just tapped; a tap stops only the one touchend or click that follows it. */
const takeTap = (el: EventTarget) => {
  const at = tappedAt.get(el);
  tappedAt.delete(el);
  return at !== undefined && Date.now() - at < 800;
};
