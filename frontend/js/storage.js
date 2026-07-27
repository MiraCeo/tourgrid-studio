(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TourgridStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var SCHEMA_VERSION = 4;
  var FIXED_GRID_SIZE = 24;
  var HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

  function clonePixels(pixels) {
    return pixels.map(function(row) {
      return row.map(function(color) { return color.toUpperCase(); });
    });
  }

  function validatePixels(gridSize, pixels) {
    return gridSize === FIXED_GRID_SIZE &&
      Array.isArray(pixels) &&
      pixels.length === gridSize &&
      pixels.every(function(row) {
        return Array.isArray(row) &&
          row.length === gridSize &&
          row.every(function(color) {
            return typeof color === 'string' && HEX_PATTERN.test(color);
          });
      });
  }

  function defaultMetadata() {
    return {
      sourceMode: 'canvas',
      paletteId: null,
      editorPaletteId: 'exhibition',
      paletteVersion: null,
      converterVersion: null,
      importedAt: null
    };
  }

  function defaultReference() {
    return {
      assetId: null,
      mimeType: null,
      width: null,
      height: null,
      visible: false,
      opacity: 0.4
    };
  }

  function normalizeReference(value) {
    var reference = Object.assign(defaultReference(), value || {});
    if (typeof reference.assetId !== 'string' || !reference.assetId) {
      return defaultReference();
    }
    if (typeof reference.mimeType !== 'string') reference.mimeType = null;
    if (!Number.isInteger(reference.width) || reference.width <= 0) {
      reference.width = null;
    }
    if (!Number.isInteger(reference.height) || reference.height <= 0) {
      reference.height = null;
    }
    reference.visible = Boolean(reference.visible);
    if (typeof reference.opacity !== 'number' || !Number.isFinite(reference.opacity)) {
      reference.opacity = 0.4;
    }
    reference.opacity = Math.max(0, Math.min(1, reference.opacity));
    return reference;
  }

  function normalizeMetadata(value, legacyPaletteId) {
    var metadata = Object.assign(defaultMetadata(), value || {});
    if (legacyPaletteId && !value) metadata.editorPaletteId = legacyPaletteId;
    if (!['canvas', 'server', 'local'].includes(metadata.sourceMode)) {
      metadata.sourceMode = 'canvas';
    }
    if (typeof metadata.paletteId !== 'string' && metadata.paletteId !== null) {
      metadata.paletteId = null;
    }
    if (typeof metadata.editorPaletteId !== 'string') {
      metadata.editorPaletteId = 'exhibition';
    }
    if (!Number.isInteger(metadata.paletteVersion)) metadata.paletteVersion = null;
    if (typeof metadata.converterVersion !== 'string') metadata.converterVersion = null;
    if (typeof metadata.importedAt !== 'string') metadata.importedAt = null;
    return metadata;
  }

  function migrate(value) {
    if (!value || typeof value !== 'object') return null;
    if (!validatePixels(value.gridSize, value.pixels)) return null;

    return {
      schemaVersion: SCHEMA_VERSION,
      gridSize: value.gridSize,
      pixels: clonePixels(value.pixels),
      metadata: normalizeMetadata(value.metadata, value.paletteId),
      reference: normalizeReference(value.reference),
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : null
    };
  }

  function serialize(documentState) {
    var migrated = migrate(documentState);
    if (!migrated) throw new Error('Cannot save an invalid editor document.');
    migrated.savedAt = new Date().toISOString();
    return migrated;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    clonePixels: clonePixels,
    defaultMetadata: defaultMetadata,
    defaultReference: defaultReference,
    migrate: migrate,
    normalizeReference: normalizeReference,
    serialize: serialize,
    validatePixels: validatePixels
  };
});
