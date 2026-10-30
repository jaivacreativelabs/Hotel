/**
 * Drag things into a new order, like app icons on a phone: press and hold (touch) or click and
 * drag (mouse). A quick tap or click still works as usual, and a page can still be scrolled.
 */
import { closestCenter, DndContext, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, horizontalListSortingStrategy, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/format';

export function SortableList({
  ids,
  onReorder,
  layout = 'grid',
  children,
}: {
  ids: string[];
  /** the ids in their new order, after a drop that moved something */
  onReorder: (ids: string[]) => void;
  /** grid: the menu cards; row: the category chips */
  layout?: 'grid' | 'row';
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
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={layout === 'row' ? horizontalListSortingStrategy : rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

type ItemProps = { id: string; className?: string; children: ReactNode } & (
  | ({ as?: 'div' } & HTMLAttributes<HTMLDivElement>)
  | ({ as: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>)
);

/** One thing in a SortableList. Its buttons keep working; a drop never counts as a tap on them. */
export function SortableItem({ id, className, children, as = 'div', ...rest }: ItemProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
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

/** The whole list's new order when only some of it was shown (one category, a search): the shown ones swap among the places they held. */
export function mergeOrder(all: string[], shownInNewOrder: string[]): string[] {
  const shown = new Set(shownInNewOrder);
  let k = 0;
  return all.map((id) => (shown.has(id) ? shownInNewOrder[k++] : id));
}
