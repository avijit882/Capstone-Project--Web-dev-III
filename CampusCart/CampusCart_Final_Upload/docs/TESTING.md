# CampusCart Testing Guide

## Automated test coverage

Run `npm run check` first. It uses Node.js `--check` against the JavaScript source, scripts and tests.

The integration suite in `tests/campuscart.test.js` covers:

1. Health endpoint and unauthenticated route protection.
2. Registration validation failures.
3. Role-based route denial and cart item creation.
4. Successful checkout, stock deduction, cancellation restoration and duplicate-cancellation rejection.
5. Refresh-token rotation and rejection of refresh-token replay.
6. Customer order ownership enforcement.
7. Failed checkout transaction rollback (no order insertion and no stock mutation).
8. Two customers attempting to buy the last unit concurrently (only one checkout should succeed).
9. Socket.IO rejection of unauthenticated connections.
10. Authenticated Socket.IO notification delivery and persistence in MongoDB.

## Run against Docker MongoDB

Start the supplied replica set:

```powershell
docker compose up -d mongo
docker exec campuscart-mongo mongosh --quiet --eval "rs.status().ok"
```

The result should be `1`. Install dependencies with `npm install`, then run:

```powershell
npm run check
$env:TEST_MONGODB_URI = "mongodb://127.0.0.1:27017/campuscart_test?replicaSet=rs0"
npm test
Remove-Item Env:TEST_MONGODB_URI
```

The test suite drops the database specified by `TEST_MONGODB_URI` before running. It must be a disposable test database, never the regular development or production database.

## In-memory alternative

When `TEST_MONGODB_URI` is not set, tests use `mongodb-memory-server` configured as a single-node replica set. On the first run it may need to download a MongoDB server binary. Network access is required for that download unless the binary is already cached.

## Manual Postman checks

Import both JSON files from `postman/`. Run login requests for each role to set the selected access token, then verify:

- Customer can browse products, manage only their own cart and orders, and cannot access seller/admin routes.
- Pending seller cannot create/manage products until administrator approval.
- Active seller can manage only their own products and orders.
- Administrator can approve/suspend sellers, manage categories and view platform reports.
- Checkout reads current product prices, creates seller-specific orders and decrements stock.
- An insufficient-stock checkout returns a conflict and leaves no partial order/stock changes.
- Customer cancellation restores stock once; repeat cancellation returns a conflict.
- Notifications are persisted and delivered to the correct authenticated Socket.IO user room.

## Evidence and reporting

Record the actual command output, date, Node.js version and MongoDB version after running the suite locally. Capture genuine Postman screenshots for the report. Do not describe a test as passed unless its command completed with a passing exit code. A successful `/health` response alone does not verify database transactions, authorization, aggregation or Socket.IO delivery.
