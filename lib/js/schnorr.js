/*!
 * schnorr.js - bip-schnorr for bcrypto
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcrypto
 *
 * Parts of this software are based on sipa/bip-schnorr:
 *   https://github.com/sipa/bips/blob/bip-schnorr/bip-schnorr/reference.py
 *
 * Parts of this software are based on ElementsProject/secp256k1-zkp:
 *   https://github.com/ElementsProject/secp256k1-zkp/tree/secp256k1-zkp/src/modules/schnorrsig
 *
 * Resources:
 *   https://github.com/sipa/bips/blob/bip-schnorr/bip-schnorr.mediawiki
 *   https://github.com/sipa/bips/blob/bip-schnorr/bip-schnorr/reference.py
 *   https://github.com/sipa/bips/blob/bip-schnorr/bip-schnorr/test-vectors.csv
 *   https://github.com/ElementsProject/secp256k1-zkp
 *   https://github.com/ElementsProject/secp256k1-zkp/tree/secp256k1-zkp/src/modules/musig
 *   https://github.com/ElementsProject/secp256k1-zkp/tree/secp256k1-zkp/src/modules/schnorrsig
 */

'use strict';

const assert = require('bsert');
const rng = require('../random');
const BN = require('../bn.js');

/**
 * Schnorr
 */

class Schnorr {
  constructor(curve, hash) {
    this.curve = curve;
    this.hash = hash;
  }

  hashInt(...items) {
    // eslint-disable-next-line
    const h = new this.hash();

    h.init();

    for (const item of items)
      h.update(item);

    const hash = h.final();
    const num = BN.decode(hash, this.curve.endian);

    return num.iumod(this.curve.n);
  }

  sign(msg, key) {
    assert(Buffer.isBuffer(msg));
    assert(Buffer.isBuffer(key));
    assert(msg.length === this.hash.size);
    assert(key.length === this.curve.size);

    const N = this.curve.n;
    const P = this.curve.p;
    const G = this.curve.g;

    // Let k' = int(hash(bytes(d) || m)) mod n
    let k = this.hashInt(key, msg);

    // Fail if k' = 0.
    if (k.isZero())
      throw new Error('Signing failed (k\' = 0).');

    // Let R = k'*G.
    const R = G.mulBlind(k);

    // Let k = k' if jacobi(y(R)) = 1, otherwise let k = n - k'.
    if (R.getY().jacobi(P) !== 1)
      k = N.sub(k);

    // The secret key d: an integer in the range 1..n-1.
    const a = this.curve.decodeScalar(key);

    if (a.isZero() || a.cmp(N) >= 0)
      throw new Error('Invalid private key.');

    // Let e = int(hash(bytes(x(R)) || bytes(d*G) || m)) mod n.
    const Araw = G.mulBlind(a).encode();
    const Rraw = this.curve.encodeInt(R.getX());
    const e = this.hashInt(Rraw, Araw, msg);

    // Blinding factor.
    const b = BN.random(rng, 1, N);

    // Reasoning:
    // The fermat inverse has better
    // constant-time properties than
    // an EGCD.
    const bi = b.finvm(N);

    // ea := (e * a) mod n (unblinded)
    // ea := (e * b * a) mod n (blinded)
    const ea = e.imul(b).iumod(N)
                .imul(a).iumod(N);

    // The signature is bytes(x(R)) || bytes(k + e*d mod n).
    // s := (k + (e * a)) mod n (unblinded)
    // s := ((k * b + (e * b * a)) * b^-1) mod n (blinded)
    const S = k.imul(b).iumod(N)
               .iadd(ea).iumod(N)
               .imul(bi).iumod(N);

    return Buffer.concat([Rraw, this.curve.encodeScalar(S)]);
  }

  verify(msg, sig, key) {
    assert(Buffer.isBuffer(msg));
    assert(Buffer.isBuffer(sig));
    assert(Buffer.isBuffer(key));

    try {
      return this._verify(msg, sig, key);
    } catch (e) {
      return false;
    }
  }

