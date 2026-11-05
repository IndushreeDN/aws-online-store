import { Link, NavLink, useNavigate } from "react-router-dom";
import { config } from "../config.js";
import { signOut } from "../auth.js";
import { useSession } from "../session.jsx";
import { useCart } from "../cart.jsx";

export default function Header() {
  const { user } = useSession();
  const { count } = useCart();
  const navigate = useNavigate();

  function handleSignOut() {
    signOut();
    navigate("/");
  }

  return (
    <header className="site-header">
      <div className="container header-row">
        <Link to="/" className="brand">
          <span aria-hidden="true">🛍️</span> {config.storeName}
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Shop</NavLink>
          <NavLink to="/cart">
            Cart{count > 0 && <span className="badge" aria-label={`${count} items in cart`}>{count}</span>}
          </NavLink>
          {user && <NavLink to="/orders">My orders</NavLink>}
          {user?.isAdmin && <NavLink to="/admin">Admin</NavLink>}
          {user ? (
            <>
              <span className="who" title={user.email}>{user.email}</span>
              <button type="button" className="link-button" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <NavLink to="/login">Sign in</NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}
