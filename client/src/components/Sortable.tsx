/**
 * Drag things into a new order, like app icons on a phone: press and hold (touch) or click and
 * drag (mouse). A quick tap or click still works as usual, and a page can still be scrolled.
 */
import { closestCenter, DndContext, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { arrayMove, horizontalListSortingStrategy, rectSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/format';

/**
 * The dragged thing stays on screen: inside the area that scrolls around it (the menu page, the
 * chips row, the Categories panel), never over the header or off the edge. A chip only slides
 * along its row and a list row only up and down.
 */
const keepInView =
  (layout: 'grid' | 'row' | 'column'): Modifier =>
  ({ transform, draggingNodeRect: rect, scrollableAncestors }) => {
    if (!rect) return transform;
    // Its visible inside, without the scrollbars: a card reaching under one widened the page,
    // which then scrolled sideways.
    const area = scrollableAncestors[0];
    const outer = area && area !== document.scrollingElement ? area.getBoundingClientRect() : { left: 0, top: 0 };
    const box = area
      ? { left: outer.left + area.clientLeft, top: outer.top + area.clientTop, width: area.clientWidth, height: area.clientHeight }
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
    return {
      ...transform,
      x: layout === 'column' ? 0 : clamp(transform.x, box.left - rect.left, box.left + box.width - rect.right),
      y: layout === 'row' ? 0 : clamp(transform.y, box.top - rect.top, box.top + box.height - rect.bottom),
    };
  };

export function SortableList({
  ids,
  onReorder,
  layout = 'grid',
  children,
}: {
  ids: string[];
  /** the ids in their new order, after a drop that moved something */
  onReorder: (ids: string[]) => void;
  /** grid: the menu cards; row: the category chips; column: a list (the Categories panel) */
  layout?: 'grid' | 'row' | 'column';
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Hold first, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  const modifiers = useMemo(() => [keepInView(layout)], [layout]);
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={modifiers} onDragEnd={onDragEnd}>
      <SortableContext
        items={ids}
        strategy={layout === 'row' ? horizontalListSortingStrategy : layout === 'column' ? verticalListSortingStrategy : rectSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

type ItemProps = { id: string; className?: string; children: ReactNode; /** stays put (e.g. while being renamed) */ disabled?: boolean } & (
  | ({ as?: 'div' } & HTMLAttributes<HTMLDivElement>)
  | ({ as: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>)
);

/** One thing in a SortableList. Its buttons keep working; a drop never counts as a tap on them. */
export function SortableItem({ id, className, children, as = 'div', disabled, ...rest }: ItemProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  // The dragged card stays under the finger / mouse, so letting go would also "click" what is under it.
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
    else {
      const t = setTimeout(() => (dragged.current = false), 100);
      return () => clearTimeout(t);
    }
  }, [isDragging]);
  const props = {
    ...rest,
    ...listeners,
    ref: setNodeRef,
    className: cx('sortable', className, isDragging && 'dragging'),
    style: { transform: CSS.Translate.toString(transform), transition },
    onClickCapture: (e: React.MouseEvent) => {
      if (!dragged.current) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onDragStart: (e: React.DragEvent) => e.preventDefault(), // no browser image dragging
  };
  return as === 'button' ? (
    <button type="button" {...(props as ButtonHTMLAttributes<HTMLButtonElement>)} ref={setNodeRef}>
      {children}
    </button>
  ) : (
    <div {...(props as HTMLAttributes<HTMLDivElement>)} ref={setNodeRef}>
      {children}
    </div>
  );
}

/** The list sorted as `ids` says (anything not in it goes last), e.g. to show a new order at once. */
export function byOrder<T extends { id: string }>(list: T[], ids: string[]): T[] {
  const at = new Map(ids.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
}

/** The whole list's new order when only some of it was shown (one category, a search): the shown ones swap among the places they held. */
export function mergeOrder(all: string[], shownInNewOrder: string[]): string[] {
  const shown = new Set(shownInNewOrder);
  let k = 0;
  return all.map((id) => (shown.has(id) ? shownInNewOrder[k++] : id));
}
