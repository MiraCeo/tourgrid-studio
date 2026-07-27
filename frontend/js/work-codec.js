(function(root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TourgridWorkCodec = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  'use strict';

  var GRID_SIZE = 24;
  var PIXEL_COUNT = GRID_SIZE * GRID_SIZE;
  var PACKED_BYTE_LENGTH = 432;

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return root.btoa(binary);
  }

  function base64ToBytes(encoded) {
    var binary = root.atob(encoded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function paletteHex(entry) {
    return String(typeof entry === 'string' ? entry : entry.hex).toUpperCase();
  }

  function packPixels(pixels, palette) {
    if (!Array.isArray(palette) || palette.length !== 64) {
      throw new Error('分享编码需要严格64色色板。');
    }
    if (!Array.isArray(pixels) || pixels.length !== GRID_SIZE) {
      throw new Error('分享编码需要24×24像素矩阵。');
    }

    var indexByHex = {};
    palette.forEach(function(entry, index) {
      indexByHex[paletteHex(entry)] = index;
    });

    var indices = [];
    pixels.forEach(function(row, y) {
      if (!Array.isArray(row) || row.length !== GRID_SIZE) {
        throw new Error('第' + (y + 1) + '行不是24个像素。');
      }
      row.forEach(function(color, x) {
        var index = indexByHex[String(color).toUpperCase()];
        if (!Number.isInteger(index)) {
          throw new Error(
            '第' + (y + 1) + '行，第' + (x + 1) + '列包含色库外颜色。'
          );
        }
        indices.push(index);
      });
    });

    var packed = new Uint8Array(PACKED_BYTE_LENGTH);
    var outputIndex = 0;
    for (var i = 0; i < PIXEL_COUNT; i += 4) {
      var value = (
        (indices[i] << 18) |
        (indices[i + 1] << 12) |
        (indices[i + 2] << 6) |
        indices[i + 3]
      );
      packed[outputIndex++] = (value >>> 16) & 0xFF;
      packed[outputIndex++] = (value >>> 8) & 0xFF;
      packed[outputIndex++] = value & 0xFF;
    }
    return bytesToBase64(packed);
  }

  function unpackPixels(encoded, palette) {
    if (!Array.isArray(palette) || palette.length !== 64) {
      throw new Error('分享解码需要严格64色色板。');
    }
    var packed = base64ToBytes(encoded);
    if (packed.length !== PACKED_BYTE_LENGTH) {
      throw new Error('分享数据长度不是432字节。');
    }

    var colors = palette.map(paletteHex);
    var indices = [];
    for (var i = 0; i < packed.length; i += 3) {
      var value = (
        (packed[i] << 16) |
        (packed[i + 1] << 8) |
        packed[i + 2]
      );
      indices.push((value >>> 18) & 0x3F);
      indices.push((value >>> 12) & 0x3F);
      indices.push((value >>> 6) & 0x3F);
      indices.push(value & 0x3F);
    }

    var pixels = [];
    for (var y = 0; y < GRID_SIZE; y++) {
      pixels[y] = indices.slice(y * GRID_SIZE, (y + 1) * GRID_SIZE).map(
        function(index) { return colors[index]; }
      );
    }
    return pixels;
  }

  return Object.freeze({
    GRID_SIZE: GRID_SIZE,
    PACKED_BYTE_LENGTH: PACKED_BYTE_LENGTH,
    packPixels: packPixels,
    unpackPixels: unpackPixels
  });
});
