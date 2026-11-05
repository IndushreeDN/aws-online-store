import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { formatMoney, MAX_QUANTITY } from "../money.js";
import { useCart } from "../cart.jsx";
import Notice from "../components/Notice.jsx";
import { stockLabel } from "../components/ProductCard.jsx";

export default function ProductPage() {
  const { id } = useParams();
  const cart = useCart();
  const [state, setState] = useState({ status: "loading", product: null, error: "" });
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", product: null, error: "" });
    setQuantity(1);
    setAdded(false);
    api(`/products/${encodeURIComponent(id)}`)
      .then((data) => !cancelled && setState({ status: "ready", product: data.product, error: "" }))
      .catch((err) => !cancelled && setState({ status: "error", product: null, error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === "loading") return <p className="muted">Loading…</p>;
  if (state.status === "error") {
    return (
      <>
        <Notice kind="error">{state.error}</Notice>
        <p><Link to="/">← Back to the shop</Link></p>
      </>
    );
  }

  const p = state.product;
  const status = stockLabel(p.stock);
  const maxQty = Math.min(MAX_QUANTITY, p.stock);

  function handleAdd() {
    cart.add(p, quantity);
    setAdded(true);
  }

  return (
    <section className="product-page">
      <p><Link to="/">← Back to the shop</Link></p>
      <div className="product-layout">
        <img className="product-image" src={p.imageUrl} alt={p.name} />
        <div>
          <p className="muted small">{p.category}</p>
          <h1>{p.name}</h1>
          <p className="price big">{formatMoney(p.pricePaise)}</p>
          <p className={status.className}>{status.text}</p>
          <p>{p.description}</p>
          {p.stock > 0 && (
            <div className="row">
              <label htmlFor="qty">Quantity</label>
              <select id="qty" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
                {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <button type="button" className="button" onClick={handleAdd}>Add to cart</button>
            </div>
          )}
          {added && (
            <Notice kind="success">
              Added to your cart. <Link to="/cart">View cart</Link>
            </Notice>
          )}
        </div>
      </div>
    </section>
  );
}
