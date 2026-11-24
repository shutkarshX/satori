// Decrypt using page's window.CryptoJS, or standalone OpenSSL EVP_BytesToKey MD5 AES-CBC
(() => {
  if (window.__satoCryptoLoaded) return;
  window.__satoCryptoLoaded = true;

  async function decrypt(passphrase, b64) {
    if (window.CryptoJS?.AES) {
      const bytes = window.CryptoJS.AES.decrypt(b64, passphrase);
      return bytes.toString(window.CryptoJS.enc.Utf8);
    }

    // Standalone fallback: OpenSSL EVP_BytesToKey (MD5 derivation used by CryptoJS)
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (String.fromCharCode(...raw.slice(0, 8)) !== 'Salted__') {
      throw new Error('blob is not Salted__ format');
    }
    const salt = raw.slice(8, 16);
    const ct = raw.slice(16);

    // MD5 implementation for EVP_BytesToKey
    function md5(bytes) {
      function safeAdd(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff); }
      function bitRol(n, c) { return (n << c) | (n >>> (32 - c)); }
      function cmn(q, a, b, x, s, t) { return safeAdd(bitRol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
      function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
      function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
      function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
      function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

      const words = [];
      for (let i = 0; i < bytes.length * 8; i += 8) words[i >> 5] |= (bytes[i / 8] & 0xff) << (i % 32);
      words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
      words[(((bytes.length + 8) >> 6) << 4) + 14] = bytes.length * 8;

      let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
      for (let i = 0; i < words.length; i += 16) {
        const olda = a, oldb = b, oldc = c, oldd = d;
        a = ff(a, b, c, d, words[i], 7, -680876936); d = ff(d, a, b, c, words[i + 1], 12, -389564586);
        c = ff(c, d, a, b, words[i + 2], 17, 606105819); b = ff(b, c, d, a, words[i + 3], 22, -1044525330);
        a = ff(a, b, c, d, words[i + 4], 7, -176418897); d = ff(d, a, b, c, words[i + 5], 12, 1200080426);
        c = ff(c, d, a, b, words[i + 6], 17, -1473231341); b = ff(b, c, d, a, words[i + 7], 22, -45705983);
        a = ff(a, b, c, d, words[i + 8], 7, 1770035416); d = ff(d, a, b, c, words[i + 9], 12, -1958414417);
        c = ff(c, d, a, b, words[i + 10], 17, -42063); b = ff(b, c, d, a, words[i + 11], 22, -1990404162);
        a = ff(a, b, c, d, words[i + 12], 7, 1804603682); d = ff(d, a, b, c, words[i + 13], 12, -40341101);
        c = ff(c, d, a, b, words[i + 14], 17, -1502002290); b = ff(b, c, d, a, words[i + 15], 22, 1236535329);

        a = gg(a, b, c, d, words[i + 1], 5, -165796510); d = gg(d, a, b, c, words[i + 6], 9, -1069501632);
        c = gg(c, d, a, b, words[i + 11], 14, 643717713); b = gg(b, c, d, a, words[i], 20, -373897302);
        a = gg(a, b, c, d, words[i + 5], 5, -701558691); d = gg(d, a, b, c, words[i + 10], 9, 38016083);
        c = gg(c, d, a, b, words[i + 15], 14, -660478335); b = gg(b, c, d, a, words[i + 4], 20, -405537848);
        a = gg(a, b, c, d, words[i + 9], 5, 568446438); d = gg(d, a, b, c, words[i + 14], 9, -1019803690);
        c = gg(c, d, a, b, words[i + 3], 14, -187363961); b = gg(b, c, d, a, words[i + 8], 20, 1163531501);
        a = gg(a, b, c, d, words[i + 13], 5, -1444681467); d = gg(d, a, b, c, words[i + 2], 9, -51403784);
        c = gg(c, d, a, b, words[i + 7], 14, 1735328473); b = gg(b, c, d, a, words[i + 12], 20, -1926607734);

        a = hh(a, b, c, d, words[i + 5], 4, -378558); d = hh(d, a, b, c, words[i + 8], 11, -2022574463);
        c = hh(c, d, a, b, words[i + 11], 16, 1839030562); b = hh(b, c, d, a, words[i + 14], 23, -35309556);
        a = hh(a, b, c, d, words[i + 1], 4, -1530992060); d = hh(d, a, b, c, words[i + 4], 11, 1272893353);
        c = hh(c, d, a, b, words[i + 7], 16, -155497632); b = hh(b, c, d, a, words[i + 10], 23, -1094730640);
        a = hh(a, b, c, d, words[i + 13], 4, 681279174); d = hh(d, a, b, c, words[i], 11, -358537222);
        c = hh(c, d, a, b, words[i + 3], 16, -722521979); b = hh(b, c, d, a, words[i + 6], 23, 76029189);
        a = hh(a, b, c, d, words[i + 9], 4, -640364487); d = hh(d, a, b, c, words[i + 12], 11, -421815835);
        c = hh(c, d, a, b, words[i + 15], 16, 530742520); b = hh(b, c, d, a, words[i + 2], 23, -995338651);

        a = ii(a, b, c, d, words[i], 6, -198630844); d = ii(d, a, b, c, words[i + 7], 10, 1126891415);
        c = ii(c, d, a, b, words[i + 14], 15, -1416354905); b = ii(b, c, d, a, words[i + 5], 21, -57434055);
        a = ii(a, b, c, d, words[i + 12], 6, 1700485571); d = ii(d, a, b, c, words[i + 3], 10, -1894986606);
        c = ii(c, d, a, b, words[i + 10], 15, -1051523); b = ii(b, c, d, a, words[i + 1], 21, -2054922799);
        a = ii(a, b, c, d, words[i + 8], 6, 1873313359); d = ii(d, a, b, c, words[i + 15], 10, -30611744);
        c = ii(c, d, a, b, words[i + 6], 15, -1560198380); b = ii(b, c, d, a, words[i + 13], 21, 1309151649);
        a = ii(a, b, c, d, words[i + 4], 6, -145523070); d = ii(d, a, b, c, words[i + 11], 10, -1120210379);
        c = ii(c, d, a, b, words[i + 2], 15, 718787259); b = ii(b, c, d, a, words[i + 9], 21, -343485551);

        a = safeAdd(a, olda); b = safeAdd(b, oldb); c = safeAdd(c, oldc); d = safeAdd(d, oldd);
      }
      const out = new Uint8Array(16);
      [a, b, c, d].forEach((val, i) => {
        out[i * 4] = val & 0xff; out[i * 4 + 1] = (val >> 8) & 0xff;
        out[i * 4 + 2] = (val >> 16) & 0xff; out[i * 4 + 3] = (val >> 24) & 0xff;
      });
      return out;
    }

    const passBytes = new TextEncoder().encode(passphrase);
    let d = new Uint8Array(0);
    const concatted = [];
    let dI = new Uint8Array(0);
    while (concatted.length < 48) {
      const combined = new Uint8Array(dI.length + passBytes.length + salt.length);
      combined.set(dI);
      combined.set(passBytes, dI.length);
      combined.set(salt, dI.length + passBytes.length);
      dI = md5(combined);
      for (let i = 0; i < dI.length && concatted.length < 48; i++) concatted.push(dI[i]);
    }
    const keyBytes = new Uint8Array(concatted.slice(0, 32));
    const ivBytes = new Uint8Array(concatted.slice(32, 48));

    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, ct);
    return new TextDecoder().decode(pt);
  }

  function stripHtml(s) {
    return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  window.satoCrypto = { decrypt, stripHtml };
})();