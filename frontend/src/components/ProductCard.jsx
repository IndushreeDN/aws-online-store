import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatMoney } from "../money.js";
import { useCart } from "../cart.jsx";

export function stockLabel(stock) {
  if (stock <= 0) return { text: "Out of stock", className: "stock out" };
  if (stock <= 5) return { text: `Only ${stock} left`, className: "stock low" };
  return { text: "In stock", className: "stock" };
}

export default function ProductCard({ product }) {
  const cart = useCart();
  const [added, setAdded] = useState(false);
  const timer = useRef(null);
  const status = stockLabel(product.stock);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleAdd() {
    cart.add(product, 1);
    setAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1500);
  }

  return (
    <article className="card">
      <Link to={`/product/${product.productId}`} className="card-image">
        <img src={product.imageUrl} alt={product.name} loading="lazy" />
      </Link>
      <div className="card-body">
        <p className="muted small">{product.category}</p>
        <h3 className="card-title">
          <Link to={`/product/${product.productId}`}>{product.name}</Link>
        </h3>
        <p className="price">{formatMoney(product.pricePaise)}</p>
        <p className={status.className}>{status.text}</p>
        <button type="button" className="button" disabled={product.stock <= 0} onClick={handleAdd}>
          {added ? "Added ✓" : "Add to cart"}
        </button>
      </div>
    </article>
  );
}
