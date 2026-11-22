import { ApiError, asyncHandler, ok, page } from '../utils.js';
import { User, Notification } from '../models/index.js';
import { auth, catalog, cart, orders, reports, admin, parse, schemas } from '../services.js';

const wrap = (fn) => asyncHandler(fn);

export const authController = {
  register: wrap(async (req, res) => ok(res, { status: 201, message: 'Account created', data: await auth.register(req.body) })),
  login: wrap(async (req, res) => ok(res, { message: 'Logged in', data: await auth.login(req.body) })),
  refresh: wrap(async (req, res) => {
    const body = parse(schemas.token, req.body);
    ok(res, { message: 'Tokens rotated', data: await auth.rotate(body.refreshToken) });
  }),
  logout: wrap(async (req, res) => {
    const body = parse(schemas.token, req.body);
    await auth.logout(body.refreshToken);
    ok(res, { message: 'Logged out' });
  }),
  me: (req, res) => ok(res, { data: req.user.toSafeObject() }),
  updateMe: wrap(async (req, res) => ok(res, { data: await auth.profile(req.user, req.body), message: 'Profile updated' }))
};

export const categoryController = {
  list: wrap(async (req, res) => ok(res, { data: await catalog.categories() })),
  create: wrap(async (req, res) => ok(res, { status: 201, data: await catalog.createCategory(req.body), message: 'Category created' })),
  update: wrap(async (req, res) => ok(res, { data: await catalog.updateCategory(req.params.id, req.body) })),
  remove: wrap(async (req, res) => ok(res, { data: await catalog.deleteCategory(req.params.id), message: 'Category deactivated' }))
};

export const productController = {
  list: wrap(async (req, res) => {
    const result = await catalog.list(req.query);
    ok(res, { data: result.items, meta: result.meta });
  }),
  get: wrap(async (req, res) => ok(res, { data: await catalog.get(req.params.id) })),
  create: wrap(async (req, res) => ok(res, { status: 201, data: await catalog.create(req.body, req.user), message: 'Product created' })),
  update: wrap(async (req, res) => ok(res, { data: await catalog.update(req.params.id, req.body, req.user) })),
  remove: wrap(async (req, res) => ok(res, { data: await catalog.deactivate(req.params.id, req.user), message: 'Product deactivated' })),
  adjustStock: wrap(async (req, res) => ok(res, { data: await catalog.stock(req.params.id, req.body, req.user), message: 'Inventory adjusted' }))
};

export const cartController = {
  get: wrap(async (req, res) => ok(res, { data: await cart.get(req.user._id) })),
  add: wrap(async (req, res) => {
    const body = parse(schemas.cartItem, req.body);
    ok(res, { status: 201, data: await cart.add(req.user._id, body.productId, body.quantity), message: 'Item added' });
  }),
  update: wrap(async (req, res) => {
    const body = parse(schemas.quantity, req.body);
    ok(res, { data: await cart.set(req.user._id, req.params.productId, body.quantity) });
  }),
  remove: wrap(async (req, res) => ok(res, { data: await cart.remove(req.user._id, req.params.productId) })),
  clear: wrap(async (req, res) => ok(res, { data: await cart.clear(req.user._id), message: 'Cart cleared' }))
};

export const orderController = {
  checkout: wrap(async (req, res) => ok(res, { status: 201, data: await orders.checkout(req.user._id, req.body?.shippingAddress), message: 'Checkout completed' })),
  customerList: wrap(async (req, res) => {
    const result = await orders.customerList(req.user._id, req.query);
    ok(res, { data: result.items, meta: result.meta });
  }),
  get: wrap(async (req, res) => ok(res, { data: await orders.get(req.params.id, req.user) })),
  cancel: wrap(async (req, res) => {
    const body = parse(schemas.cancel, req.body || {});
    ok(res, { data: await orders.cancel(req.params.id, req.user._id, body.reason), message: 'Order cancelled and inventory restored' });
  }),
  sellerList: wrap(async (req, res) => {
    const result = await orders.sellerList(req.user._id, req.query);
    ok(res, { data: result.items, meta: result.meta });
  }),
  sellerUpdateStatus: wrap(async (req, res) => {
    const body = parse(schemas.status, req.body);
    ok(res, { data: await orders.updateStatus(req.params.id, body.status, req.user) });
  }),
  adminList: wrap(async (req, res) => {
    const result = await orders.adminList(req.query);
    ok(res, { data: result.items, meta: result.meta });
  }),
  adminUpdateStatus: wrap(async (req, res) => {
    const body = parse(schemas.status, req.body);
    ok(res, { data: await orders.updateStatus(req.params.id, body.status, req.user) });
  })
};

export const reportController = {
  sales: wrap(async (req, res) => ok(res, { data: await reports.sales(req.query, req.user.role === 'seller' ? req.user._id : null) })),
  topProducts: wrap(async (req, res) => ok(res, { data: await reports.best(req.query, req.user.role === 'seller' ? req.user._id : null) })),
  inventory: wrap(async (req, res) => ok(res, { data: await reports.inventory(req.user.role === 'seller' ? req.user._id : null) }))
};

export const adminController = {
  users: wrap(async (req, res) => {
    const result = await admin.users(req.query);
    ok(res, { data: result.items, meta: result.meta });
  }),
  sellerStatus: wrap(async (req, res) => {
    const body = parse(schemas.sellerStatus, req.body);
    ok(res, { data: await admin.sellerStatus(req.params.id, body.status) });
  })
};

export const notificationController = {
  list: wrap(async (req, res) => {
    const { page: currentPage, limit, skip } = page(req.query);
    const filter = { user: req.user._id };
    const [items, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter)
    ]);
    ok(res, { data: items, meta: { page: currentPage, limit, total, pages: Math.ceil(total / limit) } });
  }),
  markRead: wrap(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (!notification) {
      throw new ApiError(404, 'Notification not found');
    }
    ok(res, { data: notification });
  })
};
