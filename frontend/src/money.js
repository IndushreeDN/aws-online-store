// Money is stored as whole paise (1 rupee = 100 paise) so there are never rounding errors.
// The server uses the same rules and is always the final authority on prices.

export const FREE_DELIVERY_FROM_PAISE = 99900; // Rs 999
export const DELIVERY_FEE_PAISE = 4900; // Rs 49
export const MAX_QUANTITY = 10;

export function formatMoney(paise) {
  const rupees = paise / 100;
  const hasPaise = paise % 100 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function deliveryFor(subtotalPaise) {
  if (subtotalPaise <= 0) return 0;
  return subtotalPaise >= FREE_DELIVERY_FROM_PAISE ? 0 : DELIVERY_FEE_PAISE;
}

// "129.50" -> 12950. Returns null when the text is not a valid amount.
export function rupeesTextToPaise(text) {
  const value = String(text).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(parseFloat(value) * 100);
}

export function paiseToRupeesText(paise) {
  return (paise / 100).toFixed(paise % 100 === 0 ? 0 : 2);
}
