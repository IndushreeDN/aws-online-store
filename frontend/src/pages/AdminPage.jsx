import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { formatMoney, paiseToRupeesText, rupeesTextToPaise } from "../money.js";
import { useSession } from "../session.jsx";
import Notice from "../components/Notice.jsx";
import { OrderCard } from "./OrdersPage.jsx";

function ProductRow({ product, onSaved }) {
  const [price, setPrice] = useState(paiseToRupeesText(product.pricePaise));
  const [stock, setStock] = useState(String(product.stock));
  const [active, setActive] = useState(product.active);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // {kind, text}

  // After the list reloads, show the values the server now holds.
  useEffect(() => {
    setPrice(paiseToRupeesText(product.pricePaise));
    setStock(String(product.stock));
    setActive(product.active);
  }, [product.pricePaise, product.stock, product.active]);

  async function save() {
    const pricePaise = rupeesTextToPaise(price);
    if (pricePaise === null || pricePaise < 100) return setResult({ kind: "error", text: "Price must be at least ₹1 (for example 499 or 499.50)." });
    if (!/^\d+$/.test(stock)) return setResult({ kind: "error", text: "Stock must be a whole number, 0 or more." });
    setBusy(true);
    setResult(null);
    try {
      await api(`/admin/products/${encodeURIComponent(product.productId)}`, {
        method: "PUT",
        auth: true,
        body: { pricePaise, stock: Number(stock), active },
      });
      setResult({ kind: "success", text: "Saved" });
      onSaved();
    } catch (err) {
      setResult({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <strong>{product.name}</strong>
        <div className="muted small">{product.category} · {product.productId}</div>
      </td>
      <td>
        <label className="sr-only" htmlFor={`price-${product.productId}`}>Price in rupees for {product.name}</label>
        <input id={`price-${product.productId}`} className="short" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <div className="muted small">{formatMoney(product.pricePaise)} now</div>
      </td>
      <td>
        <label className="sr-only" htmlFor={`stock-${product.productId}`}>Stock for {product.name}</label>
        <input id={`stock-${product.productId}`} className="short" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
      </td>
      <td>
        <label><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Visible</label>
      </td>
      <td>
        <button type="button" className="button small-button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {result && <div className={result.kind === "error" ? "error-text small" : "success-text small"}>{result.text}</div>}
      </td>
    </tr>
  );
}

const EMPTY = { name: "", category: "", price: "", stock: "", imageUrl: "", description: "" };

function AddProductForm({ categories, onAdded }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setDone("");
    const pricePaise = rupeesTextToPaise(form.price);
    if (pricePaise === null || pricePaise < 100) return setError("Price must be at least ₹1 (for example 499 or 499.50).");
    if (!/^\d+$/.test(form.stock)) return setError("Stock must be a whole number, 0 or more.");
    setBusy(true);
    try {
      const body = {
        name: form.name,
        category: form.category,
        description: form.description,
        pricePaise,
        stock: Number(form.stock),
      };
      if (form.imageUrl.trim()) body.imageUrl = form.imageUrl.trim();
      const data = await api("/admin/products", { method: "POST", auth: true, body });
      setDone(`Added "${data.product.name}".`);
      setForm(EMPTY);
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2>Add a product</h2>
      {done && <Notice kind="success">{done}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <label>Name<input required minLength={2} maxLength={100} value={form.name} onChange={set("name")} /></label>
      <label>Category
        <input required minLength={2} maxLength={40} list="category-list" value={form.category} onChange={set("category")} />
        <datalist id="category-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label>Price in rupees<input required inputMode="decimal" placeholder="499" value={form.price} onChange={set("price")} /></label>
      <label>Stock (how many in hand)<input required inputMode="numeric" placeholder="20" value={form.stock} onChange={set("stock")} /></label>
      <label>Picture link (optional)
        <input placeholder="/images/lamp.svg or https://..." value={form.imageUrl} onChange={set("imageUrl")} />
      </label>
      <label>Description<textarea rows={3} maxLength={1000} value={form.description} onChange={set("description")} /></label>
      <button className="button" disabled={busy}>{busy ? "Adding…" : "Add product"}</button>
    </form>
  );
}

export default function AdminPage() {
  const { user } = useSession();
  const [tab, setTab] = useState("products");
  const [products, setProducts] = useState({ status: "loading", items: [], error: "" });
  const [orders, setOrders] = useState({ status: "idle", items: [], error: "" });

  const isAdmin = Boolean(user?.isAdmin);

  const loadProducts = useCallback(async () => {
    try {
      const data = await api("/admin/products", { auth: true });
      setProducts({ status: "ready", items: data.products, error: "" });
    } catch (err) {
      setProducts({ status: "error", items: [], error: err.message });
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrders((o) => ({ ...o, status: "loading" }));
    try {
      const data = await api("/admin/orders", { auth: true });
      setOrders({ status: "ready", items: data.orders, error: "" });
    } catch (err) {
      setOrders({ status: "error", items: [], error: err.message });
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadProducts();
  }, [isAdmin, loadProducts]);

  useEffect(() => {
    if (isAdmin && tab === "orders") loadOrders();
  }, [isAdmin, tab, loadOrders]);

  if (!user) return <Navigate to="/login?next=%2Fadmin" replace />;

  if (!isAdmin) {
    return (
      <section>
        <h1>Admin</h1>
        <Notice kind="info">
          Your account is not a store admin. If you were just made an admin, sign out and sign in again so the change takes effect.
        </Notice>
      </section>
    );
  }

  const categories = [...new Set(products.items.map((p) => p.category))];

  return (
    <section>
      <h1>Admin</h1>
      <div className="chips" role="tablist" aria-label="Admin sections">
        <button type="button" role="tab" aria-selected={tab === "products"} className={tab === "products" ? "chip active" : "chip"} onClick={() => setTab("products")}>Products</button>
        <button type="button" role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "chip active" : "chip"} onClick={() => setTab("orders")}>All orders</button>
      </div>

      {tab === "products" && (
        <>
          {products.status === "loading" && <p className="muted">Loading…</p>}
          {products.status === "error" && <Notice kind="error">{products.error}</Notice>}
          {products.status === "ready" && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Product</th><th>Price (₹)</th><th>Stock</th><th>Shown</th><th /></tr></thead>
                <tbody>
                  {products.items.map((p) => <ProductRow key={p.productId} product={p} onSaved={loadProducts} />)}
                </tbody>
              </table>
            </div>
          )}
          <AddProductForm categories={categories} onAdded={loadProducts} />
        </>
      )}

      {tab === "orders" && (
        <>
          {orders.status === "loading" && <p className="muted">Loading…</p>}
          {orders.status === "error" && <Notice kind="error">{orders.error}</Notice>}
          {orders.status === "ready" && orders.items.length === 0 && <p>No orders yet.</p>}
          {orders.items.map((o) => <OrderCard key={`${o.userId}-${o.orderId}`} order={o} showEmail />)}
        </>
      )}
    </section>
  );
}
