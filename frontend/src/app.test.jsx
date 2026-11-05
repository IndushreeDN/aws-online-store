import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "./App.jsx";
import { SessionProvider } from "./session.jsx";
import { CartProvider } from "./cart.jsx";
import { safeNext, passwordProblem } from "./pages/LoginPage.jsx";
import { installMockBackend, signedInSession } from "./mock-backend.js";

function renderApp(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}

const cardFor = async (name) => (await screen.findByRole("heading", { name })).closest("article");
const addToCart = async (user, name) => user.click(within(await cardFor(name)).getByRole("button", { name: /add to cart/i }));
const summary = () => screen.getByText("Subtotal").closest(".summary");

function putCartInStorage(lines) {
  localStorage.setItem("eshop.cart", JSON.stringify(lines));
}
const MUG_LINE = { productId: "p-mug", name: "Ceramic Mug", pricePaise: 24900, imageUrl: "/images/mug.svg", stock: 100, quantity: 1 };

let backend;
beforeEach(() => {
  backend = installMockBackend();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("browsing the shop", () => {
  it("shows products with prices and stock messages", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "Wireless Earbuds" })).toBeInTheDocument();
    expect(screen.getByText("Only 2 left")).toBeInTheDocument();
    const soldOut = await cardFor("Sold Out Lamp");
    expect(within(soldOut).getByText("Out of stock")).toBeInTheDocument();
    expect(within(soldOut).getByRole("button", { name: /add to cart/i })).toBeDisabled();
  });

  it("filters by category and by search text, and says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("heading", { name: "Ceramic Mug" });
    await user.click(screen.getByRole("button", { name: "Electronics" }));
    expect(screen.queryByRole("heading", { name: "Ceramic Mug" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wireless Earbuds" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByLabelText("Search products"), "mug");
    expect(screen.queryByRole("heading", { name: "Wireless Earbuds" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search products"));
    await user.type(screen.getByLabelText("Search products"), "zzzz");
    expect(screen.getByText("No products match your search.")).toBeInTheDocument();
  });

  it("shows a friendly message and a retry when the store cannot be reached", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the store/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows an empty-store hint when there are no products yet", async () => {
    backend = installMockBackend({ products: [] });
    renderApp();
    expect(await screen.findByText(/There are no products yet/)).toBeInTheDocument();
  });

  it("shows a product page, lets you pick a quantity, and handles a missing product", async () => {
    const user = userEvent.setup();
    renderApp("/product/p-shoes");
    expect(await screen.findByRole("heading", { name: "Running Shoes" })).toBeInTheDocument();
    const select = screen.getByLabelText("Quantity");
    expect(within(select).getAllByRole("option")).toHaveLength(2); // only 2 in stock
    await user.selectOptions(select, "2");
    await user.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(screen.getByText(/Added to your cart/)).toBeInTheDocument();
    expect(screen.getByLabelText("2 items in cart")).toBeInTheDocument();
  });

  it("product page: unknown product shows an error", async () => {
    renderApp("/product/p-nope");
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not find that product.");
  });

  it("unknown address shows a not-found page", () => {
    renderApp("/no/such/page");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("the cart", () => {
  it("adds items, changes quantity, shows delivery rules, and removes items", async () => {
    const user = userEvent.setup();
    renderApp();
    await addToCart(user, "Ceramic Mug");
    expect(screen.getByLabelText("1 items in cart")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Cart/ }));

    expect(await screen.findByRole("heading", { name: "Your cart" })).toBeInTheDocument();
    expect(within(summary()).getByText("₹49")).toBeInTheDocument(); // delivery under Rs 999
    expect(within(summary()).getByText(/Add ₹750 more for free delivery/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Increase quantity of Ceramic Mug" }));
    expect(screen.getByLabelText("Quantity of Ceramic Mug")).toHaveTextContent("2");
    expect(within(summary()).getByText("₹547")).toBeInTheDocument(); // 2 x 249 + 49

    await user.click(screen.getByRole("link", { name: "Shop" }));
    await addToCart(user, "Wireless Earbuds");
    await user.click(screen.getByRole("link", { name: /Cart/ }));
    await screen.findByRole("heading", { name: "Your cart" });
    expect(within(summary()).getByText("Free")).toBeInTheDocument(); // over Rs 999

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("never lets quantity go below 1 or above the stock", async () => {
    const user = userEvent.setup();
    putCartInStorage([{ ...MUG_LINE, productId: "p-shoes", name: "Running Shoes", pricePaise: 249900, stock: 2, quantity: 2 }]);
    renderApp("/cart");
    await screen.findByLabelText("Quantity of Running Shoes");
    await user.click(screen.getByRole("button", { name: "Increase quantity of Running Shoes" }));
    expect(screen.getByLabelText("Quantity of Running Shoes")).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: "Decrease quantity of Running Shoes" }));
    expect(screen.getByLabelText("Quantity of Running Shoes")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Decrease quantity of Running Shoes" })).toBeDisabled();
  });

  it("keeps the cart after a refresh (saved in the browser)", async () => {
    const user = userEvent.setup();
    const first = renderApp();
    await addToCart(user, "Ceramic Mug");
    first.unmount();
    renderApp();
    expect(await screen.findByLabelText("1 items in cart")).toBeInTheDocument();
  });

  it("updates changed prices and removes sold-out products, and tells the shopper", async () => {
    putCartInStorage([
      { ...MUG_LINE, pricePaise: 19900 }, // price changed since
      { productId: "p-sold", name: "Sold Out Lamp", pricePaise: 99900, imageUrl: "", stock: 5, quantity: 1 },
    ]);
    renderApp("/cart");
    expect(await screen.findByText('The price of "Ceramic Mug" has changed.')).toBeInTheDocument();
    expect(screen.getByText(/"Sold Out Lamp" is no longer available/)).toBeInTheDocument();
    expect(within(summary()).getAllByText("₹249").length).toBeGreaterThan(0); // new price
  });
});

describe("signing up and checking out", () => {
  const fillDelivery = async (user, overrides = {}) => {
    const v = { name: "Asha Rao", phone: "9876543210", address: "12 MG Road", city: "Bengaluru", pincode: "560038", ...overrides };
    await user.type(screen.getByLabelText("Full name"), v.name);
    await user.type(screen.getByLabelText("Mobile number"), v.phone);
    await user.type(screen.getByLabelText("Address"), v.address);
    await user.type(screen.getByLabelText("City"), v.city);
    await user.type(screen.getByLabelText("PIN code"), v.pincode);
  };

  it("full journey: shop, cart, sign up, confirm email, place order, see it in My orders", async () => {
    const user = userEvent.setup();
    renderApp();
    await addToCart(user, "Ceramic Mug");
    await user.click(screen.getByRole("link", { name: /Cart/ }));
    await user.click(await screen.findByRole("link", { name: "Checkout" }));

    // not signed in: sent to the login page
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await user.type(screen.getByLabelText("Password"), "Passw0rd");
    await user.type(screen.getByLabelText("Repeat password"), "Passw0rd");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/We emailed a 6-digit code to asha@example.com/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    // confirmed, signed in automatically, back at checkout
    expect(await screen.findByRole("heading", { name: "Checkout" })).toBeInTheDocument();
    expect(screen.getByText("asha@example.com")).toBeInTheDocument();

    await fillDelivery(user);
    await user.click(screen.getByRole("button", { name: /Place order/ }));

    expect(await screen.findByRole("heading", { name: "My orders" })).toBeInTheDocument();
    expect(await screen.findByText(/Thank you! Your order/)).toBeInTheDocument();
    expect(await screen.findByText(/Ceramic Mug × 1/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/items in cart/)).not.toBeInTheDocument(); // cart emptied
    expect(JSON.parse(localStorage.getItem("eshop.cart"))).toEqual([]);

    // what the server was sent: only ids and quantities, never prices
    const orderCall = backend.calls.find((c) => c.method === "POST" && c.url.endsWith("/orders"));
    expect(orderCall.body.items).toEqual([{ productId: "p-mug", quantity: 1 }]);
    expect(orderCall.headers.Authorization).toMatch(/^Bearer /);
  });

  it("a declined test payment shows the reason and keeps the cart", async () => {
    const user = userEvent.setup();
    signedInSession();
    putCartInStorage([MUG_LINE]);
    renderApp("/checkout");
    await screen.findByRole("heading", { name: "Checkout" });
    await fillDelivery(user);
    await user.click(screen.getByRole("radio", { name: /Test payment: declined/ }));
    await user.click(screen.getByRole("button", { name: /Place order/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/declined/);
    expect(screen.getByRole("heading", { name: "Checkout" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("eshop.cart"))).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Place order/ })).toBeEnabled(); // can try again
  });

  it("a sold-out item at the last moment shows the message and a link to the cart", async () => {
    const user = userEvent.setup();
    signedInSession();
    putCartInStorage([MUG_LINE]);
    backend = installMockBackend({
      orderError: { status: 409, body: { error: 'Sorry, "Ceramic Mug" just sold out or has less stock than you asked for. Please update your cart.', code: "OUT_OF_STOCK" } },
    });
    renderApp("/checkout");
    await screen.findByRole("heading", { name: "Checkout" });
    await fillDelivery(user);
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/just sold out/);
    expect(screen.getByRole("link", { name: "Review your cart" })).toBeInTheDocument();
  });

  it("pay on delivery places the order", async () => {
    const user = userEvent.setup();
    signedInSession();
    putCartInStorage([MUG_LINE]);
    renderApp("/checkout");
    await screen.findByRole("heading", { name: "Checkout" });
    await fillDelivery(user);
    await user.click(screen.getByRole("radio", { name: /Pay on delivery/ }));
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    expect(await screen.findByText("Pay on delivery")).toBeInTheDocument();
  });

  it("an empty cart at checkout shows a friendly page", async () => {
    signedInSession();
    renderApp("/checkout");
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("session ended while ordering (server says 401): signed out with a clear message", async () => {
    const user = userEvent.setup();
    signedInSession();
    putCartInStorage([MUG_LINE]);
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) =>
      String(url).endsWith("/orders") && init?.method === "POST"
        ? { ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) }
        : original(url, init),
    );
    renderApp("/checkout");
    await screen.findByRole("heading", { name: "Checkout" });
    await fillDelivery(user);
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument(); // sent to login
    expect(localStorage.getItem("eshop.session")).toBeNull();
  });
});

describe("login screens", () => {
  it("wrong password shows an error and stays on the page", async () => {
    const user = userEvent.setup();
    backend = installMockBackend({ users: { "a@example.com": { password: "Passw0rd", confirmed: true, code: "123456", groups: [] } } });
    renderApp("/login");
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.type(screen.getByLabelText("Password"), "WrongPass1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(localStorage.getItem("eshop.session")).toBeNull();
  });

  it("unconfirmed account is sent to the confirm-email screen", async () => {
    const user = userEvent.setup();
    backend = installMockBackend({ users: { "b@example.com": { password: "Passw0rd", confirmed: false, code: "123456", groups: [] } } });
    renderApp("/login");
    await user.type(screen.getByLabelText("Email"), "b@example.com");
    await user.type(screen.getByLabelText("Password"), "Passw0rd");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Confirm your email" })).toBeInTheDocument();
    expect(screen.getByText(/not confirmed yet/)).toBeInTheDocument();
  });

  it("wrong confirmation code shows an error", async () => {
    const user = userEvent.setup();
    backend = installMockBackend({ users: { "b@example.com": { password: "Passw0rd", confirmed: false, code: "123456", groups: [] } } });
    renderApp("/login");
    await user.type(screen.getByLabelText("Email"), "b@example.com");
    await user.type(screen.getByLabelText("Password"), "Passw0rd");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Confirm your email" });
    await user.type(screen.getByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not correct");
  });

  it("sign up checks the password before calling AWS", async () => {
    const user = userEvent.setup();
    renderApp("/login");
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await user.type(screen.getByLabelText("Email"), "c@example.com");
    await user.type(screen.getByLabelText("Password"), "alllowercase1");
    await user.type(screen.getByLabelText("Repeat password"), "alllowercase1");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("capital letter");
    expect(backend.calls.some((c) => c.target?.endsWith("SignUp"))).toBe(false);

    await user.clear(screen.getByLabelText("Password"));
    await user.clear(screen.getByLabelText("Repeat password"));
    await user.type(screen.getByLabelText("Password"), "Passw0rd");
    await user.type(screen.getByLabelText("Repeat password"), "Different1");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
  });

  it("forgot password: email a code, choose a new password, sign in with it", async () => {
    const user = userEvent.setup();
    backend = installMockBackend({ users: { "a@example.com": { password: "OldPassw0rd", confirmed: true, code: "123456", groups: [] } } });
    renderApp("/login");
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email"), "a@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await screen.findByRole("heading", { name: "Choose a new password" });
    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.type(screen.getByLabelText("New password"), "NewPassw0rd");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("a@example.com"); // email is kept between screens
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "NewPassw0rd");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Shop" })).toBeInTheDocument();
  });

  it("only goes back to pages on this website after login", () => {
    expect(safeNext("/checkout")).toBe("/checkout");
    for (const bad of ["//evil.com", "https://evil.com", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/");
    }
    expect(passwordProblem("Passw0rd")).toBe("");
    expect(passwordProblem("short1A")).toMatch(/8 characters/);
  });

  it("My orders needs a sign-in", async () => {
    renderApp("/orders");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("signing out clears the session", async () => {
    const user = userEvent.setup();
    signedInSession();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(localStorage.getItem("eshop.session")).toBeNull();
  });
});

describe("admin page", () => {
  it("a normal shopper is told they are not an admin (and no admin data is requested)", async () => {
    signedInSession();
    renderApp("/admin");
    expect(await screen.findByText(/not a store admin/)).toBeInTheDocument();
    expect(backend.calls.some((c) => c.url.includes("/admin"))).toBe(false);
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("someone signed out is sent to the login page", async () => {
    renderApp("/admin");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("an admin can edit price and stock, add a product, and see all orders", async () => {
    const user = userEvent.setup();
    signedInSession({ email: "boss@example.com", groups: ["admins"] });
    renderApp("/admin");
    expect(await screen.findByRole("link", { name: "Admin" })).toBeInTheDocument();

    // edit
    const price = await screen.findByLabelText("Price in rupees for Ceramic Mug");
    await user.clear(price);
    await user.type(price, "299.50");
    const row = screen.getByText("Ceramic Mug").closest("tr");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    expect(await within(row).findByText("Saved")).toBeInTheDocument();
    expect(backend.products.find((p) => p.productId === "p-mug").pricePaise).toBe(29950);

    // bad input is caught before calling the server
    await user.clear(price);
    await user.type(price, "abc");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    expect(within(row).getByText(/Price must be at least/)).toBeInTheDocument();

    // add
    await user.type(screen.getByLabelText("Name"), "Desk Plant");
    await user.type(screen.getByLabelText("Category"), "Home");
    await user.type(screen.getByLabelText("Price in rupees"), "250");
    await user.type(screen.getByLabelText("Stock (how many in hand)"), "12");
    await user.click(screen.getByRole("button", { name: "Add product" }));
    expect(await screen.findByText('Added "Desk Plant".')).toBeInTheDocument();
    expect(backend.products.at(-1)).toMatchObject({ name: "Desk Plant", pricePaise: 25000, stock: 12 });

    // orders tab
    await user.click(screen.getByRole("tab", { name: "All orders" }));
    expect(await screen.findByText("No orders yet.")).toBeInTheDocument();
  });
});

describe("when the website is not configured", () => {
  it("shows a clear setup message instead of failing silently", async () => {
    vi.stubEnv("VITE_API_URL", "");
    renderApp();
    expect(screen.getByText(/Setup needed/)).toBeInTheDocument();
    expect(await screen.findByText(/not connected to AWS yet/)).toBeInTheDocument();
  });
});
