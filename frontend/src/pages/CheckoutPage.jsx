import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useCart } from "../cart.jsx";
import { formatMoney } from "../money.js";
import Notice from "../components/Notice.jsx";

const PAYMENT_OPTIONS = [
  { value: "TEST_SUCCESS", label: "Test payment: succeeds", help: "Pretend card payment that works." },
  { value: "TEST_DECLINED", label: "Test payment: declined", help: "Pretend card payment that fails, so you can see the failure case." },
  { value: "COD", label: "Pay on delivery", help: "Order is placed; you pay when it arrives." },
];

export default function CheckoutPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", phone: "", address: "", city: "", pincode: "" });
  const [paymentMethod, setPaymentMethod] = useState("TEST_SUCCESS");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return; // stops a double click from placing two orders
    setBusy(true);
    setError("");
    try {
      const data = await api("/orders", {
        method: "POST",
        auth: true,
        body: {
          items: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          paymentMethod,
          shipping: form,
        },
      });
      cart.clear();
      navigate("/orders", { replace: true, state: { justPlaced: data.order.orderId } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (cart.lines.length === 0) {
    return (
      <section>
        <h1>Checkout</h1>
        <p>Your cart is empty.</p>
        <p><Link className="button" to="/">Start shopping</Link></p>
      </section>
    );
  }

  return (
    <section>
      <h1>Checkout</h1>
      <Notice kind="info">
        This is a demo store. No real money is ever taken. Please do not type real card details anywhere.
      </Notice>
      {error && (
        <Notice kind="error">
          {error} <Link to="/cart">Review your cart</Link>
        </Notice>
      )}

      <div className="checkout-layout">
        <form onSubmit={handleSubmit} className="form">
          <h2>Delivery details</h2>
          <label>Full name
            <input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={set("name")} />
          </label>
          <label>Mobile number
            <input required inputMode="numeric" autoComplete="tel" placeholder="10-digit number" value={form.phone} onChange={set("phone")} />
          </label>
          <label>Address
            <input required minLength={5} maxLength={200} autoComplete="street-address" value={form.address} onChange={set("address")} />
          </label>
          <label>City
            <input required minLength={2} maxLength={60} autoComplete="address-level2" value={form.city} onChange={set("city")} />
          </label>
          <label>PIN code
            <input required inputMode="numeric" pattern="[1-9][0-9]{5}" title="6-digit PIN code" autoComplete="postal-code" value={form.pincode} onChange={set("pincode")} />
          </label>

          <fieldset>
            <legend>Payment</legend>
            {PAYMENT_OPTIONS.map((o) => (
              <label key={o.value} className="radio">
                <input type="radio" name="payment" value={o.value} checked={paymentMethod === o.value} onChange={() => setPaymentMethod(o.value)} />
                <span><strong>{o.label}</strong><br /><span className="muted small">{o.help}</span></span>
              </label>
            ))}
          </fieldset>

          <button type="submit" className="button wide" disabled={busy}>
            {busy ? "Placing order…" : `Place order · ${formatMoney(cart.totalPaise)}`}
          </button>
        </form>

        <aside className="summary">
          <h2>Order summary</h2>
          {cart.lines.map((l) => (
            <div key={l.productId} className="summary-row">
              <span>{l.name} × {l.quantity}</span>
              <span>{formatMoney(l.pricePaise * l.quantity)}</span>
            </div>
          ))}
          <div className="summary-row"><span>Delivery</span><span>{cart.deliveryPaise === 0 ? "Free" : formatMoney(cart.deliveryPaise)}</span></div>
          <div className="summary-row total"><span>Total</span><span>{formatMoney(cart.totalPaise)}</span></div>
        </aside>
      </div>
    </section>
  );
}
