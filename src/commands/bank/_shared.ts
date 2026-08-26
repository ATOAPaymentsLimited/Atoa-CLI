import {maskAccountNumber} from "../../lib/validators";

export interface BankAccountRow {
  id?: string;
  bankName?: string;
  nickName?: string;
  sortCode?: string;
  accountNumber?: string;
  maskedAccountNumber?: string;
  accountHolderName?: string;
  currency?: string;
  enabled?: boolean;
  copVerified?: string;
}

/**
 * Trims a bank account for terminal display — the raw record has 21 columns, two of which spell
 * out the full account number (`accountNumber` and the `iban` embedding it). Neither is printed.
 */
export function projectBankAccount(row: BankAccountRow): Record<string, unknown> {
  return {
    id: row.id,
    bankName: row.bankName,
    nickName: row.nickName,
    sortCode: row.sortCode,
    // Keeps the backend's own key names: a field called `accountNumber` holding ••••1234 would
    // lie about its contents, and renaming breaks `--output json` consumers silently.
    maskedAccountNumber: row.maskedAccountNumber ?? maskAccountNumber(row.accountNumber),
    accountHolderName: row.accountHolderName,
    currency: row.currency,
    enabled: row.enabled,
    copVerified: row.copVerified
  };
}
