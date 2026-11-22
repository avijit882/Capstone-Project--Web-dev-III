import crypto from 'node:crypto';import jwt from 'jsonwebtoken';import {env} from './config/env.js';
export class ApiError extends Error{constructor(statusCode,message,details){super(message);this.statusCode=statusCode;this.details=details;this.isOperational=true}}
export const asyncHandler=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export function ok(res,{status=200,message='Success',data=null,meta}={}){const out={success:true,message,data};if(meta!==undefined)out.meta=meta;return res.status(status).json(out)}
export function page(query){const p=Math.max(1,parseInt(query.page,10)||1),limit=Math.min(100,Math.max(1,parseInt(query.limit,10)||20));return {page:p,limit,skip:(p-1)*limit}}
export const hashToken=t=>crypto.createHash('sha256').update(t).digest('hex');
export const accessToken=u=>jwt.sign({sub:u._id.toString(),role:u.role,sessionVersion:u.sessionVersion??0},env.JWT_ACCESS_SECRET,{expiresIn:env.ACCESS_TOKEN_TTL});
export const refreshToken=(u,jti,familyId)=>jwt.sign({sub:u._id.toString(),jti,familyId,sessionVersion:u.sessionVersion??0,type:'refresh'},env.JWT_REFRESH_SECRET,{expiresIn:`${env.REFRESH_TOKEN_TTL_DAYS}d`});
export function validate(schema){return(req,res,next)=>{const r=schema.safeParse({body:req.body||{},params:req.params,query:req.query});if(!r.success)return next(new ApiError(422,'Request validation failed',r.error.flatten()));req.validated=r.data;next()}}
export function slugify(s){return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')}
export function errorHandler(err,req,res,next){let status=err.statusCode||500,message=err.message||'Internal server error',details=err.details;if(err.name==='ValidationError'){status=422;message='Database validation failed'}else if(err.name==='CastError'){status=400;message='Invalid resource identifier'}else if(err.code===11000){status=409;message='A record with this unique value already exists';details=err.keyValue}if(status>=500)console.error(err);const out={success:false,message};if(details)out.details=details;if(process.env.NODE_ENV!=='production'&&status>=500)out.error=err.stack;res.status(status).json(out)}
