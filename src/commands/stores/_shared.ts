interface StoreRow {
  id?: string;
  locationName?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressPostalCode?: string;
  cityOrTown?: string;
  primary?: boolean;
  enabled?: boolean;
  bankAccount?: {bankName?: string; maskedAccountNumber?: string; accountNumber?: string};
}

/**
 * Trims a store to what is readable in a terminal.
 *
 * The raw record carries the whole linked bank account and every uploaded image as nested
 * objects, plus created/updated timestamps — thirteen columns, two of them JSON blobs. Only the
 * bank's name and masked number survive here; the full number is never printed.
 */
export function projectStore(row: StoreRow): Record<string, unknown> {
  const bank = row.bankAccount;
  const masked = bank?.maskedAccountNumber ?? maskNumber(bank?.accountNumber);

  return {
    id: row.id,
    locationName: row.locationName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    addressPostalCode: row.addressPostalCode,
    cityOrTown: row.cityOrTown,
    primary: row.primary,
    enabled: row.enabled,
    bankAccount: [bank?.bankName, masked].filter(Boolean).join("  ·  ")
  };
}

function maskNumber(full: string | undefined): string | undefined {
  const s = full?.trim();
  return s && s.length >= 4 ? `••••${s.slice(-4)}` : undefined;
}
