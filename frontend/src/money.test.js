import { describe, expect, it } from "vitest";
import { deliveryFor, formatMoney, paiseToRupeesText, rupeesTextToPaise } from "./money.js";

describe("money", () => {
  it("formats rupees the Indian way", () => {
    expect(formatMoney(129900).replace(/\s/g, "")).toBe("₹1,299");
    expect(formatMoney(12950).replace(/\s/g, "")).toBe("₹129.50");
    expect(formatMoney(12345600).replace(/\s/g, "")).toBe("₹1,23,456");
  });

  it("charges delivery below Rs 999 only", () => {
    expect(deliveryFor(0)).toBe(0);
    expect(deliveryFor(99899)).toBe(4900);
    expect(deliveryFor(99900)).toBe(0);
  });

  it("turns typed rupees into paise, and refuses nonsense", () => {
    expect(rupeesTextToPaise("499")).toBe(49900);
    expect(rupeesTextToPaise("499.5")).toBe(49950);
    expect(rupeesTextToPaise("0.29")).toBe(29);
    for (const bad of ["", "abc", "-5", "1.234", "1,000", "1e3", " "]) {
      expect(rupeesTextToPaise(bad)).toBeNull();
    }
  });

  it("shows paise as text for editing", () => {
    expect(paiseToRupeesText(49900)).toBe("499");
    expect(paiseToRupeesText(49950)).toBe("499.50");
  });
});
