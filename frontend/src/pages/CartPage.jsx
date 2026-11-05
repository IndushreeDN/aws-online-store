import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useCart } from "../cart.jsx";
import { DELIVERY_FEE_PAISE, FREE_DELIVERY_FROM_PAISE, formatMoney } from "../money.js";
import Notice from "../components/Notice.jsx";

export default function CartPage() {
  const cart = useCart();
  const { syncWithCatalog } = cart;
  const [notices, setNotices] = useState([]);

  // When the cart opens, compare it with the latest prices and stock from the server.
  useEffect(() => {
    let cancelled = false;
    api("/products")
      .then((data) => {
        if (!cancelled) setNotices(syncWithCatalog(data.products));
      })
      .catch(() => {
        /* offline or API down: keep showing the saved cart; checkout will re-check anyway */
      });
    return () => {
      cancelled = true;
    };
  }, [syncWithCatalog]);

  if (cart.lines.length === 0) {
    return (
      <section>
        <h1>Your cart</h1>
        {notices.map((n) => <Notice key={n} kind="info">{n}</Notice>)}
        <p>Your cart is empty.</p>
        <p><Link className="button" to="/">Start shopping</Link></p>
      </section>
    );
  }

  const missingForFree = FREE_DELIVERY_FROM_PAISE - cart.subtotalPaise;

  return (
    <section>
      <h1>Your cart</h1>
      {notices.map((n) => <Notice key={n} kind="info">{n}</Notice>)}
      <ul className="cart-list">
        {cart.lines.map((l) => (
          <li key={l.productId} className="cart-line">
            <img src={l.imageUrl} alt="" />
            <div className="grow">
              <Link to={`/product/${l.productId}`}>{l.name}</Link>
              <p className="muted small">{formatMoney(l.pricePaise)} each</p>
              <div className="stepper">
                <button type="button" aria-label={`Decrease quantity of ${l.name}`} onClick={() => cart.setQuantity(l.productId, l.quantity - 1)} disabled={l.quantity <= 1}>−</button>
                <span aria-label={`Quantity of ${l.name}`}>{l.quantity}</span>
                <button type="button" aria-label={`Increase quantity of ${l.name}`} onClick={() => cart.setQuantity(l.productId, l.quantity + 1)}>+</button>
              </div>
            </div>
            <div className="line-total">
              <strong>{formatMoney(l.pricePaise * l.quantity)}</strong>
              <button type="button" className="link-button" onClick={() => cart.remove(l.productId)}>Remove</button>
            </div>
          </li>
        ))}
      </ul>

      <div className="summary">
        <div className="summary-row"><span>Subtotal</span><span>{formatMoney(cart.subtotalPaise)}</span></div>
        <div className="summary-row">
          <span>Delivery</span>
          <span>{cart.deliveryPaise === 0 ? "Free" : formatMoney(cart.deliveryPaise)}</span>
        </div>
        {cart.deliveryPaise > 0 && (
          <p className="muted small">
            Add {formatMoney(missingForFree)} more for free delivery (delivery is {formatMoney(DELIVERY_FEE_PAISE)} otherwise).
          </p>
        )}
        <div className="summary-row total"><span>Total</span><span>{formatMoney(cart.totalPaise)}</span></div>
        <Link className="button wide" to="/checkout">Checkout</Link>
      </div>
    </section>
  );
}
