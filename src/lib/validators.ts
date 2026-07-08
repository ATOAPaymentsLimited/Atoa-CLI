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

export const validatePostcode = (v: string): true | string => {
  const s = (v ?? "").trim();
  if (s.length <= 2) return "Please enter a valid postal code";
  if (s.length > (s.includes(" ") ? 8 : 7)) return "Please enter a valid postal code";
  return /^[a-zA-Z0-9 ]+$/.test(s) || "Please enter a valid postal code";
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
