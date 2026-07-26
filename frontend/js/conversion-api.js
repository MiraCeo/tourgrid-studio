(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TourgridConversion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

  function validateHexPixels(data, expectedSize) {
    if (!data || !Number.isInteger(data.width) || !Number.isInteger(data.height)) {
      throw new Error('服务器响应缺少有效尺寸。');
    }
    if (
      Number.isInteger(expectedSize) &&
      (data.width !== expectedSize || data.height !== expectedSize)
    ) {
      throw new Error('服务器返回尺寸与请求尺寸不一致。');
    }
    if (!Array.isArray(data.hexPixels) || data.hexPixels.length !== data.height) {
      throw new Error('服务器响应的像素矩阵高度不正确。');
    }
    return data.hexPixels.map(function(row) {
      if (!Array.isArray(row) || row.length !== data.width) {
        throw new Error('服务器响应的像素矩阵宽度不正确。');
      }
      return row.map(function(color) {
        if (color === null) return '#FFFFFF';
        if (typeof color !== 'string' || !HEX_PATTERN.test(color)) {
          throw new Error('服务器返回了无效颜色。');
        }
        return color.toUpperCase();
      });
    });
  }

  function errorMessage(status, payload) {
    var serverMessage = payload && payload.error && payload.error.message;
    if (serverMessage) return serverMessage;
    var messages = {
      413: '图片文件过大，请压缩后重试。',
      415: '图片格式不受支持，请使用 PNG、JPEG 或 WebP。',
      422: '转换参数或图片尺寸无效。',
      504: '服务器转换超时，请重试或使用本地备用模式。'
    };
    return messages[status] || ('服务器转换失败（HTTP ' + status + '）。');
  }

  function describeSettings(options) {
    var ditherLabels = {
      none: '无抖动',
      floyd: 'Floyd–Steinberg',
      atkinson: 'Atkinson'
    };
    return options.width + '×' + options.height +
      ' · ' + options.paletteId +
      ' · ' + (ditherLabels[options.dither] || options.dither) +
      ' · direct';
  }

  return {
    describeSettings: describeSettings,
    errorMessage: errorMessage,
    validateHexPixels: validateHexPixels
  };
});
