import crypto from "crypto";

export function sha256Hash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function hashUserData({ email, phone, firstName, lastName }) {
  const hashed = {};
  if (email) hashed.em = sha256Hash(email);
  if (phone) {
    const digits = phone.replace(/[^\d]/g, "");
    hashed.ph = sha256Hash(digits);
  }
  if (firstName) hashed.fn = sha256Hash(firstName);
  if (lastName) hashed.ln = sha256Hash(lastName);
  return hashed;
}
