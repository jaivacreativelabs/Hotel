import { useEffect } from 'react';

/**
 * Puts a class on <html> while the component is on screen. Styles that depend on what the page
 * contains use it instead of CSS `:has()`, which older browsers (Safari < 15.4, Firefox < 121)
 * ignore.
 */
export function useRootClass(name: string, on = true) {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.classList.add(name);
    return () => root.classList.remove(name);
  }, [name, on]);
}
