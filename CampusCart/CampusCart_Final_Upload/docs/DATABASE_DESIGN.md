# Database Design

| Collection | Key fields and purpose |
|---|---|
| `users` | name, unique lowercase email, passwordHash, role, status, sessionVersion, phone, address. `sessionVersion` invalidates access/refresh credentials when a seller is suspended. Password hash is excluded from normal queries. |
| `categories` | unique name and slug, description, active flag. |
| `products` | name, description, unique SKU, price, category ref, seller ref, stock, lowStockThreshold, image URLs, active flag. |
| `carts` | unique customer user ref and item array of product refs plus quantity. |
| `orders` | checkoutGroupId, customer, seller, item snapshots, subtotal/total, status, shipping address snapshot, simulated payment fields, cancellation metadata. |
| `refreshTokens` | user ref, token-family ID, SHA-256 tokenHash, expiry, revokedAt and replacedBy. TTL index cleans expired records; replay of an already-rotated token revokes the active family. |
| `inventoryMovements` | product, seller, actor, movement type, quantity delta, previous/new stock and reference. |
| `notifications` | user, event type, title/message, metadata, read flag and timestamps. |

## Relationships
```text
User(seller) 1 --- * Product * --- 1 Category
User(customer) 1 --- 1 Cart 1 --- * CartItem --- 1 Product
User(customer) 1 --- * Order * --- 1 User(seller)
Order 1 --- * OrderItem (product ref plus historical item snapshot)
Product 1 --- * InventoryMovement
User 1 --- * RefreshToken
User 1 --- * Notification
```

## Indexes
- `users.email` unique; `users.role + status` for admin filtering.
- `categories.name` and `categories.slug` unique.
- `products.sku` unique; text index over name/description/SKU; category/active/price; seller/createdAt; active/stock.
- `carts.user` unique.
- `orders.customer + createdAt`, `orders.seller + status + createdAt`, checkoutGroupId + customer.
- `refreshTokens.tokenHash` unique; `familyId` indexed for family-wide revocation; `expiresAt` TTL.
- `inventoryMovements.product` and seller + createdAt.
- `notifications.user + isRead + createdAt`.

## Transaction requirement
Checkout and cancellation use Mongoose sessions and transactions. Run MongoDB as a replica set; standalone MongoDB does not satisfy this requirement. The supplied Docker Compose configuration starts a one-node local replica set.
