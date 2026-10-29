/**
 * The app shows restaurants, not branches: each restaurant runs as one branch inside. A branch is
 * named on screen by its restaurant, plus its own name only when it has one of its own (an older
 * restaurant with several branches, e.g. "Idly Tiffin House · Anna Nagar").
 */
export function placeName(restaurantName: string, branchName: string): string {
  const own = branchName.trim();
  if (!own || own === 'Main Branch' || own.toLowerCase() === restaurantName.trim().toLowerCase()) return restaurantName;
  return `${restaurantName} · ${own}`;
}

/** A branch's own name, or "" when it is just the restaurant (see placeName). */
export function ownBranchName(restaurantName: string, branchName: string): string {
  const name = placeName(restaurantName, branchName);
  return name === restaurantName ? '' : branchName.trim();
}
