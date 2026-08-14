// Signup/registration field validators

const NAME_RE = /^[a-zA-Z'\s]+$/;
export const EMAIL_RE = /^([-+_0-9a-zA-Z]+(?:\.?[-+_0-9a-zA-Z])*)@((?:[0-9a-zA-Z][-\w]*\.)+[a-zA-Z0-9]{2,10})$/;

export const isValidEmail = (email: string): boolean => email.length <= 110 && EMAIL_RE.test(email);

export const validateName =
  (label: string) =>
  (v: string): true | string => {
    const s = (v ?? "").trim();
    if (!s) return `${label} cannot be empty`;
    if (s.length > 100) return `${label} must be 100 characters or fewer`;
    return NAME_RE.test(s) || "Special characters & numbers are not allowed.";
  };

export const validateBusinessName = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return "Business name cannot be empty";
  if (s.length < 3) return "Business name should be at least 3 characters long";
  if (s.length > 100) return "Business name must be 100 characters or fewer";
  if (!/^[a-zA-Z0-9 ']+$/.test(s)) return "No special characters or punctuation, please!";
  if (/^\d+$/.test(s.replace(/\s+/g, ""))) return "Business name cannot consist of numbers only.";
  return true;
};

export const validateAddress = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (s.length <= 2) return "Please enter a valid address";
  if (s.length > 120) return "Address must be 120 characters or fewer";
  // Dashboard allowlist (v-regex-paste): letters, digits, space and , ' & : -
  return /^[a-zA-Z0-9,'&: -]+$/.test(s) || "Address can only contain letters, numbers, spaces and , ' & : -";
};

// Address line 2 is optional and, on the dashboard, carries no validation rules at all —
// only the same character filter as line 1. Empty passes.
export const validateAddressLine2 = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  if (s.length > 120) return "Address must be 120 characters or fewer";
  return /^[a-zA-Z0-9,'&: -]+$/.test(s) || "Address can only contain letters, numbers, spaces and , ' & : -";
};

export const validatePostcode = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (s.length <= 2) return "Please enter a valid postal code";
  if (s.length > (s.includes(" ") ? 8 : 7)) return "Please enter a valid postal code";
  return /^[a-zA-Z0-9 ]+$/.test(s) || "Please enter a valid postal code";
};

// VAT is required at signup, matching the dashboard (createVatValidationRule with
// isOptional defaulted false). Same pattern it uses: optional GB prefix + 9 digits.
export const VAT_RE = /^(GB)?\d{9}$/i;

export const validateVatNumber = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return "VAT number is required";
  // Validate the normalised form so "GB 123 456 789" and "gb123456789" are accepted —
  // the postcode prompt already normalises this way, and VAT is printed with spaces
  // on most invoices.
  return VAT_RE.test(normaliseVatNumber(s)) || "VAT number must contain 9 digits (e.g. 123456789 or GB123456789)";
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
  return isValidWebsite(s) || "Please enter a valid website URL (e.g. https://acme.co.uk)";
};

/** VAT accepts an optional GB prefix and tolerates spacing/case; normalise before sending. */
export const normaliseVatNumber = (v: string): string => (v ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Same format rule, but blank is allowed. Signup requires VAT (dashboard parity); card
 * activation treats it as optional because the backend falls back to the stored value.
 */
export const validateVatOptional = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  return validateVatNumber(s);
};

/**
 * Numeric field guards. Shared by the interactive prompts and the flag path so a value can
 * never reach Number() unchecked — NaN serialises to null in JSON, which silently drops the
 * field instead of reporting a bad input.
 */
export const validateWholeNumber = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  return /^\d+$/.test(s) || "enter a whole number of days";
};

export const validateAmount = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  return /^\d+(\.\d{1,2})?$/.test(s) || "enter a number, e.g. 250 or 250.00";
};

// Phone is optional; when supplied the country code must be 1–4 digits.
export const validateCountryCode = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  return /^\d{1,4}$/.test(s) || "Please enter a valid country code (numbers only, e.g. 44).";
};

export const validatePhoneNumber = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (!s) return true;
  if (!/^\d+$/.test(s)) return "Please enter a valid phone number (numbers only).";
  if (s.length > 11) return "Please enter a valid phone number.";
  return s.replace(/^0+/, "").length >= 10 || "Please enter a valid phone number.";
};
