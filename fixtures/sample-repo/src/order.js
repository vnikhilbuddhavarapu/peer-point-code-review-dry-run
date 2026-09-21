export function orderTotal(items, discountRate = 0) {
  const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);
  return Number((subtotal * (1 + discountRate)).toFixed(2));
}

export function normalizeSku(value) {
  return value.trim().toUpperCase();
}
