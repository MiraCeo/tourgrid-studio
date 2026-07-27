(function(root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TourgridReferenceStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  'use strict';

  var DATABASE_NAME = 'tourgrid-studio';
  var DATABASE_VERSION = 1;
  var STORE_NAME = 'reference-images';
  var LEGACY_ACTIVE_REFERENCE_ID = 'active-reference';

  function createAssetId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return 'reference-' + root.crypto.randomUUID();
    }
    return 'reference-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2);
  }

  function openDatabase() {
    return new Promise(function(resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error('IndexedDB is not available.'));
        return;
      }

      var request = root.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = function() {
        var database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() {
        reject(request.error || new Error('Could not open the reference image database.'));
      };
    });
  }

  function runTransaction(mode, operation) {
    return openDatabase().then(function(database) {
      return new Promise(function(resolve, reject) {
        var transaction = database.transaction(STORE_NAME, mode);
        var store = transaction.objectStore(STORE_NAME);
        var operationResult;

        try {
          operationResult = operation(store);
        } catch (error) {
          database.close();
          reject(error);
          return;
        }

        transaction.oncomplete = function() {
          database.close();
          resolve(operationResult && operationResult.result);
        };
        transaction.onerror = function() {
          var error = transaction.error || new Error('Reference image storage failed.');
          database.close();
          reject(error);
        };
        transaction.onabort = transaction.onerror;
      });
    });
  }

  function save(blob, metadata) {
    if (!blob || typeof blob.size !== 'number') {
      return Promise.reject(new Error('A reference image Blob is required.'));
    }
    var details = metadata || {};
    var record = {
      id: details.id || createAssetId(),
      blob: blob,
      mimeType: blob.type || 'image/webp',
      width: Number.isInteger(details.width) ? details.width : null,
      height: Number.isInteger(details.height) ? details.height : null,
      savedAt: new Date().toISOString()
    };
    return runTransaction('readwrite', function(store) {
      store.put(record);
      return { result: record };
    });
  }

  function load(id) {
    var assetId = id || LEGACY_ACTIVE_REFERENCE_ID;
    return runTransaction('readonly', function(store) {
      return store.get(assetId);
    }).then(function(record) {
      return record || null;
    });
  }

  function remove(id) {
    var assetId = id || LEGACY_ACTIVE_REFERENCE_ID;
    return runTransaction('readwrite', function(store) {
      store.delete(assetId);
      return { result: undefined };
    });
  }

  function listIds() {
    return runTransaction('readonly', function(store) {
      return store.getAllKeys();
    }).then(function(ids) {
      return Array.isArray(ids) ? ids : [];
    });
  }

  return {
    ACTIVE_REFERENCE_ID: LEGACY_ACTIVE_REFERENCE_ID,
    DATABASE_NAME: DATABASE_NAME,
    STORE_NAME: STORE_NAME,
    save: save,
    load: load,
    remove: remove,
    listIds: listIds
  };
});
