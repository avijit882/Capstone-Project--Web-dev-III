# CampusCart Faculty Demonstration Script

## Preparation
1. Start MongoDB replica set with `docker compose up -d mongo`.
2. Copy `.env.example` to `.env`, set secrets, run `npm install` and `npm run seed`.
3. Start the server with `npm run dev` and verify `GET /health`.
4. Open Postman collection and local environment.

## Demo flow
1. Log in as admin and show role information.
2. Register a new seller. Show that status is pending and product creation is denied.
3. Approve that seller using admin endpoint.
4. Log in as seller, create a category (admin) if needed, and create a product.
5. Log in as customer, browse and search products, add products from two different sellers to cart.
6. Checkout. Show seller-specific order documents sharing one checkout group ID.
7. Show that stock reduced and inventory movement records were created.
8. Try checkout with more units than available; show conflict response and no partial order writes.
9. Cancel a pending/confirmed order; show inventory restored once. Repeat cancellation and show it is rejected.
10. Connect a seller Socket.IO client, place an order as customer, and show new-order notification. Change order status and show customer notification.
11. Show sales/order-value, best-selling product and category inventory aggregation reports.
12. Demonstrate missing token (401), wrong role (403), invalid payload (422), and ownership restrictions.
13. Explain one API end-to-end: route -> authentication -> authorization -> validation -> service -> Mongoose -> MongoDB -> response.

Use real screenshots from the running build only. Do not fabricate test output or claim a payment was collected.
