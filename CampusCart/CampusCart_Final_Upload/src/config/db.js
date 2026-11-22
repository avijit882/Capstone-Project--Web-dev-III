import mongoose from 'mongoose';
import {env} from './env.js';
export async function connectDatabase(uri=env.MONGODB_URI){mongoose.set('strictQuery',true);await mongoose.connect(uri,{serverSelectionTimeoutMS:10000});console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);return mongoose.connection;}
