import mongoose from 'mongoose';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from './config/env.js';
import { User,Category,Product,Cart,Order,RefreshToken,InventoryMovement,Notification } from './models/index.js';
import { ApiError,hashToken,accessToken,refreshToken,page,slugify } from './utils.js';
import { events } from './realtime.js';

const oid=z.string().regex(/^[a-f\d]{24}$/i,'Invalid MongoDB ID');
const address=z.object({line1:z.string().min(4).max(120),city:z.string().min(2).max(80),state:z.string().min(2).max(80),postalCode:z.string().min(3).max(20),country:z.string().min(2).max(80)});
export const schemas={
 register:z.object({name:z.string().trim().min(2).max(80),email:z.string().email(),password:z.string().min(10).max(72).refine(v=>Buffer.byteLength(v,'utf8')<=72,'Password must be at most 72 bytes for bcrypt'),role:z.enum(['customer','seller']).default('customer'),phone:z.string().max(25).optional()}),
 login:z.object({email:z.string().email(),password:z.string().min(1).max(72).refine(v=>Buffer.byteLength(v,'utf8')<=72,'Password must be at most 72 bytes for bcrypt')}), token:z.object({refreshToken:z.string().min(20)}), profile:z.object({name:z.string().trim().min(2).max(80).optional(),phone:z.string().max(25).optional(),address:address.optional()}).refine(v=>Object.keys(v).length>0),
 category:z.object({name:z.string().trim().min(2).max(80),description:z.string().max(500).optional()}), categoryPatch:z.object({name:z.string().trim().min(2).max(80).optional(),description:z.string().max(500).optional(),isActive:z.boolean().optional()}).refine(v=>Object.keys(v).length>0),
 product:z.object({name:z.string().trim().min(2).max(140),description:z.string().max(3000).optional(),sku:z.string().trim().min(2).max(50),price:z.number().positive(),category:oid,stock:z.number().int().min(0).max(100000),lowStockThreshold:z.number().int().min(0).optional(),images:z.array(z.string().url()).max(8).optional()}),
 productPatch:z.object({name:z.string().trim().min(2).max(140).optional(),description:z.string().max(3000).optional(),price:z.number().positive().optional(),category:oid.optional(),isActive:z.boolean().optional(),lowStockThreshold:z.number().int().min(0).optional(),images:z.array(z.string().url()).max(8).optional()}).refine(v=>Object.keys(v).length>0),
 cartItem:z.object({productId:oid,quantity:z.number().int().min(1).max(99)}), quantity:z.object({quantity:z.number().int().min(1).max(99)}), checkout:z.object({shippingAddress:address}), stock:z.object({delta:z.number().int().min(-100000).max(100000).refine(v=>v!==0),reason:z.string().min(3).max(200)}),
 status:z.object({status:z.enum(['confirmed','processing','shipped','delivered'])}), cancel:z.object({reason:z.string().max(300).optional()}), sellerStatus:z.object({status:z.enum(['active','suspended'])})
};
export function parse(schema,input){const r=schema.safeParse(input);if(!r.success)throw new ApiError(422,'Request validation failed',r.error.flatten());return r.data}

async function issueRefresh(user, familyId = crypto.randomUUID(), dbSession = null) {
  const token = refreshToken(user, crypto.randomUUID(), familyId);
  const record = new RefreshToken({
    user: user._id,
    familyId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000)
  });
  await record.save(dbSession ? { session: dbSession } : undefined);
  return token;
}

function session(user, rt) {
  return { user: user.toSafeObject(), accessToken: accessToken(user), refreshToken: rt };
}

