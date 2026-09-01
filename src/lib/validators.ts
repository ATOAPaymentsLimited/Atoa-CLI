// Signup/registration field validators

import {t} from "./i18n";
import {DEFAULT_STORE_NAME} from "./constants";

const NAME_RE = /^[a-zA-Z'\s]+$/;
export const EMAIL_RE = /^([-+_0-9a-zA-Z]+(?:\.?[-+_0-9a-zA-Z])*)@((?:[0-9a-zA-Z][-\w]*\.)+[a-zA-Z0-9]{2,10})$/;

export const isValidEmail = (email: string): boolean => email.length <= 110 && EMAIL_RE.test(email);

/**
 * Sort codes are printed as "12-34-56" and account numbers are often typed with spaces, so both
 * are normalised before validating — and callers must send the normalised form.
 */
export const normaliseSortCode = (v: string | undefined): string => (v ?? "").replace(/[\s-]/g, "");
export const normaliseAccountNumber = (v: string | undefined): string => (v ?? "").replace(/\s+/g, "");

/** Last four digits only — terminal output ends up in scrollback, CI logs and screenshots. */
export const maskAccountNumber = (full: string | undefined): string | undefined => {
  const s = full?.trim();
  return s && s.length >= 4 ? `••••${s.slice(-4)}` : undefined;
};

/** Wrong characters and wrong length are different mistakes — "12jjjjjj" is 8 chars, just not digits. */
const digitsOfLength =
  (length: number, normalise: (v: string) => string, wrongChars: string, wrongLength: string) =>
  (v: string): true | string => {
    const s = normalise(v);
    if (!/^\d*$/.test(s)) return wrongChars;
    return s.length === length || wrongLength;
  };

/** Shared by `bank add` and `direct-debit setup` so the two can't drift onto different rules. */
export const validateBankAccountNumber = digitsOfLength(
  8,
  normaliseAccountNumber,
  t("bankAccountNumberDigitsError"),
  t("bankAccountNumberLengthError")
);
export const validateSortCode = digitsOfLength(
  6,
  normaliseSortCode,
  t("sortCodeDigitsErrorMsg"),
  t("sortCodeLengthErrorMsg")
);

export const validateName =
  (label: string) =>
  (v: string): true | string => {
    const s = (v ?? "").trim();
    if (!s) return t("nameCannotBeEmpty", {label});
    if (s.length > 100) return t("nameTooLong", {label});
    return NAME_RE.test(s) || t("dontUsePunctuation");
  };

export const validateBusinessName = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return t("noBusinessNameError");
  if (s.length < 3) return t("businessNameLengthError");
  if (s.length > 100) return t("businessNameMaxError");
  if (!/^[a-zA-Z0-9 ']+$/.test(s)) return t("noSpecialCharacters");
  if (/^\d+$/.test(s.replace(/\s+/g, ""))) return t("businessNameNumberOnlyError");
  return true;
};

export const validateAddress = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (s.length <= 2) return t("addressError");
  if (s.length > 120) return t("addressMaxError");
  // Allowed: letters, digits, space and , ' & : -
  return /^[a-zA-Z0-9,'&: -]+$/.test(s) || t("addressCharactersError");
};

// Address line 2 is optional and carries no rules beyond the character filter line 1 uses.
// Empty passes.
export const validateAddressLine2 = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  if (s.length > 120) return t("addressMaxError");
  return /^[a-zA-Z0-9,'&: -]+$/.test(s) || t("addressCharactersError");
};

export const validatePostcode = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (s.length <= 2) return t("postalCodeError");
  if (s.length > (s.includes(" ") ? 8 : 7)) return t("postalCodeError");
  return /^[a-zA-Z0-9 ]+$/.test(s) || t("postalCodeError");
};

/*
 * Store (location) fields.
 *
 * Deliberately NOT the address rules above: a store address allows only letters, digits and
 * spaces (no `, ' & : -`), requires a minimum of 3 rather than "more than 2", and caps line 1
 * at 255 rather than 120. Sharing one address validator would loosen stores and tighten
 * registration at the same time.
 *
 * The character rule is reported before the length rules — a length complaint about a value
 * that is the right length but has the wrong characters names the wrong problem.
 */
const STORE_TEXT_RE = /^[a-zA-Z0-9\s]+$/;

const storeText =
  (msg: {empty: string; tooShort: string; tooLong: string}, max: number, optional = false) =>
  (v: string): true | string => {
    const s = (v ?? "").trim();
    if (!s) return optional ? true : msg.empty;
    if (!STORE_TEXT_RE.test(s)) return t("noSpecialCharacters");
    if (s.length < 3) return msg.tooShort;
    return s.length <= max || msg.tooLong;
  };

export const validateStoreName = (v: string): true | string => {
  const base = storeText(
    {empty: t("locationNameEmptyErrMsg"), tooShort: t("locationNameLengthErrMsg"), tooLong: t("locationNameMaxErrMsg")},
    30
  )(v);
  if (base !== true) return base;
  // The business's own store is named "Default"; reusing the name collides with it.
  return (v ?? "").trim().toUpperCase() !== DEFAULT_STORE_NAME || t("defaultLocationNameErrMsg");
};

export const validateStoreAddressLine1 = storeText(
  {empty: t("addressLine1EmptyErrMsg"), tooShort: t("addressLine1LengthErrMsg"), tooLong: t("addressLine1MaxErrMsg")},
  255
);

export const validateStoreCity = storeText(
  {empty: t("townCityEmptyErrMsg"), tooShort: t("townCityLengthErrMsg"), tooLong: t("townCityMaxErrMsg")},
  120
);

export const validateStoreAddressLine2 = storeText(
  {empty: "", tooShort: t("addressLine2LengthErrMsg"), tooLong: t("addressLine2MaxErrMsg")},
  120,
  true
);

/**
 * Store postcode: 3–7 letters/digits. A typed space is tolerated and stripped by
 * normaliseStorePostcode before the value is sent, so the stored postcode never contains one.
 */
export const validateStorePostcode = (v: string): true | string => {
  const s = normaliseStorePostcode(v);
  if (!s) return t("postCodeEmptyErrMsg");
  if (!/^[a-zA-Z0-9]+$/.test(s)) return t("noSpecialCharacters");
  if (s.length < 3) return t("postCodeLengthErrorMsg");
  return s.length <= 7 || t("postCodeMaxErrorMsg");
};

export const normaliseStorePostcode = (v: string): string => (v ?? "").replace(/\s+/g, "");

/**
 * Custom SMS sender name: 3–11 characters, letters, digits and spaces only. The 11 is the
 * alphanumeric sender-ID limit carriers enforce, not a presentation choice, so it is not
 * somewhere to be generous.
 */
export const validateSmsSenderName = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!/^[A-Za-z0-9\s]*$/.test(s)) return t("noSpecialCharacters");
  if (s.length < 3) return t("brandNameTooShort");
  return s.length <= 11 || t("brandNameTooLong");
};

