import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "../session.jsx";

// Wrap a page in this and only signed-in shoppers can see it.
// Everyone else is sent to the login page, then brought back here afterwards.
export default function RequireAuth({ children }) {
  const { user } = useSession();
  const location = useLocation();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}
