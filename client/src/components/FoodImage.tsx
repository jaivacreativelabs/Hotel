import { UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';

/**
 * Food photo. Without a photo it shows the category's picture (emoji) so staff can still
 * recognise the dish at a glance, and a fork-and-knife only when nothing else is known.
 */
export function FoodImage({ src, alt, emoji }: { src: string | null | undefined; alt: string; emoji?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <div className="food-placeholder" role="img" aria-label={alt}>
        {emoji ? <span className="food-emoji">{emoji}</span> : <UtensilsCrossed />}
      </div>
    );
  }
  return <img className="food-img" src={src} alt={alt} loading="lazy" onError={() => setFailed(src)} />;
}
