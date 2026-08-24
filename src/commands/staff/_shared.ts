/**
 * Extracts all values for a repeated flag from raw CLI args — citty collapses repeats to the
 * last value, so `--store a --store b` has to be read back off the raw argv.
 * Handles both `--store id` and `--store=id`.
 */
export function parseRepeatedFlag(rawArgs: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === flag && i + 1 < rawArgs.length) {
      out.push(rawArgs[i + 1]);
    } else if (a.startsWith(`${flag}=`)) {
      out.push(a.slice(flag.length + 1));
    }
  }
  return out;
}

export interface StaffRow {
  id?: string;
  userType?: string;
  twoFactorEnabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  user?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phoneCountryCode?: string;
    phoneNumber?: string;
  };
  role?: {id?: string; name?: string};
  permittedStores?: Array<{store?: {id?: string; locationName?: string}}>;
}

/**
 * Trims a staff record down to what a person reading a terminal needs.
 *
 * `permittedStores` arrives as join rows — each carries the link's own id wrapping the store —
 * so the raw value is a wall of JSON in which the useful part (which store) is the innermost
 * field. Only the store id and name survive here.
 */
export function projectStaff(row: StaffRow): Record<string, unknown> {
  const name = [row.user?.firstName, row.user?.lastName].filter(Boolean).join(" ");
  const phone = [row.user?.phoneCountryCode, row.user?.phoneNumber].filter(Boolean).join(" ");

  // Created/updated timestamps are deliberately dropped: they are the two widest columns and
  // the least useful in a staff list, and every column added shrinks the rest.
  return {
    userId: row.user?.id,
    name,
    email: row.user?.email,
    phone,
    role: row.role?.name,
    userType: row.userType,
    twoFactorEnabled: row.twoFactorEnabled,
    // Names only. The ids are what `staff update --store` takes, but they are noise in a list
    // of who works where — `stores list` is where you go to look one up.
    permittedStores: (row.permittedStores ?? [])
      .map((p) => p.store?.locationName)
      .filter((name): name is string => Boolean(name))
  };
}
