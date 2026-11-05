// The shopping cart. It lives in the browser (localStorage) so it survives a refresh and
// works before you sign in. The server re-checks every price and stock level at checkout,
// so nothing stored here can be used to get a cheaper price.

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { MAX_QUANTITY, deliveryFor } from "./money.js";

const STORAGE_KEY = "eshop.cart";
const CartContext = createContext(null);

function isValidLine(l) {
  return (
    l &&
    typeof l.productId === "string" &&
    typeof l.name === "string" &&
    Number.isInteger(l.pricePaise) &&
    Number.isInteger(l.quantity) &&
    l.quantity >= 1
  );
}

function loadLines() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed.filter(isValidLine) : [];
  } catch {
    return [];
  }
}

const maxFor = (stock) => Math.min(MAX_QUANTITY, Math.max(0, stock ?? MAX_QUANTITY));

function snapshot(product, quantity) {
  return {
    productId: product.productId,
    name: product.name,
    pricePaise: product.pricePaise,
    imageUrl: product.imageUrl,
    stock: product.stock,
    quantity,
  };
}

function reducer(lines, action) {
  switch (action.type) {
    case "add": {
      const { product, quantity } = action;
      const max = maxFor(product.stock);
      if (max < 1) return lines;
      const existing = lines.find((l) => l.productId === product.productId);
      if (!existing) return [...lines, snapshot(product, Math.min(max, quantity))];
      return lines.map((l) =>
        l.productId === product.productId ? snapshot(product, Math.min(max, l.quantity + quantity)) : l,
      );
    }
    case "setQuantity":
      return lines.map((l) =>
        l.productId === action.productId
          ? { ...l, quantity: Math.max(1, Math.min(maxFor(l.stock), action.quantity)) }
          : l,
      );
    case "remove":
      return lines.filter((l) => l.productId !== action.productId);
    case "replace":
      return action.lines;
    case "clear":
      return [];
    default:
      return lines;
  }
}

export function CartProvider({ children }) {
  const [lines, dispatch] = useReducer(reducer, undefined, loadLines);
  const latest = useRef(lines);
  latest.current = lines;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* storage blocked: the cart still works until the page closes */
    }
  }, [lines]);

  const add = useCallback((product, quantity = 1) => {
    dispatch({ type: "add", product, quantity });
  }, []);
  const setQuantity = useCallback((productId, quantity) => dispatch({ type: "setQuantity", productId, quantity }), []);
  const remove = useCallback((productId) => dispatch({ type: "remove", productId }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  // Compares the cart with the latest product list from the server.
  // Updates prices and stock, drops products that are gone, and returns messages to show.
  const syncWithCatalog = useCallback((products) => {
    const byId = new Map(products.map((p) => [p.productId, p]));
    const notices = [];
    const next = [];
    for (const line of latest.current) {
      const p = byId.get(line.productId);
      if (!p || p.stock < 1) {
        notices.push(`"${line.name}" is no longer available and was removed from your cart.`);
        continue;
      }
      if (p.pricePaise !== line.pricePaise) notices.push(`The price of "${p.name}" has changed.`);
      const quantity = Math.min(line.quantity, maxFor(p.stock));
      if (quantity < line.quantity) notices.push(`Only ${quantity} of "${p.name}" left, so we lowered the quantity.`);
      next.push(snapshot(p, quantity));
    }
    const changed = JSON.stringify(next) !== JSON.stringify(latest.current);
    if (changed) dispatch({ type: "replace", lines: next });
    return notices;
  }, []);

  const value = useMemo(() => {
    const subtotalPaise = lines.reduce((sum, l) => sum + l.pricePaise * l.quantity, 0);
    const deliveryPaise = deliveryFor(subtotalPaise);
    return {
      lines,
      count: lines.reduce((sum, l) => sum + l.quantity, 0),
      subtotalPaise,
      deliveryPaise,
      totalPaise: subtotalPaise + deliveryPaise,
      add,
      setQuantity,
      remove,
      clear,
      syncWithCatalog,
    };
  }, [lines, add, setQuantity, remove, clear, syncWithCatalog]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}
