import { useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type View =
  | "home"
  | "catalog"
  | "product"
  | "cart"
  | "checkout"
  | "declined"
  | "recovery"
  | "admin";

function App() {
  const [view, setView] = useState<View>("home");
  const [cartCount, setCartCount] = useState(0);
  const role = localStorage.getItem("statescryRole") ?? "customer";

  const navigate = (next: View) => {
    history.pushState({}, "", `#${next}`);
    setView(next);
  };

  return (
    <div className="app-shell">
      <header>
        <button
          className="wordmark"
          data-statescry-action="home"
          onClick={() => navigate("home")}
        >
          Atlas Supply
        </button>
        <nav aria-label="Primary navigation">
          <button data-testid="catalog-nav" onClick={() => navigate("catalog")}>
            Catalog
          </button>
          <button data-testid="cart-nav" onClick={() => navigate("cart")}>
            Cart ({cartCount})
          </button>
          {role === "admin" ? (
            <button data-testid="admin-nav" onClick={() => navigate("admin")}>
              Admin console
            </button>
          ) : null}
        </nav>
        <span className="role-chip">{role}</span>
      </header>

      <main>
        {view === "home" ? (
          <section className="hero">
            <p className="kicker">Field equipment · tested hard</p>
            <h1>Prepare for the route nobody planned.</h1>
            <p>
              Modular field kits for people who need their equipment to work
              beyond the edge of the map.
            </p>
            <button
              data-testid="browse-catalog"
              onClick={() => navigate("catalog")}
            >
              Browse field kits
            </button>
          </section>
        ) : null}

        {view === "catalog" ? (
          <section>
            <p className="kicker">Three expedition systems</p>
            <h1>Field kit catalog</h1>
            <div className="products">
              <article>
                <span>01</span>
                <h2>Atlas Relay</h2>
                <p>Power, light, and offline positioning in one sealed pack.</p>
                <div>
                  <button
                    data-testid="inspect-atlas"
                    onClick={() => navigate("product")}
                  >
                    Inspect kit
                  </button>
                  <button
                    data-testid="add-atlas"
                    onClick={() => setCartCount((count) => count + 1)}
                  >
                    Add Atlas Relay
                  </button>
                </div>
              </article>
              <article>
                <span>02</span>
                <h2>Northline Medical</h2>
                <p>A compact response kit organized for low-light access.</p>
              </article>
            </div>
            {cartCount > 0 ? (
              <div className="notice" role="status">
                Atlas Relay added. Your cart now contains {cartCount} item.
              </div>
            ) : null}
          </section>
        ) : null}

        {view === "product" ? (
          <section className="split">
            <div>
              <p className="kicker">System 01 · 4.8 kg</p>
              <h1>Atlas Relay field kit</h1>
              <p>
                A repairable, weather-sealed platform with offline maps,
                emergency power, and replaceable modules.
              </p>
              <button
                data-testid="add-product"
                onClick={() => {
                  setCartCount((count) => count + 1);
                  navigate("cart");
                }}
              >
                Add kit and view cart
              </button>
            </div>
            <div
              className="product-visual"
              aria-label="Atlas Relay equipment case"
            >
              AR–01
            </div>
          </section>
        ) : null}

        {view === "cart" ? (
          <section>
            <p className="kicker">Order preparation</p>
            <h1>
              {cartCount > 0 ? "Your field loadout" : "Your cart is empty"}
            </h1>
            {cartCount > 0 ? (
              <>
                <div className="line-item">
                  <div>
                    <strong>Atlas Relay</strong>
                    <span>Quantity {cartCount}</span>
                  </div>
                  <strong>${(849 * cartCount).toLocaleString()}</strong>
                </div>
                <button
                  data-testid="review-checkout"
                  onClick={() => navigate("checkout")}
                >
                  Review checkout
                </button>
                <button onClick={() => setCartCount(0)}>
                  Remove all items
                </button>
              </>
            ) : (
              <button
                data-testid="empty-browse"
                onClick={() => navigate("catalog")}
              >
                Find a field kit
              </button>
            )}
          </section>
        ) : null}

        {view === "checkout" ? (
          <section>
            <p className="kicker">Secure checkout · step 2 of 2</p>
            <h1>Confirm expedition order</h1>
            <div className="checkout-grid">
              <div>
                <h2>Delivery</h2>
                <p>Vansh · Base camp pickup · Priority dispatch</p>
              </div>
              <div>
                <h2>Total</h2>
                <p>${(849 * Math.max(cartCount, 1)).toLocaleString()}</p>
              </div>
            </div>
            <button
              data-testid="simulate-decline"
              onClick={() => navigate("declined")}
            >
              Simulate declined card
            </button>
            <button data-testid="confirm-purchase">Confirm purchase</button>
          </section>
        ) : null}

        {view === "declined" ? (
          <section className="error-state">
            <p className="kicker">Payment response · declined</p>
            <h1>The card could not be authorized.</h1>
            <p>
              No charge was created. Choose a recovery path to preserve the
              order.
            </p>
            <button
              data-testid="recovery-options"
              onClick={() => navigate("recovery")}
            >
              View recovery options
            </button>
            <button onClick={() => navigate("cart")}>Return to cart</button>
          </section>
        ) : null}

        {view === "recovery" ? (
          <section>
            <p className="kicker">Order preserved for 14:52</p>
            <h1>Choose another payment method</h1>
            <div className="choice-grid">
              <button onClick={() => navigate("checkout")}>
                Try another card
              </button>
              <button onClick={() => navigate("checkout")}>
                Use bank transfer
              </button>
            </div>
          </section>
        ) : null}

        {view === "admin" && role === "admin" ? (
          <section>
            <p className="kicker">Restricted workspace</p>
            <h1>Admin refund console</h1>
            <div className="admin-panel">
              <div>
                <span>Pending refunds</span>
                <strong>12</strong>
              </div>
              <div>
                <span>API tokens</span>
                <strong>3 active</strong>
              </div>
            </div>
            <button data-testid="approve-refund">Approve refund</button>
            <button>Delete customer account</button>
          </section>
        ) : null}
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Demo root was not found.");
createRoot(root).render(<App />);
