/**
 * Lumina Store — SPA Router & Page Renderers
 *
 * STABLE attrs (extension should score ≥ 70):
 *   id, data-testid, name, type, aria-label, placeholder, role, autocomplete
 *
 * DYNAMIC attrs (extension should score < 40):
 *   class (CSS-in-JS hashes), data-render-id (random), data-ts (timestamp)
 */

// ── Router ────────────────────────────────────────────────────────────────────
function getRoute() {
  const h = location.hash || '#/';
  if (h.startsWith('#/product/')) return { page: 'product', id: h.replace('#/product/', '') };
  if (h === '#/products') return { page: 'products' };
  if (h === '#/cart')     return { page: 'cart' };
  if (h === '#/checkout') return { page: 'checkout' };
  if (h === '#/account')  return { page: 'account' };
  if (h === '#/login')    return { page: 'login' };
  if (h === '#/success')  return { page: 'success' };
  return { page: 'home' };
}

window.addEventListener('hashchange', render);
window.addEventListener('load', () => { updateCartBadge(); render(); });

function updateNav() {
  const r = getRoute();
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.remove('active');
    const href = a.getAttribute('href');
    if (r.page === 'home'     && href === '#/')         a.classList.add('active');
    if (r.page === 'products' && href === '#/products') a.classList.add('active');
    if ((r.page === 'cart' || r.page === 'checkout') && href === '#/cart') a.classList.add('active');
    if ((r.page === 'account' || r.page === 'login') && href === '#/account') a.classList.add('active');
  });
  // Inject dynamic data-render-id on nav (DYNAMIC)
  const nav = document.getElementById('main-nav');
  if (nav) nav.setAttribute('data-render-id', `rd-${rHex(8)}`);
}

function render() {
  updateNav();
  const root = document.getElementById('app-root');
  if (!root) return;
  const r = getRoute();
  const pages = { home: renderHome, products: renderProducts, product: renderProduct, cart: renderCart, checkout: renderCheckout, account: renderAccount, login: renderLogin, success: renderSuccess };
  root.innerHTML = (pages[r.page] || renderHome)(r);
  attachEvents(r);
}

// ── Home ──────────────────────────────────────────────────────────────────────
function renderHome() {
  const featured = PRODUCTS.slice(0, 4);
  return `
  <div class="hero">
    <div class="container">
      <h1>Discover Premium Products</h1>
      <p>Curated selection of electronics, fitness gear, and home essentials. Free shipping on orders over $75.</p>
      <div class="hero-actions">
        <a href="#/products" id="hero-shop-btn" data-testid="hero-shop-btn" class="${dynClass('btn btn-primary btn-lg')}" aria-label="Shop all products" role="link">Shop Now →</a>
        <a href="#/account" id="hero-account-btn" data-testid="hero-account-btn" class="${dynClass('btn btn-secondary btn-lg')}" aria-label="View my account" role="link">My Account</a>
      </div>
    </div>
  </div>
  <div class="features-strip">
    <div class="feature-item" id="feat-shipping" data-testid="feat-shipping"><div class="feature-icon">🚚</div><div class="feature-text"><strong>Free Shipping</strong><span>On orders over $75</span></div></div>
    <div class="feature-item" id="feat-returns"  data-testid="feat-returns"><div class="feature-icon">↩️</div><div class="feature-text"><strong>30-Day Returns</strong><span>Hassle-free returns</span></div></div>
    <div class="feature-item" id="feat-support"  data-testid="feat-support"><div class="feature-icon">💬</div><div class="feature-text"><strong>24/7 Support</strong><span>Always here to help</span></div></div>
    <div class="feature-item" id="feat-secure"   data-testid="feat-secure"><div class="feature-icon">🔒</div><div class="feature-text"><strong>Secure Checkout</strong><span>256-bit SSL</span></div></div>
  </div>
  <div class="container page-content">
    <div class="section">
      <div class="section-header">
        <h2>Featured Products</h2>
        <a href="#/products" id="view-all-link" data-testid="view-all-link" class="${dynClass('btn btn-secondary btn-sm')}" aria-label="View all products">View All →</a>
      </div>
      <div class="grid-4">${featured.map(p => productCard(p)).join('')}</div>
    </div>
  </div>`;
}

