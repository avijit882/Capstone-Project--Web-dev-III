# API Documentation

Base URL: `http://localhost:5000/api/v1`. Protected endpoints require `Authorization: Bearer <accessToken>`.

Successful responses use `{ success, message, data, meta? }`; errors use `{ success:false, message, details? }`. Paginated resources accept `page` and `limit` (maximum 100).

## Authentication
| Method | Endpoint | Access | Body / behavior |
|---|---|---|---|
| POST | `/auth/register` | Public | `{name,email,password,role?,phone?}`. Role may be customer or seller; sellers start pending. |
| POST | `/auth/login` | Public | `{email,password}`; returns access and refresh tokens. |
| POST | `/auth/refresh` | Public | `{refreshToken}`; rotates the token and revokes the previous token. Reuse of a rotated token revokes the active tokens in its family. |
| POST | `/auth/logout` | Public | `{refreshToken}`; invalidates that refresh token. |
| GET | `/auth/me` | Authenticated | Current user profile. |
| PATCH | `/auth/me` | Authenticated | `{name?,phone?,address?}`. |

## Categories
| Method | Endpoint | Access | Behavior |
|---|---|---|---|
| GET | `/categories` | Public | List active categories. |
| POST | `/categories` | Admin | `{name,description?}`. |
| PATCH | `/categories/:id` | Admin | `{name?,description?,isActive?}`. |
| DELETE | `/categories/:id` | Admin | Soft-deactivate; blocked while active products reference the category. |

## Products
| Method | Endpoint | Access | Body / query |
|---|---|---|---|
| GET | `/products` | Public | Query `q`, `category`, `seller`, `minPrice`, `maxPrice`, `sort` (`newest`, `price_asc`, `price_desc`, `name`), `page`, `limit`. |
| GET | `/products/:id` | Public | Active product details. |
| POST | `/products` | Approved seller | `{name,description?,sku,price,category,stock,lowStockThreshold?,images?}`. |
| PATCH | `/products/:id` | Owner seller or admin | Update permitted descriptive fields, price, category, image URLs or active flag. Use inventory API for stock changes. |
| DELETE | `/products/:id` | Owner seller or admin | Soft-deactivate product. |
| POST | `/products/:id/inventory` | Owner seller or admin | `{delta,reason}`; delta is a non-zero integer. Negative delta requires sufficient available stock. |

## Cart (customer only)
| Method | Endpoint | Body / behavior |
|---|---|---|
| GET | `/cart` | Read own cart; subtotal is a display estimate. |
| POST | `/cart/items` | `{productId,quantity}`. |
| PATCH | `/cart/items/:productId` | `{quantity}`. |
| DELETE | `/cart/items/:productId` | Remove one product. |
| DELETE | `/cart` | Clear cart. |

## Checkout and orders
| Method | Endpoint | Access | Body / behavior |
|---|---|---|---|
| POST | `/checkout` | Customer | `{shippingAddress:{line1,city,state,postalCode,country}}`; groups items by seller and creates seller-specific orders in one transaction. |
| GET | `/orders` | Customer | Own order list; optional `status`, `page`, `limit`. |
| GET | `/orders/:id` | Owning customer, seller, or admin | Order details. Other users receive 403. |
| POST | `/orders/:id/cancel` | Owning customer | Optional `{reason}`; cancellation allowed only while pending or confirmed. Restores stock transactionally. |
| GET | `/seller/orders` | Seller | Orders belonging to authenticated seller. |
| PATCH | `/seller/orders/:id/status` | Seller owning order | `{status}`; allowed progression: confirmed, processing, shipped, delivered. |
| GET | `/admin/orders` | Admin | Platform-wide orders with optional status/seller/customer filters. |
| PATCH | `/admin/orders/:id/status` | Admin | `{status}`; same valid order state transitions as seller workflow. |

State progression:
```text
pending -> confirmed -> processing -> shipped -> delivered
    |           |
    +-----------+----> cancelled
```

An order is seller-specific. Several orders created from one cart share `checkoutGroupId`. Item name, SKU and unit price are snapshots. Payment is `simulated` / `not_integrated`; no real payment is taken.

## Reports (admin all data, seller own data)
| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/reports/sales` | Optional `from`, `to`; gross order value (not collected payment), order count, average order value, date trend. |
| GET | `/reports/top-products` | Optional `from`, `to`, `limit`; units sold and gross order value by product. |
| GET | `/reports/inventory` | Category product counts, stock totals and low-stock counts. |

## Administration
| Method | Endpoint | Access | Body / query |
|---|---|---|---|
| GET | `/admin/users` | Admin | Optional `role`, `status`, `q`, `page`, `limit`. |
| PATCH | `/admin/sellers/:id/status` | Admin | `{status:"active"}` to approve or `{status:"suspended"}` to suspend. Suspension revokes seller refresh sessions and increments sessionVersion so existing access tokens and sockets are rejected. |

## Notifications and Socket.IO
| Method | Endpoint | Access | Behavior |
|---|---|---|---|
| GET | `/notifications` | Authenticated | Own paginated notifications. |
| PATCH | `/notifications/:id/read` | Authenticated owner | Mark own notification as read. |

Socket connection example:
```js
const socket = io('http://localhost:5000', { auth: { token: accessToken } });
socket.on('notification:new', notification => console.log(notification));
```
Socket middleware validates the access token and joins the user's `user:<id>` room. Server events: `connection:ready`, `notification:new`. Internal EventEmitter events: `order:placed`, `order:statusChanged`, `inventory:lowStock`.

## Important status codes
- 200 success; 201 resource created.
- 400 malformed identifier or invalid filter.
- 401 missing/invalid/expired authentication.
- 403 authenticated but insufficient role/ownership.
- 404 missing route/resource.
- 409 duplicate/conflicting state or insufficient stock.
- 422 request/schema validation failure.
- 500 unexpected server error.
