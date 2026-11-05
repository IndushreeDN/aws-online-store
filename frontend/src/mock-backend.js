// A pretend AWS used only by tests: it answers the website's web requests (Cognito + our API)
// from memory, so the whole website can be exercised with no internet.
import { vi } from "vitest";

export function base64url(object) {
  return btoa(JSON.stringify(object)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makeJwt(claims) {
  return `${base64url({ alg: "RS256" })}.${base64url(claims)}.signature`;
}

export const PRODUCTS = [
  { productId: "p-earbuds", name: "Wireless Earbuds", category: "Electronics", pricePaise: 149900, stock: 25, imageUrl: "/images/earbuds.svg", description: "Bluetooth earbuds" },
  { productId: "p-mug", name: "Ceramic Mug", category: "Home", pricePaise: 24900, stock: 100, imageUrl: "/images/mug.svg", description: "Handmade mug" },
  { productId: "p-shoes", name: "Running Shoes", category: "Fashion", pricePaise: 249900, stock: 2, imageUrl: "/images/shoes.svg", description: "Almost sold out" },
  { productId: "p-sold", name: "Sold Out Lamp", category: "Home", pricePaise: 99900, stock: 0, imageUrl: "/images/lamp.svg", description: "Gone" },
];

export function installMockBackend({ products = PRODUCTS.map((p) => ({ ...p })), users = {}, orderError = null } = {}) {
  const state = {
    products,
    users, // email -> { password, confirmed, code, groups }
    orders: [],
    calls: [],
    orderError, // e.g. { status: 409, body: {...} }
  };

  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const cognitoError = (type, message = "") => reply(400, { __type: type, message });

  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const target = init.headers?.["X-Amz-Target"];
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ url, method: init.method ?? "GET", target, body, headers: init.headers });

    // ----- Cognito -----
    if (String(url).startsWith("https://cognito-idp.")) {
      const action = target.split(".").pop();
      const email = (body.Username ?? body.AuthParameters?.USERNAME ?? "").toLowerCase();
      const user = state.users[email];
      if (action === "SignUp") {
        if (user) return cognitoError("UsernameExistsException");
        if (body.Password.length < 8) return cognitoError("InvalidPasswordException", "Password did not conform with policy");
        state.users[email] = { password: body.Password, confirmed: false, code: "123456", groups: [] };
        return reply(200, { UserConfirmed: false });
      }
      if (action === "ConfirmSignUp") {
        if (!user) return cognitoError("UserNotFoundException");
        if (body.ConfirmationCode !== user.code) return cognitoError("CodeMismatchException");
        user.confirmed = true;
        return reply(200, {});
      }
      if (action === "ResendConfirmationCode") return reply(200, {});
      if (action === "InitiateAuth") {
        if (body.AuthFlow === "REFRESH_TOKEN_AUTH") {
          if (body.AuthParameters.REFRESH_TOKEN !== "refresh-ok") return cognitoError("NotAuthorizedException");
          return reply(200, { AuthenticationResult: { IdToken: makeJwt({ sub: "u1", email: "refreshed@example.com" }), ExpiresIn: 3600 } });
        }
        if (!user || user.password !== body.AuthParameters.PASSWORD) return cognitoError("NotAuthorizedException");
        if (!user.confirmed) return cognitoError("UserNotConfirmedException");
        return reply(200, {
          AuthenticationResult: {
            IdToken: makeJwt({ sub: `sub-${email}`, email, "cognito:groups": user.groups }),
            RefreshToken: "refresh-ok",
            ExpiresIn: 3600,
          },
        });
      }
      if (action === "ForgotPassword") return reply(200, {});
      if (action === "ConfirmForgotPassword") {
        if (body.ConfirmationCode !== "123456") return cognitoError("CodeMismatchException");
        state.users[email].password = body.Password;
        return reply(200, {});
      }
      return reply(400, { __type: "UnknownOperationException" });
    }

    // ----- Our API -----
    const path = String(url).replace("https://api.test.example.com", "");
    const token = init.headers?.Authorization?.replace("Bearer ", "");
    const claims = token ? JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) : null;
    const isAdmin = claims?.["cognito:groups"]?.includes("admins");

    if (path === "/products" && (init.method ?? "GET") === "GET") return reply(200, { products: state.products });
    const one = path.match(/^\/products\/([^/]+)$/);
    if (one) {
      const p = state.products.find((x) => x.productId === one[1]);
      return p ? reply(200, { product: p }) : reply(404, { error: "We could not find that product.", code: "NOT_FOUND" });
    }
    if (path.startsWith("/orders") || path.startsWith("/admin")) {
      if (!claims) return reply(401, { message: "Unauthorized" });
    }
    if (path === "/orders" && init.method === "POST") {
      if (state.orderError) return reply(state.orderError.status, state.orderError.body);
      if (body.paymentMethod === "TEST_DECLINED") {
        return reply(402, { error: "Your test payment was declined. No money was taken and your cart is unchanged.", code: "PAYMENT_DECLINED" });
      }
      const items = body.items.map((i) => {
        const p = state.products.find((x) => x.productId === i.productId);
        return { productId: p.productId, name: p.name, pricePaise: p.pricePaise, quantity: i.quantity, imageUrl: p.imageUrl };
      });
      const subtotal = items.reduce((s, i) => s + i.pricePaise * i.quantity, 0);
      const shippingPaise = subtotal >= 99900 ? 0 : 4900;
      const order = {
        userId: claims.sub, orderId: `2026-${state.orders.length + 1}`, createdAt: new Date().toISOString(),
        status: "PLACED", paymentMethod: body.paymentMethod, paymentStatus: body.paymentMethod === "COD" ? "PAY_ON_DELIVERY" : "PAID",
        email: claims.email, items, subtotalPaise: subtotal, shippingPaise, totalPaise: subtotal + shippingPaise, shipping: body.shipping,
      };
      state.orders.unshift(order);
      return reply(201, { order });
    }
    if (path === "/orders" && (init.method ?? "GET") === "GET") {
      return reply(200, { orders: state.orders.filter((o) => o.userId === claims.sub) });
    }
    if (path.startsWith("/admin")) {
      if (!isAdmin) return reply(403, { error: "Only store admins can do this.", code: "FORBIDDEN" });
      if (path === "/admin/products" && (init.method ?? "GET") === "GET") {
        return reply(200, { products: state.products.map((p) => ({ ...p, active: true })) });
      }
      if (path === "/admin/products" && init.method === "POST") {
        const product = { productId: `p-new${state.products.length}`, imageUrl: "/images/placeholder.svg", description: "", ...body };
        state.products.push(product);
        return reply(201, { product });
      }
      const upd = path.match(/^\/admin\/products\/([^/]+)$/);
      if (upd && init.method === "PUT") {
        const p = state.products.find((x) => x.productId === upd[1]);
        Object.assign(p, body);
        return reply(200, { product: p });
      }
      if (path === "/admin/orders") return reply(200, { orders: state.orders });
    }
    return reply(404, { error: "not found" });
  });

  return state;
}

export function signedInSession({ email = "shopper@example.com", groups = [] } = {}) {
  localStorage.setItem(
    "eshop.session",
    JSON.stringify({
      idToken: makeJwt({ sub: `sub-${email}`, email, "cognito:groups": groups }),
      refreshToken: "refresh-ok",
      expiresAt: Date.now() + 3_600_000,
    }),
  );
}