export const auth = {
  async register(input) {
    input = parse(schemas.register, input);
    if (await User.exists({ email: input.email.toLowerCase() })) {
      throw new ApiError(409, 'Email already registered');
    }
    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash: await User.hashPassword(input.password),
      role: input.role,
      status: input.role === 'seller' ? 'pending' : 'active',
      phone: input.phone
    });
    return session(user, await issueRefresh(user));
  },

  async login(input) {
    input = parse(schemas.login, input);
    const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await user.comparePassword(input.password))) {
      throw new ApiError(401, 'Invalid email or password');
    }
    if (user.status === 'suspended') throw new ApiError(403, 'Account suspended');
    return session(user, await issueRefresh(user));
  },

  async rotate(raw) {
    let payload;
    try {
      payload = jwt.verify(raw, env.JWT_REFRESH_SECRET);
    } catch {
      throw new ApiError(401, 'Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh' || !payload.familyId || !Number.isInteger(payload.sessionVersion)) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    const dbSession = await mongoose.startSession();
    let result = null;
    let tokenReuseDetected = false;
    let sessionInvalidated = false;
    let familyId = payload.familyId;

    try {
      await dbSession.withTransaction(async () => {
        // withTransaction may retry its callback; reset closure state on every attempt.
        result = null;
        tokenReuseDetected = false;
        sessionInvalidated = false;
        const now = new Date();
        const old = await RefreshToken.findOne({
          user: payload.sub,
          tokenHash: hashToken(raw)
        }).select('+tokenHash').session(dbSession);

        if (!old || old.expiresAt <= now) {
          throw new ApiError(401, 'Refresh token is no longer valid');
        }
        familyId = old.familyId;
        const user = await User.findById(payload.sub).session(dbSession);
        if (!user || user.status !== 'active' || (user.sessionVersion ?? 0) !== payload.sessionVersion) {
          sessionInvalidated = true;
          return;
        }

        if (old.revokedAt) {
          tokenReuseDetected = true;
          return;
        }

        const claimed = await RefreshToken.findOneAndUpdate(
          { _id: old._id, revokedAt: null, expiresAt: { $gt: now } },
          { $set: { revokedAt: now } },
          { new: true, session: dbSession }
        );

        if (!claimed) {
          tokenReuseDetected = true;
          return;
        }

        const next = await issueRefresh(user, familyId, dbSession);
        await RefreshToken.updateOne(
          { _id: old._id },
          { $set: { replacedBy: hashToken(next) } },
          { session: dbSession }
        );
        result = session(user, next);
      });
    } finally {
      await dbSession.endSession();
    }

    if (sessionInvalidated) {
      throw new ApiError(401, 'Account unavailable or session revoked');
    }

    if (tokenReuseDetected) {
      // Reuse of an already-rotated token revokes every still-active token in
      // that family, including the replacement token issued to the legitimate client.
      await RefreshToken.updateMany(
        { familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      throw new ApiError(401, 'Refresh token reuse detected; this session family was revoked');
    }

    if (!result) throw new ApiError(401, 'Refresh token is no longer valid');
    return result;
  },

  async logout(raw) {
    if (raw) {
      await RefreshToken.updateOne(
        { tokenHash: hashToken(raw), revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
  },

  async profile(user, input) {
    input = parse(schemas.profile, input);
    Object.assign(user, input);
    await user.save();
    return user.toSafeObject();
  }
};

export const catalog={
 async categories(){return Category.find({isActive:true}).sort({name:1})},
 async createCategory(input){input=parse(schemas.category,input);return Category.create({...input,slug:slugify(input.name)})},
 async updateCategory(id,input){input=parse(schemas.categoryPatch,input);if(input.name)input.slug=slugify(input.name);const d=await Category.findByIdAndUpdate(id,input,{new:true,runValidators:true});if(!d)throw new ApiError(404,'Category not found');return d},
 async deleteCategory(id){if(await Product.exists({category:id,isActive:true}))throw new ApiError(409,'Category still has active products');const d=await Category.findByIdAndUpdate(id,{isActive:false},{new:true});if(!d)throw new ApiError(404,'Category not found');return d},
 async list(query={}){const {page:p,limit,skip}=page(query);const filter={isActive:true,seller:{$in:await User.find({role:'seller',status:'active'}).distinct('_id')}};if(query.category)filter.category=query.category;if(query.seller)filter.seller.$eq=query.seller;const hasMin=query.minPrice!==undefined&&query.minPrice!=='';const hasMax=query.maxPrice!==undefined&&query.maxPrice!=='';if((hasMin&&!Number.isFinite(+query.minPrice))||(hasMax&&!Number.isFinite(+query.maxPrice)))throw new ApiError(400,'Price filters must be numbers');if(hasMin&&hasMax&&+query.minPrice>+query.maxPrice)throw new ApiError(400,'minPrice cannot exceed maxPrice');if(hasMin||hasMax){filter.price={};if(hasMin)filter.price.$gte=+query.minPrice;if(hasMax)filter.price.$lte=+query.maxPrice}if(query.q)filter.$text={$search:String(query.q).slice(0,100)};const sort={newest:{createdAt:-1},price_asc:{price:1},price_desc:{price:-1},name:{name:1}}[query.sort]||{createdAt:-1};const [items,total]=await Promise.all([Product.find(filter).populate('category','name slug').populate('seller','name').sort(sort).skip(skip).limit(limit),Product.countDocuments(filter)]);return {items,meta:{page:p,limit,total,pages:Math.ceil(total/limit)}}},
 async get(id){const d=await Product.findOne({_id:id,isActive:true}).populate('category','name slug').populate('seller','name status');if(!d||d.seller?.status!=='active')throw new ApiError(404,'Product not found');return d},
 async create(input,user){input=parse(schemas.product,input);if(!(await Category.exists({_id:input.category,isActive:true})))throw new ApiError(400,'Active category required');if(user.role!=='seller'||user.status!=='active')throw new ApiError(403,'Approved seller required');return Product.create({...input,seller:user._id})},
 async update(id,input,user){input=parse(schemas.productPatch,input);const d=await Product.findById(id);if(!d)throw new ApiError(404,'Product not found');if(user.role!=='admin'&&d.seller.toString()!==user._id.toString())throw new ApiError(403,'Not your product');if(input.category&&!(await Category.exists({_id:input.category,isActive:true})))throw new ApiError(400,'Active category required');Object.assign(d,input);await d.save();return d},
 async deactivate(id,user){const d=await Product.findById(id);if(!d)throw new ApiError(404,'Product not found');if(user.role!=='admin'&&d.seller.toString()!==user._id.toString())throw new ApiError(403,'Not your product');d.isActive=false;await d.save();return d},
 async stock(id,input,user){input=parse(schemas.stock,input);const session=await mongoose.startSession();let changed;try{await session.withTransaction(async()=>{const before=await Product.findById(id).session(session);if(!before)throw new ApiError(404,'Product not found');if(user.role!=='admin'&&before.seller.toString()!==user._id.toString())throw new ApiError(403,'Not your inventory');const after=await Product.findOneAndUpdate({_id:id,...(input.delta<0?{stock:{$gte:-input.delta}}:{})},{$inc:{stock:input.delta}},{new:true,session,runValidators:true});if(!after)throw new ApiError(409,'Insufficient stock');await InventoryMovement.create([{product:id,seller:after.seller,actor:user._id,type:input.delta>0?'restock':'manual_adjustment',quantityDelta:input.delta,previousStock:before.stock,newStock:after.stock,referenceType:'manual',referenceId:input.reason}],{session});changed=after})}finally{await session.endSession()}if(changed.stock<=changed.lowStockThreshold)events.emit('inventory:lowStock',{product:changed});return changed}
};

export const cart={
 async get(uid){let c=await Cart.findOne({user:uid}).populate('items.product','name sku price stock isActive seller');if(!c){try{c=await Cart.create({user:uid,items:[]})}catch(e){if(e.code!==11000)throw e;c=await Cart.findOne({user:uid}).populate('items.product','name sku price stock isActive seller')}}const items=c.items.filter(i=>i.product).map(i=>({product:i.product,quantity:i.quantity,lineTotal:Number((i.product.price*i.quantity).toFixed(2))}));return {id:c._id,items,subtotal:Number(items.reduce((s,i)=>s+i.lineTotal,0).toFixed(2))}},
 async add(uid,pid,qty){
  const p=await Product.findOne({_id:pid,isActive:true});if(!p)throw new ApiError(404,'Product not found');
  let c=await Cart.findOne({user:uid});
  if(!c){try{c=await Cart.create({user:uid,items:[]})}catch(e){if(e.code!==11000)throw e;c=await Cart.findOne({user:uid})}}
  const old=c.items.find(i=>i.product.toString()===pid);const n=(old?.quantity||0)+qty;
  if(n>99)throw new ApiError(422,'Cart quantity cannot exceed 99');if(n>p.stock)throw new ApiError(409,'Quantity exceeds current stock');
  if(old){const updated=await Cart.findOneAndUpdate({_id:c._id,items:{$elemMatch:{product:pid,quantity:old.quantity}}},{$set:{'items.$.quantity':n}},{new:true});if(!updated)throw new ApiError(409,'Cart changed; retry')}
  else{const result=await Cart.updateOne({_id:c._id,'items.product':{$ne:pid}},{$push:{items:{product:pid,quantity:qty}}});if(result.modifiedCount!==1)throw new ApiError(409,'Cart changed; retry')}
  return this.get(uid)
 },
 async set(uid,pid,qty){const p=await Product.findOne({_id:pid,isActive:true});if(!p)throw new ApiError(404,'Product not found');if(qty>p.stock)throw new ApiError(409,'Quantity exceeds stock');const c=await Cart.findOneAndUpdate({user:uid,'items.product':pid},{$set:{'items.$.quantity':qty}},{new:true});if(!c)throw new ApiError(404,'Cart item not found');return this.get(uid)},
 async remove(uid,pid){const c=await Cart.findOneAndUpdate({user:uid},{$pull:{items:{product:pid}}},{new:true});if(!c)throw new ApiError(404,'Cart not found');return this.get(uid)},
 async clear(uid){await Cart.findOneAndUpdate({user:uid},{$set:{items:[]}},{upsert:true,new:true});return this.get(uid)}
};

const transitions={pending:['confirmed','cancelled'],confirmed:['processing','cancelled'],processing:['shipped'],shipped:['delivered'],delivered:[],cancelled:[]};
export const orders={
 async checkout(uid,shippingAddress){shippingAddress=parse(schemas.checkout,{shippingAddress}).shippingAddress;const session=await mongoose.startSession();let made=[];try{await session.withTransaction(async()=>{const c=await Cart.findOne({user:uid}).session(session);if(!c||!c.items.length)throw new ApiError(400,'Cart is empty');const products=await Product.find({_id:{$in:c.items.map(i=>i.product)},isActive:true}).session(session);if(products.length!==c.items.length)throw new ApiError(409,'A cart product is unavailable');const byId=new Map(products.map(p=>[p._id.toString(),p]));const groups=new Map();for(const ci of c.items){const p=byId.get(ci.product.toString());if(!p)throw new ApiError(409,'Product unavailable');if(!await User.exists({_id:p.seller,role:'seller',status:'active'}).session(session))throw new ApiError(409,`Seller for ${p.name} is inactive`);const key=p.seller.toString();if(!groups.has(key))groups.set(key,[]);groups.get(key).push({p,qty:ci.quantity})}const groupId=crypto.randomUUID(),docs=[];for(const [seller,entries] of groups){let subtotal=0;const items=[];for(const {p,qty} of entries){const result=await Product.updateOne({_id:p._id,isActive:true,stock:{$gte:qty}},{$inc:{stock:-qty}},{session});if(result.modifiedCount!==1)throw new ApiError(409,`Insufficient stock for ${p.name}`);const line=Number((p.price*qty).toFixed(2));subtotal=Number((subtotal+line).toFixed(2));items.push({product:p._id,name:p.name,sku:p.sku,unitPrice:p.price,quantity:qty,lineTotal:line});await InventoryMovement.create([{product:p._id,seller:p.seller,actor:uid,type:'sale',quantityDelta:-qty,previousStock:p.stock,newStock:p.stock-qty,referenceType:'order',referenceId:groupId}],{session})}docs.push({checkoutGroupId:groupId,customer:uid,seller,items,subtotal,total:subtotal,shippingAddress,payment:{method:'simulated',status:'not_integrated'}})}made=await Order.create(docs,{session});c.items=[];await c.save({session})})}finally{await session.endSession()}for(const order of made){events.emit('order:placed',{order});for(const item of order.items){const p=await Product.findById(item.product);if(p&&p.stock<=p.lowStockThreshold)events.emit('inventory:lowStock',{product:p})}}return {checkoutGroupId:made[0]?.checkoutGroupId,orders:made}},
 async customerList(uid,q={}){const {page:p,limit,skip}=page(q);const f={customer:uid};if(q.status)f.status=q.status;const [items,total]=await Promise.all([Order.find(f).populate('seller','name').sort({createdAt:-1}).skip(skip).limit(limit),Order.countDocuments(f)]);return {items,meta:{page:p,limit,total,pages:Math.ceil(total/limit)}}},
 async sellerList(uid,q={}){const {page:p,limit,skip}=page(q);const f={seller:uid};if(q.status)f.status=q.status;const [items,total]=await Promise.all([Order.find(f).populate('customer','name email').sort({createdAt:-1}).skip(skip).limit(limit),Order.countDocuments(f)]);return {items,meta:{page:p,limit,total,pages:Math.ceil(total/limit)}}},
 async get(id,user){const d=await Order.findById(id).populate('customer','name email').populate('seller','name email');if(!d)throw new ApiError(404,'Order not found');if(user.role!=='admin'&&d.customer._id.toString()!==user._id.toString()&&d.seller._id.toString()!==user._id.toString())throw new ApiError(403,'Not your order');return d},
 async updateStatus(id,status,actor){
  // Compare-and-set the current status. This prevents a stale seller/admin request
  // from overwriting a concurrent cancellation or another valid transition.
  const allowedFrom=Object.entries(transitions).filter(([,targets])=>targets.includes(status)).map(([source])=>source);
  const filter={_id:id,status:{$in:allowedFrom}};
  if(actor.role==='seller')filter.seller=actor._id;
  const d=await Order.findOneAndUpdate(filter,{$set:{status}},{new:true,runValidators:true});
  if(!d){
   const existing=await Order.findOne(actor.role==='seller'?{_id:id,seller:actor._id}:{_id:id});
   if(!existing)throw new ApiError(404,'Order not found');
   throw new ApiError(409,`Order status changed concurrently or transition is not allowed (${existing.status} -> ${status})`);
  }
  events.emit('order:statusChanged',{order:d});
  return d
 },
 async cancel(id,uid,reason){
  const session=await mongoose.startSession();let cancelled;
  try{
   await session.withTransaction(async()=>{
    // The status predicate is evaluated by MongoDB as part of the write. Only one
    // concurrent cancellation/status transition can win, so stock is restored once.
    const d=await Order.findOneAndUpdate(
     {_id:id,customer:uid,status:{$in:['pending','confirmed']}},
     {$set:{status:'cancelled',cancelledAt:new Date(),cancellationReason:reason||'Cancelled by customer'}},
     {new:true,session,runValidators:true}
    );
    if(!d){
     const existing=await Order.findOne({_id:id,customer:uid}).session(session);
     if(!existing)throw new ApiError(404,'Order not found');
     throw new ApiError(409,'Order cannot be cancelled in its current status');
    }
    for(const item of d.items){
     const p=await Product.findByIdAndUpdate(item.product,{$inc:{stock:item.quantity}},{new:true,session});
     if(!p)throw new ApiError(409,'Product missing during stock restoration');
     await InventoryMovement.create([{product:p._id,seller:d.seller,actor:uid,type:'cancellation_restore',quantityDelta:item.quantity,previousStock:p.stock-item.quantity,newStock:p.stock,referenceType:'order',referenceId:d._id.toString()}],{session});
    }
    cancelled=d;
   });
  }finally{await session.endSession()}
  events.emit('order:statusChanged',{order:cancelled});
  return cancelled
 },
 async adminList(q={}){const {page:p,limit,skip}=page(q);const f={};for(const k of ['status','seller','customer'])if(q[k])f[k]=q[k];const [items,total]=await Promise.all([Order.find(f).populate('customer','name email').populate('seller','name email').sort({createdAt:-1}).skip(skip).limit(limit),Order.countDocuments(f)]);return {items,meta:{page:p,limit,total,pages:Math.ceil(total/limit)}}}
};

export const reports={
 async sales(q={},sellerId=null){const match={status:{$ne:'cancelled'}};if(sellerId)match.seller=sellerId;if(q.from||q.to){match.createdAt={};if(q.from){const d=new Date(q.from);if(Number.isNaN(d.getTime()))throw new ApiError(400,'Invalid from date');match.createdAt.$gte=d}if(q.to){const d=new Date(q.to);if(Number.isNaN(d.getTime()))throw new ApiError(400,'Invalid to date');d.setHours(23,59,59,999);match.createdAt.$lte=d}if(match.createdAt.$gte&&match.createdAt.$lte&&match.createdAt.$gte>match.createdAt.$lte)throw new ApiError(400,'from cannot be after to')}const [summary,trend]=await Promise.all([Order.aggregate([{$match:match},{$group:{_id:null,grossOrderValue:{$sum:'$total'},orderCount:{$sum:1},averageOrderValue:{$avg:'$total'}}}]),Order.aggregate([{$match:match},{$group:{_id:{$dateToString:{format:'%Y-%m-%d',date:'$createdAt'}},grossOrderValue:{$sum:'$total'},orders:{$sum:1}}},{$sort:{_id:1}}])]);return {summary:summary[0]||{grossOrderValue:0,orderCount:0,averageOrderValue:0},trend}},
 async best(q={},sellerId=null){const match={status:{$ne:'cancelled'}};if(sellerId)match.seller=sellerId;if(q.from||q.to){match.createdAt={};if(q.from){const d=new Date(q.from);if(Number.isNaN(d.getTime()))throw new ApiError(400,'Invalid from date');match.createdAt.$gte=d}if(q.to){const d=new Date(q.to);if(Number.isNaN(d.getTime()))throw new ApiError(400,'Invalid to date');d.setHours(23,59,59,999);match.createdAt.$lte=d}if(match.createdAt.$gte&&match.createdAt.$lte&&match.createdAt.$gte>match.createdAt.$lte)throw new ApiError(400,'from cannot be after to')}return Order.aggregate([{$match:match},{$unwind:'$items'},{$group:{_id:'$items.product',productName:{$first:'$items.name'},sku:{$first:'$items.sku'},unitsSold:{$sum:'$items.quantity'},grossOrderValue:{$sum:'$items.lineTotal'}}},{$sort:{unitsSold:-1,grossOrderValue:-1}},{$limit:Math.min(100,Math.max(1,Number(q.limit)||10))}])},
 async inventory(sellerId=null){const match={isActive:true};if(sellerId)match.seller=sellerId;return Product.aggregate([{$match:match},{$lookup:{from:'categories',localField:'category',foreignField:'_id',as:'categoryInfo'}},{$unwind:{path:'$categoryInfo',preserveNullAndEmptyArrays:true}},{$group:{_id:'$category',category:{$first:'$categoryInfo.name'},productCount:{$sum:1},totalStock:{$sum:'$stock'},lowStockCount:{$sum:{$cond:[{$lte:['$stock','$lowStockThreshold']},1,0]}}}},{$sort:{category:1}}])}
};

export const admin={
 async users(q={}){const {page:p,limit,skip}=page(q);const f={};if(q.role)f.role=q.role;if(q.status)f.status=q.status;if(q.q){const term=String(q.q).slice(0,60).replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&');f.$or=[{name:new RegExp(term,'i')},{email:new RegExp(term,'i')}]}const [items,total]=await Promise.all([User.find(f).sort({createdAt:-1}).skip(skip).limit(limit),User.countDocuments(f)]);return {items:items.map(u=>u.toSafeObject()),meta:{page:p,limit,total,pages:Math.ceil(total/limit)}}},
 async sellerStatus(id,status){
  const update = status === 'suspended'
   ? { $set: { status }, $inc: { sessionVersion: 1 } }
   : { $set: { status } };
  const u=await User.findOneAndUpdate({_id:id,role:'seller'},update,{new:true,runValidators:true});
  if(!u)throw new ApiError(404,'Seller not found');
  if(status==='suspended'){
   await RefreshToken.updateMany({user:u._id,revokedAt:null},{$set:{revokedAt:new Date()}});
  }
  return u.toSafeObject();
 }
};
