// ============================================================
//  models/User.js — Mongoose schema for users
// ============================================================
'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    userId: {
      type    : String,
      required: true,
      unique  : true,
      trim    : true,
      maxlength: 128,
    },
    email: {
      type    : String,
      required: true,
      unique  : true,
      lowercase: true,
      trim    : true,
    },
    passwordHash: {
      type    : String,
      required: true,
    },
  },
  {
    timestamps: true,   // adds createdAt and updatedAt automatically
  }
);

// Prevent accidental exposure of passwordHash in JSON responses
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);