  _verify(msg, sig, key) {
    assert(Buffer.isBuffer(msg));
    assert(Buffer.isBuffer(sig));
    assert(Buffer.isBuffer(key));

    if (msg.length !== this.hash.size)
      return false;

    if (sig.length !== this.curve.size * 2)
      return false;

    const N = this.curve.n;
    const P = this.curve.p;
    const G = this.curve.g;

    // Let P = point(pk); fail if point(pk) fails.
    const A = this.curve.decodePoint(key);

    // Let r = int(sig[0:32]); fail if r >= p.
    // Let s = int(sig[32:64]); fail if s >= n.
    const Rraw = sig.slice(0, this.curve.size);
    const Sraw = sig.slice(this.curve.size);
    const Rx = this.curve.decodeInt(Rraw);
    const S = this.curve.decodeScalar(Sraw);

    if (Rx.cmp(P) >= 0 || S.cmp(N) >= 0)
      return false;

    // Let e = int(hash(bytes(r) || bytes(P) || m)) mod n.
    const e = this.hashInt(Rraw, A.encode(), msg);

    // Let R = s*G - e*P.
    const R = G.mul(S).add(A.mul(N.sub(e)));

    // Fail if infinite(R) or jacobi(y(R)) != 1 or x(R) != r.
    if (R.isInfinity())
      return false;

    if (R.getY().jacobi(P) !== 1)
      return false;

    if (!R.getX().eq(Rx))
      return false;

    return true;
  }

  batchVerify(batch) {
    assert(Array.isArray(batch));

    for (const item of batch) {
      assert(Array.isArray(item) && item.length === 3);

      const [msg, sig, key] = item;

      assert(Buffer.isBuffer(msg));
      assert(Buffer.isBuffer(sig));
      assert(Buffer.isBuffer(key));

      if (msg.length !== this.hash.size)
        return false;

      if (sig.length !== this.curve.size * 2)
        return false;
    }

    try {
      return this._batchVerify(batch);
    } catch (e) {
      return false;
    }
  }

  _batchVerify(batch) {
    const N = this.curve.n;
    const P = this.curve.p;
    const G = this.curve.g;
    const B = this.curve.b;

    let lhs = null;
    let rhs = null;

    for (const [msg, sig, key] of batch) {
      // Let Pi = point(pki); fail if point(pki) fails.
      const A = this.curve.decodePoint(key);

      // Let r = int(sigi[0:32]); fail if r >= p.
      // Let si = int(sigi[32:64]); fail if si >= n.
      const Rraw = sig.slice(0, this.curve.size);
      const Sraw = sig.slice(this.curve.size);
      const Rx = this.curve.decodeInt(Rraw);
      const S = this.curve.decodeScalar(Sraw);

      if (Rx.cmp(P) >= 0 || S.cmp(N) >= 0)
        return false;

      // Let ei = int(hash(bytes(r) || bytes(Pi) || mi)) mod n.
      const e = this.hashInt(Rraw, A.encode(), msg);

      // Switch to modular arithmetic. We could call
      // pointFromX() here, but we want to avoid the
      // oddness check and subsequent negation.
      const r = Rx.toRed(this.curve.red);
      const ra = r.redMul(this.curve.a);

      // Let c = (r^3 + 7) mod p.
      const c = r.redSqr().redIMul(r).redIAdd(ra).redIAdd(B);

      // Let y = c^((p+1)/4) mod p.
      const y = c.redSqrt();

      // Fail if c != y^2 mod p.
      if (!c.eq(y.redSqr()))
        return false;

      // Let Ri = (r, y).
      const R = this.curve.point(r, y);

      // Let lhs = s1 + a2*s2 + ... + au*su.
      // Let rhs = R1 + a2*R2 + ... + au*Ru
      //         + e1*P1 + (a2*e2)P2 + ... + (au*eu)Pu.
      if (lhs === null) {
        lhs = S;
        rhs = R.add(A.mul(e));
        continue;
      }

      // Generate u-1 random integers a2...u in the range 1...n-1.
      const a = BN.random(rng, 1, N);
      const ae = a.mul(e).iumod(N);

      lhs = lhs.iadd(a.mul(S)).iumod(N);
      rhs = rhs.add(R.mulAdd(a, A, ae));
    }

    // Fail if lhs*G != rhs.
    if (lhs === null)
      return true;

    return G.mul(lhs).eq(rhs);
  }
}

/*
 * Expose
 */

module.exports = Schnorr;
