import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import request from 'supertest';
import { io as socketClient } from 'socket.io-client';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let repl;
let mongoose;
let app;
let User;
let Category;
let Product;
let Order;
let Notification;
let customerToken;
let customerRefresh;
let sellerToken;
let product;
let orderId;
let httpServer;
let socketServer;
let socketUrl;
let events;

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_123456789012345678901';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_123456789012345678901';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

before(async () => {
  mongoose = (await import('mongoose')).default;

  // Use a real local replica set when TEST_MONGODB_URI is supplied.
  // Otherwise use an isolated in-memory replica set (first run may download MongoDB).
  if (process.env.TEST_MONGODB_URI) {
    await mongoose.connect(process.env.TEST_MONGODB_URI);
  } else {
    repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(repl.getUri('campuscart_test'));
  }
  await mongoose.connection.dropDatabase();

  ({ default: app } = await import('../src/app.js'));
  ({ User, Category, Product, Order, Notification } = await import('../src/models/index.js'));
  ({ events } = await import('../src/realtime.js'));

  httpServer = createServer(app);
  const { makeSocketServer } = await import('../src/realtime.js');
  socketServer = makeSocketServer(httpServer);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  socketUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const category = await Category.create({ name: 'Test Electronics', slug: 'test-electronics' });
  const seller = await User.create({
    name: 'Seller', email: 'seller@test.local',
    passwordHash: await User.hashPassword('SellerPassword123!'),
    role: 'seller', status: 'active'
  });
  product = await Product.create({
    name: 'Test Keyboard', sku: 'TEST-KEY-1', price: 1000,
    category: category._id, seller: seller._id, stock: 10, lowStockThreshold: 2
  });

  const sellerLogin = await request(app).post('/api/v1/auth/login')
    .send({ email: seller.email, password: 'SellerPassword123!' });
  sellerToken = sellerLogin.body.data.accessToken;

  const customerLogin = await request(app).post('/api/v1/auth/register')
    .send({ name: 'Customer', email: 'customer@test.local', password: 'CustomerPassword123!' });
  customerToken = customerLogin.body.data.accessToken;
  customerRefresh = customerLogin.body.data.refreshToken;
});

after(async () => {
  if (socketServer) {
    await new Promise(resolve => socketServer.close(resolve));
  } else if (httpServer?.listening) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  if (mongoose?.connection?.readyState) await mongoose.disconnect();
  if (repl) await repl.stop();
});

test('health endpoint and authentication protection', async () => {
  assert.equal((await request(app).get('/health')).status, 200);
  assert.equal((await request(app).get('/api/v1/cart')).status, 401);
});

test('invalid registration payload returns 422', async () => {
  const response = await request(app).post('/api/v1/auth/register')
    .send({ name: 'A', email: 'not-an-email', password: 'short' });
  assert.equal(response.status, 422);
});

test('role restriction and cart addition work', async () => {
  assert.equal((await request(app).get('/api/v1/cart')
    .set('Authorization', `Bearer ${sellerToken}`)).status, 403);

  const response = await request(app).post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ productId: product._id.toString(), quantity: 2 });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.items[0].quantity, 2);
});

test('checkout deducts inventory and cancellation restores it exactly once', async () => {
  const response = await request(app).post('/api/v1/checkout')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ shippingAddress: {
      line1: '12 Test Road', city: 'Gurugram', state: 'Haryana',
      postalCode: '122001', country: 'India'
    } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  orderId = response.body.data.orders[0]._id;
  assert.equal((await Product.findById(product._id)).stock, 8);

  const cancel = await request(app).post(`/api/v1/orders/${orderId}/cancel`)
    .set('Authorization', `Bearer ${customerToken}`).send({ reason: 'Integration test' });
  assert.equal(cancel.status, 200);
  assert.equal((await Product.findById(product._id)).stock, 10);

  const repeated = await request(app).post(`/api/v1/orders/${orderId}/cancel`)
    .set('Authorization', `Bearer ${customerToken}`).send({});
  assert.equal(repeated.status, 409);
  assert.equal((await Product.findById(product._id)).stock, 10);
});

