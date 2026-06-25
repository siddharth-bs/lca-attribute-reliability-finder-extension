// Product catalogue
const PRODUCTS = [
  { id: 'p1', name: 'Wireless Headphones Pro', price: 149.99, emoji: '🎧', category: 'Electronics', rating: 4.8, reviews: 2341, desc: 'Premium ANC with 40-hour battery, spatial audio, and foldable design.' },
  { id: 'p2', name: 'Mechanical Keyboard TKL', price: 189.99, emoji: '⌨️', category: 'Electronics', rating: 4.7, reviews: 1876, desc: 'Hot-swappable switches, per-key RGB, aluminium frame, USB-C.' },
  { id: 'p3', name: 'Trail Running Shoes', price: 129.99, emoji: '👟', category: 'Footwear',    rating: 4.6, reviews: 3102, desc: 'Lightweight mesh upper, Vibram outsole, responsive foam midsole.' },
  { id: 'p4', name: 'Smart Coffee Maker',    price: 89.99,  emoji: '☕', category: 'Kitchen',     rating: 4.5, reviews: 987,  desc: 'Wi-Fi connected, 12-cup, programmable timer, thermal carafe.' },
  { id: 'p5', name: 'Yoga Mat Premium',      price: 59.99,  emoji: '🧘', category: 'Fitness',     rating: 4.9, reviews: 4521, desc: '6mm thick, non-slip, alignment lines, eco-friendly TPE.' },
  { id: 'p6', name: 'LED Desk Lamp',         price: 49.99,  emoji: '💡', category: 'Home',        rating: 4.4, reviews: 1234, desc: 'Adjustable colour temp 2700K–6500K, USB-C charging, touch dimmer.' },
  { id: 'p7', name: 'Portable SSD 1TB',      price: 109.99, emoji: '💾', category: 'Electronics', rating: 4.8, reviews: 2890, desc: '1050MB/s read, USB 3.2 Gen 2, shock-resistant, pocket-sized.' },
  { id: 'p8', name: 'Stainless Water Bottle', price: 34.99, emoji: '🍶', category: 'Fitness',     rating: 4.7, reviews: 5678, desc: 'Double-wall vacuum insulation, 24h cold / 12h hot, 750ml.' },
];

// Dynamic value generators (simulate CSS-in-JS / framework-generated attrs)
function rHex(n) { return Array.from({length:n}, () => Math.floor(Math.random()*16).toString(16)).join(''); }
function rAlpha(n) { const c='abcdefghijklmnopqrstuvwxyz0123456789'; return Array.from({length:n}, () => c[Math.floor(Math.random()*c.length)]).join(''); }
function dynClass(base) { return `css-${rHex(6)} ${base}`; }
function dynId(base)    { return `${base}-${rAlpha(5)}`; }
function dynTid(base)   { return `${base}-${rHex(4)}`; }

// Cart state
let cart = JSON.parse(sessionStorage.getItem('lumina_cart') || '[]');
function saveCart() { sessionStorage.setItem('lumina_cart', JSON.stringify(cart)); }
function cartCount() { return cart.reduce((s, i) => s + i.qty, 0); }
function cartTotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

function addToCart(productId) {
  const p = PRODUCTS.find(x => x.id === productId);
  if (!p) return;
  const ex = cart.find(i => i.id === productId);
  if (ex) ex.qty++; else cart.push({ ...p, qty: 1 });
  saveCart();
  updateCartBadge();
  showToast(`${p.emoji} ${p.name} added to cart`);
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== productId);
  saveCart();
  updateCartBadge();
}

function updateQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  saveCart();
}

function updateCartBadge() {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = cartCount();
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function stars(rating) {
  return '★'.repeat(Math.floor(rating)) + (rating % 1 >= 0.5 ? '½' : '') + '☆'.repeat(5 - Math.ceil(rating));
}