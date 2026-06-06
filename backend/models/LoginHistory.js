import mongoose from 'mongoose';

const loginHistorySchema =new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ipAddress: String,
  browser: String,
  os: String,
  deviceCategory: { type: String, enum: ['desktop', 'laptop', 'mobile'] },
  loginTime: { type: Date, default: Date.now }
});

const LoginHistory = mongoose.model('LoginHistory', loginHistorySchema);
export default LoginHistory;