// ── Products ──────────────────────────────────────────────────────────────────
function renderProducts() {
  return `
  <div class="container page-content">
    <div class="section-header">
      <h2>All Products</h2>
      <select id="sort-select" name="sortBy" data-testid="sort-select" aria-label="Sort products by" class="form-input" style="width:180px">
        <option value="default">Sort: Default</option>
        <option value="price-asc">Price: Low to High</option>
        <option value="price-desc">Price: High to Low</option>
        <option value="rating">Top Rated</option>
      </select>
    </div>
    <div class="grid-4" id="products-grid" data-testid="products-grid" role="list" aria-label="Product catalogue">
      ${PRODUCTS.map(p => productCard(p)).join('')}
    </div>
  </div>`;
}

function productCard(p) {
  return `
  <div class="card product-card ${dynClass('')}" id="${dynId('product-card-'+p.id)}" data-testid="product-card-${p.id}" data-ts="${Date.now()}" role="listitem" aria-label="${p.name} product card">
    <div class="product-img">${p.emoji}</div>
    <div class="product-info">
      <div class="product-category">${p.category}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-rating">${stars(p.rating)} <span style="color:var(--muted)">(${p.reviews.toLocaleString()})</span></div>
      <div class="product-price">$${p.price.toFixed(2)}</div>
      <div class="product-actions">
        <a href="#/product/${p.id}" id="view-${p.id}" data-testid="view-product-${p.id}" class="${dynClass('btn btn-secondary btn-sm')}" aria-label="View ${p.name} details">View</a>
        <button id="${dynId('add-'+p.id)}" data-testid="add-to-cart-${p.id}" data-product-id="${p.id}" class="${dynClass('btn btn-success btn-sm add-cart-btn')}" type="button" name="addToCart" aria-label="Add ${p.name} to cart" role="button">+ Cart</button>
      </div>
    </div>
  </div>`;
}