test('refresh token rotation rejects reuse of the old token', async () => {
  const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: customerRefresh });
  assert.equal(rotated.status, 200);
  const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: customerRefresh });
  assert.equal(replay.status, 401);
});

test('a different customer cannot read another customer private order', async () => {
  const other = await User.create({
    name: 'Other', email: 'other@test.local',
    passwordHash: await User.hashPassword('OtherPassword123!'), role: 'customer', status: 'active'
  });
  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign({ sub: other._id.toString() }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const response = await request(app).get(`/api/v1/orders/${orderId}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 403);
});

test('failed checkout rolls back both order creation and stock changes', async () => {
  await request(app).post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ productId: product._id.toString(), quantity: 2 });
  await Product.updateOne({ _id: product._id }, { $set: { stock: 1 } });
  const countBefore = await Order.countDocuments();
  const response = await request(app).post('/api/v1/checkout')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ shippingAddress: {
      line1: '12 Test Road', city: 'Gurugram', state: 'Haryana',
      postalCode: '122001', country: 'India'
    } });
  assert.equal(response.status, 409);
  assert.equal(await Order.countDocuments(), countBefore);
  assert.equal((await Product.findById(product._id)).stock, 1);
});

test('concurrent checkouts cannot oversell the final unit', async () => {
  const category = await Category.findOne({ slug: 'test-electronics' });
  const seller = await User.findOne({ email: 'seller@test.local' });
  const scarce = await Product.create({
    name: 'Last Unit Item', sku: 'TEST-LAST-1', price: 250,
    category: category._id, seller: seller._id, stock: 1, lowStockThreshold: 0
  });
  const customers = [];
  for (const email of ['race-one@test.local', 'race-two@test.local']) {
    const registered = await request(app).post('/api/v1/auth/register')
      .send({ name: 'Race Customer', email, password: 'RacePassword123!' });
    assert.equal(registered.status, 201);
    customers.push(registered.body.data.accessToken);
    const added = await request(app).post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${registered.body.data.accessToken}`)
      .send({ productId: scarce._id.toString(), quantity: 1 });
    assert.equal(added.status, 201);
  }

  const checkout = token => request(app).post('/api/v1/checkout')
    .set('Authorization', `Bearer ${token}`)
    .send({ shippingAddress: {
      line1: '12 Test Road', city: 'Gurugram', state: 'Haryana',
      postalCode: '122001', country: 'India'
    } });
  const results = await Promise.all(customers.map(checkout));
  assert.deepEqual(results.map(r => r.status).sort((a, b) => a - b), [201, 409]);
  assert.equal((await Product.findById(scarce._id)).stock, 0);
  assert.equal(await Order.countDocuments({ 'items.product': scarce._id }), 1);
});

test('Socket.IO rejects unauthenticated clients', async () => {
  const client = socketClient(socketUrl, { transports: ['websocket'], reconnection: false, timeout: 3000 });
  const error = await new Promise((resolve, reject) => {
    client.once('connect_error', resolve);
    client.once('connect', () => reject(new Error('Unauthenticated socket unexpectedly connected')));
  });
  assert.match(error.message, /token|required|invalid/i);
  client.disconnect();
});

test('authenticated Socket.IO client receives a persisted user notification', async () => {
  const client = socketClient(socketUrl, {
    auth: { token: customerToken }, transports: ['websocket'], reconnection: false, timeout: 3000
  });
  const ready = await new Promise((resolve, reject) => {
    client.once('connection:ready', resolve);
    client.once('connect_error', reject);
  });
  assert.ok(ready.userId);

  const received = new Promise((resolve, reject) => {
    client.once('notification:new', resolve);
    setTimeout(() => reject(new Error('Timed out waiting for notification:new')), 4000).unref();
  });
  events.emit('order:statusChanged', {
    order: { _id: 'integration-test-order', customer: ready.userId, status: 'shipped' }
  });
  const notification = await received;
  assert.equal(notification.type, 'order_status');
  assert.equal(notification.data.orderId, 'integration-test-order');
  assert.equal(await Notification.countDocuments({ user: ready.userId, type: 'order_status' }), 1);
  client.disconnect();
});
