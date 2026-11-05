import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SessionProvider } from "./session.jsx";
import { CartProvider } from "./cart.jsx";
import App from "./App.jsx";
import { config } from "./config.js";
import "./styles.css";

document.title = config.storeName;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