export const validateRoleName = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return t("roleNameIsRequired");
  if (s.length < 3) return t("roleNameLengthError");
  return s.length <= 100 || t("roleNameMaxError");
};

/**
 * Staff first/last name: letters, apostrophes and spaces, up to 100 characters. Every failure
 * reports the same message — the field is short enough that naming which rule failed adds
 * noise rather than help.
 */
export const validateStaffName =
  (which: "first" | "last") =>
  (v: string): true | string => {
    const s = (v ?? "").trim();
    const ok = Boolean(s) && s.length <= 100 && NAME_RE.test(s);
    return ok || (which === "first" ? t("firstNameError") : t("lastNameError"));
  };

/** Store field name → rule, so `stores add` and `stores update` cannot drift apart. */
export const STORE_FIELDS = {
  locationName: validateStoreName,
  addressLine1: validateStoreAddressLine1,
  addressLine2: validateStoreAddressLine2,
  cityOrTown: validateStoreCity,
  addressPostalCode: validateStorePostcode
} as const;

// VAT is required at signup: an optional GB prefix followed by 9 digits.
export const VAT_RE = /^(GB)?\d{9}$/i;

export const validateVatNumber = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return t("vatRequiredError");
  // Validate the normalised form so "GB 123 456 789" and "gb123456789" are accepted —
  // the postcode prompt already normalises this way, and VAT is printed with spaces
  // on most invoices.
  return VAT_RE.test(normaliseVatNumber(s)) || t("vatError");
};

/**
 * Website is optional; when supplied it must be an http(s) URL with a dotted host.
 *
 * Parsed rather than regex-matched. The pattern this replaced was unanchored, so it matched
 * a URL *anywhere* in the string — "javascript:alert(1)//www.evil.com" passed because it
 * contains "www.evil.com", and so did "garbage www.acme.com trailing". It also rejected
 * legitimate bare domains like "acme.co.uk". An explicit scheme allowlist is the only
 * reliable way to keep javascript:/data: out.
 */
const isValidWebsite = (raw: string): boolean => {
  // A bare domain has no scheme; assume https so URL() can parse it.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // Reject whitespace anywhere, and require a dotted host with a plausible TLD.
  if (/\s/.test(raw)) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname);
};

export const validateWebsiteUrl = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  return isValidWebsite(s) || t("websiteUrlValidationErrorMsg");
};

/** VAT accepts an optional GB prefix and tolerates spacing/case; normalise before sending. */
export const normaliseVatNumber = (v: string): string => (v ?? "").replace(/\s+/g, "").toUpperCase();

// Phone is optional; when supplied the country code must be 1–4 digits.
export const validateCountryCode = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  return /^\d{1,4}$/.test(s) || t("invalidCountryCode");
};

export const validatePhoneNumber = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  if (!/^\d+$/.test(s)) return t("phoneNumberError");
  if (s.length > 11) return t("phoneNumberError");
  return s.replace(/^0+/, "").length >= 10 || t("phoneNumberError");
};
