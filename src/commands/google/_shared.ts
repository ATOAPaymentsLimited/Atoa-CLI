/** The Google Places fields worth showing; the raw result carries a good deal more. */
export interface GooglePlace {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
}

/**
 * Trims a Places result for terminal display. The raw record carries geometry, viewports, photo
 * references and icon URLs — none of which help anyone choose a listing, and which bury the two
 * fields that do: the name and the address.
 */
export function projectPlace(p: GooglePlace): Record<string, unknown> {
  return {
    placeId: p.place_id,
    name: p.name,
    address: p.formatted_address,
    rating: p.rating,
    reviews: p.user_ratings_total,
    status: p.business_status
  };
}

/** One line per listing, for a picker where the address is what disambiguates two same-named shops. */
export function placeLabel(p: GooglePlace): string {
  const rating = p.rating ? ` ★${p.rating}` : "";
  return `${p.name ?? "(unnamed)"}${rating} — ${p.formatted_address ?? ""}`;
}
