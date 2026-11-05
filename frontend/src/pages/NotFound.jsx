import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section>
      <h1>Page not found</h1>
      <p>We could not find that page.</p>
      <p><Link className="button" to="/">Go to the shop</Link></p>
    </section>
  );
}
