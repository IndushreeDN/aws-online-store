import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api.js";
import { formatMoney } from "../money.js";
import Notice from "../components/Notice.jsx";

export const PAYMENT_LABELS = {
  PAID: "Paid (test payment)",
  PAY_ON_DELIVERY: "Pay on delivery",
};

export function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function OrderCard({ order, showEmail = false }) {
  return (
    <article className="order">
      <header className="order-head">
        <div>
          <strong>Order {order.orderId}</strong>
          <p className="muted small">{formatDate(order.createdAt)}{showEmail && order.email ? ` · ${order.email}` : ""}</p>
        </div>
        <div className="right">
          <strong>{formatMoney(order.totalPaise)}</strong>
          <p className="muted small">{PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus}</p>
        </div>
      </header>
      <ul className="order-items">
        {order.items.map((i) => (
          <li key={i.productId}>{i.name} × {i.quantity} <span className="muted">({formatMoney(i.pricePaise * i.quantity)})</span></li>
        ))}
      </ul>
      <p className="muted small">
        Delivering to {order.shipping.name}, {order.shipping.address}, {order.shipping.city} {order.shipping.pincode}
      </p>
    </article>
  );
}

export default function OrdersPage() {
  const location = useLocation();
  const justPlaced = location.state?.justPlaced;
  const [state, setState] = useState({ status: "loading", orders: [], error: "" });

  useEffect(() => {
    let cancelled = false;
    api("/orders", { auth: true })
      .then((data) => !cancelled && setState({ status: "ready", orders: data.orders, error: "" }))
      .catch((err) => !cancelled && setState({ status: "error", orders: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h1>My orders</h1>
      {justPlaced && (
        <Notice kind="success">
          Thank you! Your order <strong>{justPlaced}</strong> has been placed.
        </Notice>
      )}
      {state.status === "loading" && <p className="muted">Loading your orders…</p>}
      {state.status === "error" && <Notice kind="error">{state.error}</Notice>}
      {state.status === "ready" && state.orders.length === 0 && (
        <p>You have not placed any orders yet. <Link to="/">Start shopping</Link></p>
      )}
      {state.orders.map((o) => <OrderCard key={o.orderId} order={o} />)}
    </section>
  );
}
