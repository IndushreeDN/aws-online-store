import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import ProductCard from "../components/ProductCard.jsx";
import Notice from "../components/Notice.jsx";

export default function Home() {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await api("/products");
      setProducts(data.products);
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => ["All", ...new Set(products.map((p) => p.category))], [products]);

  const visible = useMemo(() => {
    const text = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!text || p.name.toLowerCase().includes(text) || (p.description ?? "").toLowerCase().includes(text)),
    );
  }, [products, search, category]);

  return (
    <section>
      <h1>Shop</h1>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search products"
          aria-label="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="chips" role="group" aria-label="Categories">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={c === category ? "chip active" : "chip"}
              aria-pressed={c === category}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {status === "loading" && <p className="muted">Loading products…</p>}
      {status === "error" && (
        <Notice kind="error">
          {error} <button type="button" className="link-button" onClick={load}>Try again</button>
        </Notice>
      )}
      {status === "ready" && products.length === 0 && (
        <Notice kind="info">
          There are no products yet. If you are the owner, add the sample products (see the guide, Step 6) or add one in the Admin page.
        </Notice>
      )}
      {status === "ready" && products.length > 0 && visible.length === 0 && (
        <p className="muted">No products match your search.</p>
      )}
      <div className="grid">
        {visible.map((p) => (
          <ProductCard key={p.productId} product={p} />
        ))}
      </div>
    </section>
  );
}
