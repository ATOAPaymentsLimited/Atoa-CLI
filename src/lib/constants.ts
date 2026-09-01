export const DEFAULT_PHONE_COUNTRY_CODE = "44";

/**
 * Stores are fetched 200 at a time. `fetchAllPages` pages through everything at any size, but
 * store lists are the ones read whole — every store picker loads the full set.
 */
export const STORES_PAGE_SIZE = 200;

/**
 * The location every business starts with. It can be renamed but not chosen as a new store's
 * name, so both rules compare against this rather than each spelling their own literal.
 */
export const DEFAULT_STORE_NAME = "DEFAULT";