// ── Product Detail ────────────────────────────────────────────────────────────
function renderProduct(r) {
  const p = PRODUCTS.find(x => x.id === r.id);
  if (!p) return `<div class="container page-content"><div class="empty-state"><div class="icon">🔍</div><h3>Product not found</h3></div></div>`;
  return `
  <div class="container page-content">
    <div class="breadcrumb">
      <a href="#/" data-testid="bc-home">Home</a><span class="breadcrumb-sep">›</span>
      <a href="#/products" data-testid="bc-products">Products</a><span class="breadcrumb-sep">›</span>
      <span>${p.name}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start">
      <div style="height:360px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);display:flex;align-items:center;justify-content:center;font-size:120px" id="product-image-${p.id}" data-testid="product-image-${p.id}">${p.emoji}</div>
      <div class="${dynClass('product-detail-info')}" id="${dynId('product-info-'+p.id)}" data-testid="product-info-${p.id}" data-render-id="${rHex(8)}">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">${p.category}</div>
        <h1 style="margin-bottom:8px">${p.name}</h1>
        <div class="product-rating" style="margin-bottom:12px">${stars(p.rating)} <span style="color:var(--muted);font-size:12px">${p.reviews.toLocaleString()} reviews</span></div>
        <div style="font-size:32px;font-weight:800;color:var(--green);margin-bottom:16px" id="product-price-${p.id}" data-testid="product-price-${p.id}">$${p.price.toFixed(2)}</div>
        <p style="margin-bottom:20px">${p.desc}</p>
        <div style="display:flex;gap:12px;align-items:center">
          <div class="qty-ctrl" id="qty-ctrl-${p.id}" data-testid="qty-ctrl-${p.id}">
            <button class="qty-btn" data-product-id="${p.id}" data-action="dec" type="button" aria-label="Decrease quantity">−</button>
            <span class="qty-val" id="qty-val-${p.id}" data-testid="qty-val-${p.id}">1</span>
            <button class="qty-btn" data-product-id="${p.id}" data-action="inc" type="button" aria-label="Increase quantity">+</button>
          </div>
          <button id="${dynId('add-detail-'+p.id)}" data-testid="add-to-cart-detail-${p.id}" data-product-id="${p.id}" class="${dynClass('btn btn-success add-cart-btn')}" type="button" name="addToCart" aria-label="Add ${p.name} to cart" role="button">🛒 Add to Cart</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ── Cart ──────────────────────────────────────────────────────────────────────
function renderCart() {
  if (!cart.length) return `
  <div class="container page-content">
    <div class="empty-state">
      <div class="icon">🛒</div><h3>Your cart is empty</h3>
      <p style="margin:8px 0 20px">Add some products to get started.</p>
      <a href="#/products" id="continue-shopping" data-testid="continue-shopping" class="${dynClass('btn btn-primary')}" aria-label="Continue shopping">Browse Products</a>
    </div>
  </div>`;
  const sub = cartTotal();
  const ship = sub >= 75 ? 0 : 9.99;
  return `
  <div class="container page-content">
    <h2 style="margin-bottom:20px">Shopping Cart <span style="color:var(--muted);font-size:14px;font-weight:400">(${cartCount()} items)</span></h2>
    <div class="cart-layout">
      <div id="cart-items" data-testid="cart-items" role="list" aria-label="Cart items">
        ${cart.map(item => `
        <div class="cart-item ${dynClass('')}" id="${dynId('cart-item-'+item.id)}" data-testid="cart-item-${item.id}" data-ts="${Date.now()}" role="listitem" aria-label="${item.name} in cart">
          <div class="cart-item-img">${item.emoji}</div>
          <div class="cart-item-info">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-price">$${item.price.toFixed(2)} each</div>
          </div>
          <div class="qty-ctrl">
            <button class="qty-btn cart-qty-btn" data-product-id="${item.id}" data-action="dec" type="button" aria-label="Decrease ${item.name} quantity">−</button>
            <span class="qty-val">${item.qty}</span>
            <button class="qty-btn cart-qty-btn" data-product-id="${item.id}" data-action="inc" type="button" aria-label="Increase ${item.name} quantity">+</button>
          </div>
          <button class="btn btn-danger btn-sm remove-btn" id="${dynId('remove-'+item.id)}" data-testid="remove-${item.id}" data-product-id="${item.id}" type="button" name="removeItem" aria-label="Remove ${item.name} from cart">Remove</button>
        </div>`).join('')}
      </div>
      <div class="order-card" id="cart-summary" data-testid="cart-summary" aria-label="Cart order summary">
        <h3 style="margin-bottom:16px">Order Summary</h3>
        <div class="order-row"><span>Subtotal</span><span>$${sub.toFixed(2)}</span></div>
        <div class="order-row"><span>Shipping</span><span>${ship === 0 ? '<span class="badge badge-green">FREE</span>' : '$'+ship.toFixed(2)}</span></div>
        <div class="order-row"><span>Total</span><span>$${(sub+ship).toFixed(2)}</span></div>
        <a href="#/checkout" id="checkout-btn" data-testid="checkout-btn" class="${dynClass('btn btn-primary')}" style="width:100%;margin-top:16px;display:flex" aria-label="Proceed to checkout" role="link">Checkout →</a>
      </div>
    </div>
  </div>`;
}

// ── Checkout ──────────────────────────────────────────────────────────────────
function renderCheckout() {
  const sub = cartTotal();
  const ship = sub >= 75 ? 0 : 9.99;
  return `
  <div class="container page-content">
    <h2 style="margin-bottom:24px">Checkout</h2>
    <div class="cart-layout">
      <div>
        <h3 style="margin-bottom:16px">Shipping Information</h3>
        <form id="checkout-form" name="checkoutForm" data-testid="checkout-form" action="/checkout/submit" method="post" aria-label="Checkout shipping form" role="form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label" for="first-name">First Name</label>
              <input class="${dynClass('form-input')}" id="first-name" name="firstName" type="text" data-testid="first-name-input" placeholder="Jane" autocomplete="given-name" aria-label="First name" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="last-name">Last Name</label>
              <input class="${dynClass('form-input')}" id="last-name" name="lastName" type="text" data-testid="last-name-input" placeholder="Doe" autocomplete="family-name" aria-label="Last name" required />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="email">Email Address</label>
            <input class="${dynClass('form-input')}" id="email" name="email" type="email" data-testid="email-input" placeholder="jane@example.com" autocomplete="email" aria-label="Email address" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="address">Street Address</label>
            <input class="${dynClass('form-input')}" id="address" name="address" type="text" data-testid="address-input" placeholder="123 Main Street" autocomplete="street-address" aria-label="Street address" required />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label" for="city">City</label>
              <input class="${dynClass('form-input')}" id="city" name="city" type="text" data-testid="city-input" placeholder="San Francisco" autocomplete="address-level2" aria-label="City" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="zip">ZIP Code</label>
              <input class="${dynClass('form-input')}" id="zip" name="zipCode" type="text" data-testid="zip-input" placeholder="94102" autocomplete="postal-code" aria-label="ZIP code" required />
            </div>
          </div>
          <h3 style="margin:20px 0 16px">Payment</h3>
          <div class="form-group">
            <label class="form-label" for="card-number">Card Number</label>
            <input class="${dynClass('form-input')}" id="card-number" name="cardNumber" type="text" data-testid="card-number-input" placeholder="4242 4242 4242 4242" autocomplete="cc-number" aria-label="Credit card number" maxlength="19" required />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label" for="card-expiry">Expiry</label>
              <input class="${dynClass('form-input')}" id="card-expiry" name="cardExpiry" type="text" data-testid="card-expiry-input" placeholder="MM/YY" autocomplete="cc-exp" aria-label="Card expiry date" maxlength="5" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="card-cvv">CVV</label>
              <input class="${dynClass('form-input')}" id="card-cvv" name="cardCvv" type="text" data-testid="card-cvv-input" placeholder="123" autocomplete="cc-csc" aria-label="Card CVV" maxlength="4" required />
            </div>
          </div>
          <button id="place-order-btn" data-testid="place-order-btn" name="placeOrder" type="submit" class="${dynClass('btn btn-primary btn-lg')}" style="width:100%;margin-top:8px" aria-label="Place order and complete purchase" role="button">✅ Place Order — $${(sub+ship).toFixed(2)}</button>
        </form>
      </div>
      <div class="order-card" aria-label="Order summary">
        <h3 style="margin-bottom:16px">Your Order</h3>
        ${cart.map(i => `<div class="order-row"><span>${i.emoji} ${i.name} ×${i.qty}</span><span>$${(i.price*i.qty).toFixed(2)}</span></div>`).join('')}
        <div class="order-row"><span>Shipping</span><span>${ship===0?'FREE':'$'+ship.toFixed(2)}</span></div>
        <div class="order-row"><span>Total</span><span>$${(sub+ship).toFixed(2)}</span></div>
      </div>
    </div>
  </div>`;
}

// ── Account ───────────────────────────────────────────────────────────────────
function renderAccount() {
  return `
  <div class="container page-content">
    <h2 style="margin-bottom:24px">My Account</h2>
    <div class="account-layout">
      <div class="account-menu" id="account-sidebar" data-testid="account-sidebar">
        <div class="account-menu-item active" id="menu-profile" data-testid="menu-profile">👤 Profile</div>
        <div class="account-menu-item" id="menu-orders" data-testid="menu-orders">📦 Orders</div>
        <div class="account-menu-item" id="menu-wishlist" data-testid="menu-wishlist">❤️ Wishlist</div>
        <div class="account-menu-item" id="menu-settings" data-testid="menu-settings">⚙️ Settings</div>
        <div class="account-menu-item" id="menu-logout" data-testid="menu-logout" style="color:var(--red)">🚪 Sign Out</div>
      </div>
      <div class="account-content ${dynClass('')}" id="account-content" data-testid="account-content" data-render-id="${rHex(8)}">
        <h3 style="margin-bottom:20px">Profile Information</h3>
        <form id="profile-form" name="profileForm" data-testid="profile-form" action="/account/profile" method="post" aria-label="Profile update form" role="form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label" for="profile-first">First Name</label>
              <input class="${dynClass('form-input')}" id="profile-first" name="firstName" type="text" data-testid="profile-first-input" placeholder="Jane" autocomplete="given-name" aria-label="First name" value="Jane" />
            </div>
            <div class="form-group">
              <label class="form-label" for="profile-last">Last Name</label>
              <input class="${dynClass('form-input')}" id="profile-last" name="lastName" type="text" data-testid="profile-last-input" placeholder="Doe" autocomplete="family-name" aria-label="Last name" value="Doe" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="profile-email">Email</label>
            <input class="${dynClass('form-input')}" id="profile-email" name="email" type="email" data-testid="profile-email-input" placeholder="jane@example.com" autocomplete="email" aria-label="Email address" value="jane@example.com" />
          </div>
          <div class="form-group">
            <label class="form-label" for="profile-phone">Phone</label>
            <input class="${dynClass('form-input')}" id="profile-phone" name="phone" type="tel" data-testid="profile-phone-input" placeholder="+1 555 000 0000" autocomplete="tel" aria-label="Phone number" />
          </div>
          <button id="save-profile-btn" data-testid="save-profile-btn" name="saveProfile" type="submit" class="${dynClass('btn btn-primary')}" aria-label="Save profile changes" role="button">Save Changes</button>
        </form>
      </div>
    </div>
  </div>`;
}

// ── Login ─────────────────────────────────────────────────────────────────────
function renderLogin() {
  return `
  <div class="container">
    <div class="auth-card" id="login-card" data-testid="login-card" role="region" aria-label="Sign in form region">
      <div class="auth-title">Welcome Back</div>
      <form id="login-form" name="loginForm" data-testid="login-form" action="/auth/login" method="post" aria-label="Sign in form" role="form">
        <div class="form-group">
          <label class="form-label" for="login-email">Email Address</label>
          <input class="${dynClass('form-input')}" id="login-email" name="email" type="email" data-testid="login-email-input" placeholder="jane@example.com" autocomplete="email" aria-label="Email address" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="login-password">Password</label>
          <input class="${dynClass('form-input')}" id="login-password" name="password" type="password" data-testid="login-password-input" placeholder="Enter your password" autocomplete="current-password" aria-label="Password" required />
        </div>
        <button id="login-submit-btn" data-testid="login-submit-btn" name="loginSubmit" type="submit" class="${dynClass('btn btn-primary')}" style="width:100%" aria-label="Sign in to your account" role="button">Sign In →</button>
      </form>
      <p style="text-align:center;margin-top:16px;font-size:12px;color:var(--muted)">
        Don't have an account? <a href="#/account" id="register-link" data-testid="register-link" aria-label="Create a new account">Create one</a>
      </p>
    </div>
  </div>`;
}

// ── Success ───────────────────────────────────────────────────────────────────
function renderSuccess() {
  return `
  <div class="container page-content">
    <div class="empty-state">
      <div class="icon">🎉</div>
      <h2 style="color:#fff;margin-bottom:8px">Order Confirmed!</h2>
      <p style="margin-bottom:20px">Thank you for your purchase. You'll receive a confirmation email shortly.</p>
      <a href="#/" id="back-home-btn" data-testid="back-home-btn" class="${dynClass('btn btn-primary')}" aria-label="Return to home page" role="link">← Back to Home</a>
    </div>
  </div>`;
}

// ── Events ────────────────────────────────────────────────────────────────────
function attachEvents(r) {
  document.querySelectorAll('.add-cart-btn').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.productId));
  });
  document.querySelectorAll('.cart-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => { updateQty(btn.dataset.productId, btn.dataset.action === 'inc' ? 1 : -1); render(); });
  });
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => { removeFromCart(btn.dataset.productId); render(); });
  });
  document.querySelectorAll('.qty-btn:not(.cart-qty-btn)').forEach(btn => {
    btn.addEventListener('click', () => {
      const valEl = document.getElementById(`qty-val-${btn.dataset.productId}`);
      if (!valEl) return;
      let v = parseInt(valEl.textContent);
      v = btn.dataset.action === 'inc' ? v + 1 : Math.max(1, v - 1);
      valEl.textContent = v;
    });
  });
  const cf = document.getElementById('checkout-form');
  if (cf) cf.addEventListener('submit', e => { e.preventDefault(); cart = []; saveCart(); updateCartBadge(); location.hash = '#/success'; });
  const lf = document.getElementById('login-form');
  if (lf) lf.addEventListener('submit', e => { e.preventDefault(); location.hash = '#/account'; });
  const pf = document.getElementById('profile-form');
  if (pf) pf.addEventListener('submit', e => { e.preventDefault(); showToast('✅ Profile saved!'); });
  const checkout = document.getElementById('checkout-btn');
  if (checkout) checkout.addEventListener('click', e => { e.preventDefault(); location.hash = '#/checkout'; });
}