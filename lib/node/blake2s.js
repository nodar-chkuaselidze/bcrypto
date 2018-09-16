/*!
 * blake2s.js - BLAKE2s implementation for bcrypto
 * Copyright (c) 2018, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcrypto
 */

'use strict';

const assert = require('bsert');
const crypto = require('crypto');
const Backend = require('../js/blake2s');
const hashes = crypto.getHashes();

/*
 * Constants
 */

const names = {
  16: hashes.indexOf('blake2s128') !== -1
    ? 'blake2s128'
    : null,
  20: hashes.indexOf('blake2s160') !== -1
    ? 'blake2s160'
    : null,
  28: hashes.indexOf('blake2s224') !== -1
    ? 'blake2s224'
    : null,
  32: hashes.indexOf('blake2s256') !== -1
    ? 'blake2s256'
    : null
};

/**
 * Blake2s
 */

class Blake2s {
  /**
   * Create a Blake2s context.
   * @constructor
   */

  constructor() {
    this.node = null;
    this.js = null;
  }

  init(size = 32, key = null) {
    assert((size >>> 0) === size);

    if (key && key.length === 0)
      key = null;

    if (!key && typeof names[size] === 'string') {
      this.node = crypto.createHash(names[size]);
      this.js = null;
    } else {
      this.node = null;
      this.js = new Backend();
      this.js.init(size, key);
    }

    return this;
  }

  update(data) {
    if (this.node) {
      assert(Buffer.isBuffer(data));
      this.node.update(data);
    } else {
      assert(this.js);
      this.js.update(data);
    }
    return this;
  }

  final() {
    let ret;

    if (this.node) {
      ret = this.node.digest();
      this.node = null;
    } else {
      assert(this.js);
      ret = this.js.final();
      this.js = null;
    }

    return ret;
  }

  static hash() {
    return new Blake2s();
  }

  static hmac() {
    return Backend.hmac();
  }

  static digest(data, size = 32, key = null) {
    const ctx = Blake2s.ctx;
    ctx.init(size, key);
    ctx.update(data);
    return ctx.final();
  }

  static root(left, right, size = 32) {
    assert(Buffer.isBuffer(left) && left.length === size);
    assert(Buffer.isBuffer(right) && right.length === size);
    const ctx = Blake2s.ctx;
    ctx.init(size);
    ctx.update(left);
    ctx.update(right);
    return ctx.final();
  }

  static multi(one, two, three, size = 32) {
    const ctx = Blake2s.ctx;
    ctx.init(size);
    ctx.update(one);
    ctx.update(two);
    if (three)
      ctx.update(three);
    return ctx.final();
  }

  static mac(data, key, size = 32) {
    return Backend.mac(data, size, key);
  }
}

Blake2s.native = 1;
Blake2s.id = 'BLAKE2S256';
Blake2s.ossl = 'blake2s256';
Blake2s.size = 32;
Blake2s.bits = 256;
Blake2s.blockSize = 64;
Blake2s.zero = Buffer.alloc(32, 0x00);
Blake2s.ctx = new Blake2s();

/*
 * Expose
 */

module.exports = Blake2s;